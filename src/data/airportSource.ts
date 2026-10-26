// Airport layouts from OpenStreetMap (Overpass), shared by the game (src/data/osm.ts), the
// Pages Function, the dev server (vite.config.ts) and scripts/update-airports.mjs, which
// prebuilds the preset airports. Only fetch is used here: no DOM, no Node APIs.

import type { LatLon } from '../geo/projection';
import type { OsmElement } from './osm';

/** Bump when the query or the stored format changes: old caches and prebuilt files are then ignored. */
export const LAYOUT_VERSION = 3;

export const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

const AEROWAY_WAYS = 'runway|taxiway|taxilane|apron|terminal|hangar|parking_position|stopway|jet_bridge|helipad|holding_position|tower|control_tower|gate';
const AEROWAY_NODES = 'parking_position|gate|holding_position|tower|control_tower';

/** Global search for an airport's position by ICAO code (slow on busy servers). */
export const lookupQuery = (icao: string) => `[out:json][timeout:90];(nwr["aeroway"="aerodrome"]["icao"="${icao}"];);out center;`;

/** One bbox query around the airport centre gets the aerodrome outline plus everything on it. */
export function layoutQuery(icao: string, c: LatLon): string {
  const dLat = 0.05, dLon = 0.05 / Math.cos((c.lat * Math.PI) / 180);
  const bb = { s: c.lat - dLat, w: c.lon - dLon, n: c.lat + dLat, e: c.lon + dLon };
  return `[out:json][timeout:110][bbox:${bb.s},${bb.w},${bb.n},${bb.e}];` +
    `nwr["aeroway"="aerodrome"]["icao"="${icao}"]->.ap;.ap map_to_area->.a;` +
    `(.ap;way["aeroway"~"^(${AEROWAY_WAYS})$"];node["aeroway"~"^(${AEROWAY_NODES})$"];` +
    `relation["aeroway"~"^(apron|terminal|hangar)$"];` +
    // generic buildings only inside the aerodrome outline (cities around airports are huge)
    `way(area.a)["building"];` +
    `node["man_made"="tower"]["tower:type"="observation"];);out geom;`;
}

/** Position of an aerodrome element from a lookup query. */
export function aerodromeCenter(e: OsmElement | undefined): LatLon | null {
  return e?.center ?? (e?.lat != null && e.lon != null ? { lat: e.lat, lon: e.lon } : null);
}

/** What the caches, the /api/airport endpoint and the prebuilt files hold for one airport. */
export interface LayoutFile {
  v: number;
  icao: string;
  /** ISO time the data was downloaded from OpenStreetMap. */
  fetched: string;
  elements: OsmElement[];
}

export function isLayoutFile(x: unknown, icao: string): x is LayoutFile {
  const f = x as LayoutFile | null;
  return !!f && f.v === LAYOUT_VERSION && f.icao === icao && Array.isArray(f.elements);
}

/** OpenStreetMap answered, but has no usable airport under this code. Not worth retrying elsewhere. */
export class LayoutNotFound extends Error {}

/** Keep tagged elements only (drops navigation-aid lights etc.); a layout without runways is no use. */
export function usableElements(elements: OsmElement[]): OsmElement[] {
  const out = elements.filter((e) => e.tags);
  if (!out.some((e) => e.tags?.aeroway === 'runway')) throw new LayoutNotFound('No runways mapped in OpenStreetMap');
  return out;
}

export interface FetchLayoutOptions {
  /** Sent to Overpass, which rejects anonymous clients. */
  userAgent: string;
  /** Total time across both queries and all mirrors. */
  budgetMs: number;
  /** Called with each mirror attempt, for logging. */
  onAttempt?: (host: string, error?: string) => void;
}

/**
 * Server side: download an airport from the first Overpass mirror that answers, within a time
 * budget. Without a known centre the airport is looked up first (a slow global search).
 */
export async function fetchLayout(icao: string, center: LatLon | null, opts: FetchLayoutOptions): Promise<LayoutFile> {
  const deadline = Date.now() + opts.budgetMs;
  if (!center) {
    center = aerodromeCenter((await runQuery(lookupQuery(icao), deadline, opts))[0]);
    if (!center) throw new LayoutNotFound(`Airport ${icao} not found in OpenStreetMap`);
  }
  const elements = usableElements(await runQuery(layoutQuery(icao, center), deadline, opts));
  return { v: LAYOUT_VERSION, icao, fetched: new Date().toISOString(), elements };
}

async function runQuery(query: string, deadline: number, opts: FetchLayoutOptions): Promise<OsmElement[]> {
  let lastError = 'no time left';
  for (const [i, url] of OVERPASS_MIRRORS.entries()) {
    // the first mirror may use most of the budget; later ones split what's left. A busy
    // server answers 429/502/504 at once, so that moves on to the next mirror straight away.
    const left = deadline - Date.now();
    if (left < 5_000) break;
    const slice = i === OVERPASS_MIRRORS.length - 1 ? left : Math.max(left * 0.7, left - 30_000);
    const host = new URL(url).host;
    try {
      const res = await fetch(url, {
        method: 'POST',
        body: new URLSearchParams({ data: query }),
        headers: { 'User-Agent': opts.userAgent, Accept: 'application/json' },
        signal: AbortSignal.timeout(slice),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { elements?: OsmElement[]; remark?: string };
      // overloaded servers answer 200 with a "remark" instead of (complete) data
      if (json.remark && /error|timed out|timeout|out of memory/i.test(json.remark)) throw new Error(json.remark);
      if (!Array.isArray(json.elements)) throw new Error('no elements in the answer');
      opts.onAttempt?.(host);
      return json.elements;
    } catch (e) {
      lastError = `${host}: ${(e as Error).message}`;
      opts.onAttempt?.(host, lastError);
    }
  }
  throw new Error(`OpenStreetMap unavailable (${lastError})`);
}
