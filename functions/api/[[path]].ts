// Cloudflare Pages Function: same-origin proxy for the APIs the game can't call directly from
// the browser (no CORS, or origins rejected). It mirrors the dev-server proxies in
// vite.config.ts, so the game calls /api/<service>/... the same way in development and in
// production.
//
// Locked down to an allowlist of upstream endpoints and GET requests only, so it can't be
// used as an open proxy. Responses are cached at the edge so many players share one upstream
// request (and stay inside the free APIs' rate limits).

interface Upstream {
  /** Upstream base URL; with several, they're tried in order until one answers OK. */
  origin: string | string[];
  /** Allowed upstream paths (after the /api/<service> prefix). */
  paths: RegExp;
  /** Edge cache lifetime in seconds; 0 = never cache (per-user credentials). */
  ttl: number;
  /** Request headers passed through from the browser. */
  forward?: string[];
  /** Longest query string accepted (default 400 characters). */
  maxQuery?: number;
  /** Total time budget in ms across all origins (default 15 s); the browser waits a little longer. */
  timeout?: number;
  /** Body check before caching: a "200 OK" that is really an error must not be cached. */
  cacheable?: (body: string) => boolean;
  /** Treat upstream 404 as an ordinary, cacheable answer (passed on as 200). */
  notFoundOk?: boolean;
}

const UPSTREAMS: Record<string, Upstream> = {
  // adsb.lol: aircraft around a point, e.g. /v2/lat/40.64/lon/-73.78/dist/60
  adsb: { origin: 'https://api.adsb.lol', paths: /^\/v2\/lat\/-?\d{1,2}(\.\d+)?\/lon\/-?\d{1,3}(\.\d+)?\/dist\/\d{1,3}$/, ttl: 4 },
  // OpenSky: state vectors in a bounding box
  opensky: { origin: 'https://opensky-network.org', paths: /^\/api\/states\/all$/, ttl: 10 },
  // Flightradar24 official API: needs the player's own key, never cached
  fr24: { origin: 'https://fr24api.flightradar24.com', paths: /^\/api\/live\/flight-positions\/(full|light)$/, ttl: 0, forward: ['authorization', 'accept-version'] },
  // aviationweather.gov METAR
  awc: { origin: 'https://aviationweather.gov', paths: /^\/api\/data\/metar$/, ttl: 300 },
  // adsbdb.com flight routes by callsign. "Unknown callsign" is a 404 there; it's answered as
  // a normal (cached) reply so browsers don't log an error for every unknown flight.
  adsbdb: { origin: 'https://api.adsbdb.com', paths: /^\/v0\/callsign\/[A-Za-z0-9]{2,10}$/, ttl: 21_600, notFoundOk: true },
  // OpenStreetMap Overpass (airport layouts). Public servers reject some browser origins, and
  // layouts rarely change, so good answers are cached for a day for every player.
  overpass: {
    origin: ['https://overpass-api.de', 'https://overpass.private.coffee', 'https://overpass.kumi.systems'],
    paths: /^\/api\/interpreter$/,
    ttl: 86_400,
    maxQuery: 4000,
    timeout: 150_000, // the game's own request gives up at 160 s

    // overloaded servers answer 200 with a "remark" instead of (complete) data
    cacheable: (body) => body.trimStart().startsWith('{') && !/"remark"\s*:\s*"[^"]*(error|timed out|timeout|out of memory)/i.test(body.slice(-3000)),
  },
};

const USER_AGENT = 'AirportOpsSim/0.1 (+https://airport-ops-sim.pages.dev)';

// Minimal shape of the Pages Functions context (avoids a dependency on workers-types).
interface Context {
  request: Request;
  params: { path?: string | string[] };
  waitUntil(p: Promise<unknown>): void;
  env: { FLIGHTAWARE_API_KEY?: string };
}
declare const caches: { default: Cache };

const fail = (status: number, message: string) =>
  new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

// FlightAware AeroAPI (paid, billed per query). Only one endpoint is allowed: an airport's
// schedule board (recent + upcoming arrivals and departures), one page per call.
//  - A player's own key (x-apikey header) is forwarded as-is and never shared.
//  - Otherwise the site key (Cloudflare secret FLIGHTAWARE_API_KEY) is used, and the answer is
//    cached at the edge for 10 minutes per airport, so cost depends on airports in use, not players.
const FA_TTL = 600;

async function flightAware(request: Request, path: string, env: Context['env']): Promise<Response> {
  if (!/^\/aeroapi\/airports\/[A-Z0-9]{3,4}\/flights$/.test(path)) return fail(400, 'Request not allowed');
  const own = request.headers.get('x-apikey');
  const key = own || env.FLIGHTAWARE_API_KEY;
  if (!key) return fail(503, 'FlightAware is not configured');
  const shared = !own;
  let res: Response;
  try {
    // fixed query (one page of airline flights) keeps every call at the minimum cost
    res = await fetch(`https://aeroapi.flightaware.com${path}?type=Airline&max_pages=1`, {
      headers: { 'x-apikey': key, Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(20_000),
      cf: shared ? { cacheTtlByStatus: { '200-299': FA_TTL, '300-599': 0 }, cacheEverything: true } : { cacheTtl: 0 },
    } as RequestInit);
  } catch (e) {
    return fail(502, `FlightAware unavailable: ${(e as Error).message}`);
  }
  return new Response(res.body, {
    status: res.status,
    headers: {
      'Content-Type': res.headers.get('Content-Type') ?? 'application/json',
      'Cache-Control': shared && res.ok ? `public, max-age=${FA_TTL}` : 'no-store',
      'X-Upstream': 'flightaware',
      'X-FlightAware-Key': own ? 'player' : 'site',
    },
  });
}

export const onRequest = async ({ request, params, waitUntil, env }: Context): Promise<Response> => {
  if (request.method !== 'GET' && request.method !== 'HEAD') return fail(405, 'Method not allowed');

  const segments = Array.isArray(params.path) ? params.path : params.path ? [params.path] : [];
  const [service, ...rest] = segments;
  if (service === 'flightaware') return flightAware(request, '/' + rest.join('/'), env ?? {});
  const up = service ? UPSTREAMS[service] : undefined;
  if (!up) return fail(404, 'Unknown API');

  const path = '/' + rest.join('/');
  const url = new URL(request.url);
  if (!up.paths.test(path) || url.search.length > (up.maxQuery ?? 400)) return fail(400, 'Request not allowed');

  // Services with a body check are cached by hand (after checking); the rest use the fetch cache.
  const cacheKey = new Request(url.toString(), { method: 'GET' });
  if (up.cacheable) {
    const hit = await caches.default.match(cacheKey);
    if (hit) return hit;
  }

  const headers = new Headers({ 'User-Agent': USER_AGENT, Accept: request.headers.get('Accept') ?? 'application/json' });
  for (const h of up.forward ?? []) {
    const v = request.headers.get(h);
    if (v) headers.set(h, v);
  }

  const origins = Array.isArray(up.origin) ? up.origin : [up.origin];
  const deadline = Date.now() + (up.timeout ?? 15_000);
  let res: Response | null = null;
  let lastError = '';
  for (const [i, origin] of origins.entries()) {
    // the first origin may use most of the budget; later ones split what's left
    const left = deadline - Date.now();
    if (left < 5_000) break;
    const slice = i === origins.length - 1 ? left : Math.max(left * 0.7, left - 30_000);
    try {
      res = await fetch(origin + path + url.search, {
        method: request.method,
        headers,
        signal: AbortSignal.timeout(slice),
        // shared edge cache for the upstream response; error statuses aren't cached
        cf: up.ttl > 0 && !up.cacheable
          ? { cacheTtlByStatus: up.notFoundOk ? { '200-299': up.ttl, '404': up.ttl, '500-599': 0 } : { '200-299': up.ttl, '300-599': 0 }, cacheEverything: true }
          : { cacheTtl: 0 },
      } as RequestInit);
      if (res.ok || origins.length === 1 || (up.notFoundOk && res.status === 404)) break;
      lastError = `${new URL(origin).host}: HTTP ${res.status}`;
    } catch (e) {
      lastError = `${new URL(origin).host}: ${(e as Error).message}`;
    }
    res = null;
  }
  if (!res) return fail(502, `Upstream unavailable (${lastError})`);

  const contentType = res.headers.get('Content-Type') ?? 'application/json';
  if (up.cacheable && res.ok) {
    const body = await res.text();
    const good = up.cacheable(body);
    const out = new Response(body, {
      status: 200,
      headers: { 'Content-Type': contentType, 'Cache-Control': good ? `public, max-age=${up.ttl}` : 'no-store', 'X-Upstream': service },
    });
    if (good) waitUntil(caches.default.put(cacheKey, out.clone()));
    return out;
  }

  const ok = res.ok || (up.notFoundOk && res.status === 404);
  const out = new Response(res.body, { status: ok ? 200 : res.status });
  out.headers.set('Content-Type', contentType);
  out.headers.set('Cache-Control', up.ttl > 0 && ok ? `public, max-age=${up.ttl}` : 'no-store');
  out.headers.set('X-Upstream', service);
  return out;
};
