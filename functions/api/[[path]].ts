// Cloudflare Pages Function: same-origin proxy for the live-data APIs that don't allow
// browser (CORS) access. It mirrors the dev-server proxies in vite.config.ts, so the game
// calls /api/<service>/... the same way in development and in production.
//
// Locked down to an allowlist of upstream endpoints and GET requests only, so it can't be
// used as an open proxy. Responses are cached briefly at the edge so many players share
// one upstream request (and stay inside the free APIs' rate limits).

interface Upstream {
  origin: string;
  /** Allowed upstream paths (after the /api/<service> prefix). */
  paths: RegExp;
  /** Edge cache lifetime in seconds; 0 = never cache (per-user credentials). */
  ttl: number;
  /** Request headers passed through from the browser. */
  forward?: string[];
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
};

const USER_AGENT = 'AirportOpsSim/0.1 (+https://airport-ops-sim.pages.dev)';

// Minimal shape of the Pages Functions context (avoids a dependency on workers-types).
interface Context {
  request: Request;
  params: { path?: string | string[] };
}

const fail = (status: number, message: string) =>
  new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export const onRequest = async ({ request, params }: Context): Promise<Response> => {
  if (request.method !== 'GET' && request.method !== 'HEAD') return fail(405, 'Method not allowed');

  const segments = Array.isArray(params.path) ? params.path : params.path ? [params.path] : [];
  const [service, ...rest] = segments;
  const up = service ? UPSTREAMS[service] : undefined;
  if (!up) return fail(404, 'Unknown API');

  const path = '/' + rest.join('/');
  const url = new URL(request.url);
  if (!up.paths.test(path) || url.search.length > 400) return fail(400, 'Request not allowed');

  const headers = new Headers({ 'User-Agent': USER_AGENT, Accept: request.headers.get('Accept') ?? 'application/json' });
  for (const h of up.forward ?? []) {
    const v = request.headers.get(h);
    if (v) headers.set(h, v);
  }

  let res: Response;
  try {
    res = await fetch(up.origin + path + url.search, {
      method: request.method,
      headers,
      signal: AbortSignal.timeout(15_000),
      // Cloudflare edge cache for the upstream response (shared between players)
      cf: up.ttl > 0 ? { cacheTtl: up.ttl, cacheEverything: true } : { cacheTtl: 0 },
    } as RequestInit);
  } catch (e) {
    return fail(502, `Upstream unavailable: ${(e as Error).message}`);
  }

  const out = new Response(res.body, { status: res.status });
  out.headers.set('Content-Type', res.headers.get('Content-Type') ?? 'application/json');
  out.headers.set('Cache-Control', up.ttl > 0 && res.ok ? `public, max-age=${up.ttl}` : 'no-store');
  out.headers.set('X-Upstream', service);
  return out;
};
