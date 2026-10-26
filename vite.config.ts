import { defineConfig, loadEnv, type Plugin, type ProxyOptions } from 'vite';
import { AIRPORTS } from './src/data/airports.ts';
import { LayoutNotFound, fetchLayout } from './src/data/airportSource.ts';

// Browser CORS blocks most flight/weather APIs, so the dev (and preview) server proxies them.
const UA = 'AirportOpsSim/0.1 (educational simulation)';

function proxy(target: string, prefix: string): ProxyOptions {
  return {
    target,
    changeOrigin: true,
    secure: true,
    rewrite: (p) => p.replace(new RegExp(`^${prefix}`), ''),
    headers: { 'User-Agent': UA },
  };
}

// (local event types: the project doesn't install @types/node)
interface ProxyEvents {
  on(event: 'proxyRes', fn: (res: { statusCode?: number }) => void): void;
  on(event: 'proxyReq', fn: (proxyReq: { setHeader(name: string, value: string): void }, req: { headers: Record<string, string | string[] | undefined> }) => void): void;
}

// (local middleware types, for the same reason)
interface MiddlewareReq { url?: string; method?: string }
interface MiddlewareRes { statusCode: number; setHeader(name: string, value: string): void; end(body?: string): void }
type Middleware = (req: MiddlewareReq, res: MiddlewareRes, next: () => void) => void;
interface MiddlewareServer { middlewares: { use(path: string, fn: Middleware): void } }

/**
 * /api/airport/<ICAO> like the Pages Function: the server downloads the layout from
 * OpenStreetMap and keeps it in memory while it runs (the function keeps it in KV).
 */
function airportApi(): Plugin {
  const layouts = new Map<string, Promise<{ status: number; body: string }>>();
  const handle: Middleware = (req, res, next) => {
    const icao = /^\/([A-Za-z0-9]{4})\/?(\?.*)?$/.exec(req.url ?? '')?.[1].toUpperCase();
    if (!icao || req.method !== 'GET') return next();
    let pending = layouts.get(icao);
    if (!pending) {
      const preset = AIRPORTS.find((a) => a.icao === icao);
      pending = fetchLayout(icao, preset ? { lat: preset.lat, lon: preset.lon } : null, { userAgent: UA, budgetMs: 150_000 })
        .then((file) => ({ status: 200, body: JSON.stringify(file) }))
        .catch((e: Error) => {
          if (e instanceof LayoutNotFound) return { status: 404, body: JSON.stringify({ notFound: true, error: e.message }) };
          layouts.delete(icao); // OpenStreetMap busy: try again next time
          return { status: 502, body: JSON.stringify({ error: e.message }) };
        });
      layouts.set(icao, pending);
    }
    void pending.then(({ status, body }) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      if (status === 404) res.setHeader('X-Layout', 'not-found');
      res.end(body);
    });
  };
  const use = (server: unknown) => (server as MiddlewareServer).middlewares.use('/api/airport', handle);
  return { name: 'airport-api', configureServer: use, configurePreviewServer: use };
}

const baseProxies: Record<string, ProxyOptions> = {
  '/api/adsb': proxy('https://api.adsb.lol', '/api/adsb'),
  '/api/opensky': proxy('https://opensky-network.org', '/api/opensky'),
  '/api/fr24': proxy('https://fr24api.flightradar24.com', '/api/fr24'),
  '/api/awc': proxy('https://aviationweather.gov', '/api/awc'),
  '/api/adsbdb': {
    ...proxy('https://api.adsbdb.com', '/api/adsbdb'),
    // "unknown callsign" is a 404 upstream; pass it on as a normal reply (same as the Pages Function)
    configure: (p) => (p as unknown as ProxyEvents).on('proxyRes', (res) => { if (res.statusCode === 404) res.statusCode = 200; }),
  },
};

export default defineConfig(({ mode }) => {
  // optional site key for local testing: FLIGHTAWARE_API_KEY in .env.local (git-ignored)
  const faKey = loadEnv(mode, '.', '').FLIGHTAWARE_API_KEY;
  const proxies: Record<string, ProxyOptions> = {
    ...baseProxies,
    // FlightAware AeroAPI, same rules as the Pages Function: one airport-board page per call,
    // the player's own key wins, otherwise the local site key (if any)
    '/api/flightaware': {
      ...proxy('https://aeroapi.flightaware.com', '/api/flightaware'),
      rewrite: (p) => p.replace(/^\/api\/flightaware/, '').replace(/\?.*$/, '') + '?type=Airline&max_pages=1',
      configure: (p) => (p as unknown as ProxyEvents).on('proxyReq', (proxyReq, req) => {
        if (!req.headers['x-apikey'] && faKey) proxyReq.setHeader('x-apikey', faKey);
      }),
    },
  };
  return {
    plugins: [airportApi()],
    server: { port: 5173, proxy: proxies },
    preview: { port: 4173, proxy: proxies },
    build: { chunkSizeWarningLimit: 1500 },
  };
});
