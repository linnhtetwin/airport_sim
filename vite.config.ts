import { defineConfig, type ProxyOptions } from 'vite';

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

const proxies = {
  '/api/adsb': proxy('https://api.adsb.lol', '/api/adsb'),
  '/api/opensky': proxy('https://opensky-network.org', '/api/opensky'),
  '/api/fr24': proxy('https://fr24api.flightradar24.com', '/api/fr24'),
  '/api/awc': proxy('https://aviationweather.gov', '/api/awc'),
  '/api/overpass': proxy('https://overpass-api.de', '/api/overpass'),
};

export default defineConfig({
  server: { port: 5173, proxy: proxies },
  preview: { port: 4173, proxy: proxies },
  build: { chunkSizeWarningLimit: 1500 },
});
