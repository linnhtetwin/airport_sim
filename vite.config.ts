import { defineConfig, loadEnv, type ProxyOptions } from 'vite';

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

const baseProxies: Record<string, ProxyOptions> = {
  '/api/adsb': proxy('https://api.adsb.lol', '/api/adsb'),
  '/api/opensky': proxy('https://opensky-network.org', '/api/opensky'),
  '/api/fr24': proxy('https://fr24api.flightradar24.com', '/api/fr24'),
  '/api/awc': proxy('https://aviationweather.gov', '/api/awc'),
  '/api/overpass': proxy('https://overpass-api.de', '/api/overpass'),
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
    server: { port: 5173, proxy: proxies },
    preview: { port: 4173, proxy: proxies },
    build: { chunkSizeWarningLimit: 1500 },
  };
});
