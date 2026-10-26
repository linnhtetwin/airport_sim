// Prebuild the preset airports' layouts into public/airports/<ICAO>.json, so they open at once
// instead of waiting for the public OpenStreetMap servers. Run it now and then to pick up
// map edits:
//
//   npm run airports              every preset airport
//   npm run airports -- EGLL KJFK just these
//
// Runs the game's own TypeScript modules directly, so it needs Node 22.18 or newer.

import { mkdir, writeFile } from 'node:fs/promises';
import { AIRPORTS } from '../src/data/airports.ts';
import { fetchLayout } from '../src/data/airportSource.ts';

const OUT = new URL('../public/airports/', import.meta.url);
const USER_AGENT = 'AirportOpsSim/0.1 (+https://airport-ops-sim.pages.dev)';
const ATTEMPTS = 3;

const wanted = process.argv.slice(2).map((s) => s.toUpperCase());
const unknown = wanted.filter((icao) => !AIRPORTS.some((a) => a.icao === icao));
if (unknown.length) {
  console.error(`Not preset airports: ${unknown.join(', ')}`);
  process.exit(1);
}
const todo = wanted.length ? AIRPORTS.filter((a) => wanted.includes(a.icao)) : AIRPORTS;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
await mkdir(OUT, { recursive: true });

const failed = [];
for (const a of todo) {
  const t0 = Date.now();
  let done = false;
  for (let attempt = 1; attempt <= ATTEMPTS && !done; attempt++) {
    try {
      const file = await fetchLayout(a.icao, { lat: a.lat, lon: a.lon }, {
        userAgent: USER_AGENT,
        budgetMs: 240_000,
        onAttempt: (host, error) => error && console.warn(`  ${a.icao}: ${error}`),
      });
      const body = JSON.stringify(file);
      await writeFile(new URL(`${a.icao}.json`, OUT), body);
      console.log(`${a.icao}  ${file.elements.length} elements, ${(body.length / 1024).toFixed(0)} KB, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
      done = true;
    } catch (e) {
      console.warn(`  ${a.icao}: attempt ${attempt} failed: ${e.message}`);
      // the public servers ask busy clients to back off
      if (attempt < ATTEMPTS) await sleep(30_000 * attempt);
    }
  }
  if (!done) failed.push(a.icao);
  await sleep(2_000); // one airport at a time, with a pause: these are shared public servers
}

if (failed.length) {
  console.error(`Not updated (kept the previous file, if any): ${failed.join(', ')}`);
  process.exit(1);
}
