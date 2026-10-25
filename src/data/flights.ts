// Live traffic providers. All requests go through the Vite proxy (see vite.config.ts)
// because none of these APIs allow direct browser access from localhost.

export type Provider = 'adsb' | 'opensky' | 'fr24';

export const PROVIDER_LABEL: Record<Provider, string> = {
  adsb: 'adsb.lol (free, community ADS-B)',
  opensky: 'OpenSky Network (free, rate limited)',
  fr24: 'Flightradar24 API (needs your API key)',
};

export interface LiveFlight {
  hex: string;
  callsign: string;
  reg?: string;
  type?: string;
  category?: string;
  lat: number;
  lon: number;
  altFt: number | null; // barometric, null when on ground
  onGround: boolean;
  gs: number; // kt
  track: number; // deg
  vrate: number; // ft/min
  squawk?: string;
  origin?: string; // IATA
  dest?: string;
  originIcao?: string;
  destIcao?: string;
  originName?: string;
  destName?: string;
  seenAt: number; // epoch ms of the position
}

export interface FeedResult { flights: LiveFlight[]; source: string }

async function getJson<T>(url: string, init?: RequestInit, timeoutMs = 12_000): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

interface AdsbAc {
  hex: string; flight?: string; r?: string; t?: string; category?: string; lat?: number; lon?: number;
  alt_baro?: number | 'ground'; gs?: number; track?: number; true_heading?: number; baro_rate?: number; geom_rate?: number;
  squawk?: string; seen_pos?: number;
}

async function fetchAdsb(lat: number, lon: number, nm: number): Promise<LiveFlight[]> {
  const j = await getJson<{ ac?: AdsbAc[]; now?: number }>(`/api/adsb/v2/lat/${lat.toFixed(4)}/lon/${lon.toFixed(4)}/dist/${Math.round(nm)}`);
  const now = Date.now();
  return (j.ac ?? []).filter((a) => a.lat != null && a.lon != null).map((a) => ({
    hex: a.hex,
    callsign: (a.flight ?? '').trim() || (a.r ?? a.hex).toUpperCase(),
    reg: a.r,
    type: a.t,
    category: a.category,
    lat: a.lat!,
    lon: a.lon!,
    altFt: a.alt_baro === 'ground' || a.alt_baro == null ? null : a.alt_baro,
    onGround: a.alt_baro === 'ground',
    gs: a.gs ?? 0,
    track: a.track ?? a.true_heading ?? 0,
    vrate: a.baro_rate ?? a.geom_rate ?? 0,
    squawk: a.squawk,
    seenAt: now - (a.seen_pos ?? 0) * 1000,
  }));
}

type OskState = [string, string | null, string, number | null, number, number | null, number | null, number | null, boolean, number | null, number | null, number | null, unknown, number | null, string | null, boolean, number, number?];

async function fetchOpenSky(lat: number, lon: number, nm: number): Promise<LiveFlight[]> {
  const dLat = nm / 60, dLon = nm / (60 * Math.cos((lat * Math.PI) / 180));
  const j = await getJson<{ states: OskState[] | null }>(`/api/opensky/api/states/all?lamin=${lat - dLat}&lomin=${lon - dLon}&lamax=${lat + dLat}&lomax=${lon + dLon}&extended=1`);
  return (j.states ?? []).filter((s) => s[5] != null && s[6] != null).map((s) => ({
    hex: s[0],
    callsign: (s[1] ?? '').trim() || s[0].toUpperCase(),
    lat: s[6]!,
    lon: s[5]!,
    altFt: s[8] ? null : s[7] != null ? s[7] / 0.3048 : null,
    onGround: s[8],
    gs: (s[9] ?? 0) / 0.514444,
    track: s[10] ?? 0,
    vrate: ((s[11] ?? 0) / 0.3048) * 60,
    squawk: s[14] ?? undefined,
    category: s[17] != null ? ['', '', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7'][s[17]] : undefined,
    seenAt: (s[3] ?? s[4]) * 1000,
  }));
}

interface Fr24Pos {
  fr24_id: string; flight?: string; callsign?: string; lat: number; lon: number; track: number; alt: number; gspeed: number; vspeed: number;
  squawk?: string; timestamp: string; hex?: string; type?: string; reg?: string; orig_iata?: string; dest_iata?: string; orig_icao?: string; dest_icao?: string;
}

async function fetchFr24(lat: number, lon: number, nm: number, key: string): Promise<LiveFlight[]> {
  const dLat = nm / 60, dLon = nm / (60 * Math.cos((lat * Math.PI) / 180));
  const bounds = [lat + dLat, lat - dLat, lon - dLon, lon + dLon].map((v) => v.toFixed(3)).join(',');
  const j = await getJson<{ data: Fr24Pos[] }>(`/api/fr24/api/live/flight-positions/full?bounds=${bounds}`, {
    headers: { Accept: 'application/json', 'Accept-Version': 'v1', Authorization: `Bearer ${key}` },
  });
  return (j.data ?? []).map((f) => ({
    hex: f.hex ?? f.fr24_id,
    callsign: (f.callsign || f.flight || f.fr24_id).trim(),
    reg: f.reg,
    type: f.type,
    lat: f.lat,
    lon: f.lon,
    altFt: f.alt > 0 ? f.alt : null,
    onGround: f.alt <= 0,
    gs: f.gspeed,
    track: f.track,
    vrate: f.vspeed,
    squawk: f.squawk,
    origin: f.orig_iata,
    dest: f.dest_iata,
    originIcao: f.orig_icao,
    destIcao: f.dest_icao,
    seenAt: Date.parse(f.timestamp) || Date.now(),
  }));
}

/** Polls a provider, falling back to the other free one if it fails. */
export class FlightFeed {
  private routeCache = new Map<string, { o?: string; d?: string; oi?: string; di?: string; on?: string; dn?: string } | null>();
  private routeBusy = false;
  private routeBackoffUntil = 0;
  lastError = '';

  constructor(public provider: Provider, public fr24Key = '') {}

  async fetch(lat: number, lon: number, nm: number): Promise<FeedResult> {
    const order: Provider[] = this.provider === 'fr24' && this.fr24Key ? ['fr24', 'adsb', 'opensky']
      : this.provider === 'opensky' ? ['opensky', 'adsb'] : ['adsb', 'opensky'];
    let lastErr: unknown = null;
    for (const p of order) {
      try {
        const flights = p === 'fr24' ? await fetchFr24(lat, lon, nm, this.fr24Key)
          : p === 'opensky' ? await fetchOpenSky(lat, lon, nm) : await fetchAdsb(lat, lon, nm);
        this.lastError = '';
        for (const f of flights) this.applyRoute(f);
        if (p !== 'fr24') void this.lookupRoutes(flights);
        return { flights, source: p };
      } catch (e) {
        lastErr = e;
        console.warn(`Live feed ${p} failed`, e);
      }
    }
    this.lastError = String((lastErr as Error)?.message ?? lastErr);
    throw lastErr;
  }

  private applyRoute(f: LiveFlight) {
    if (f.origin || f.dest) return;
    const r = this.routeCache.get(f.callsign);
    if (r) { f.origin = r.o; f.dest = r.d; f.originIcao = r.oi; f.destIcao = r.di; f.originName = r.on; f.destName = r.dn; }
  }

  /** Origin/destination from adsbdb.com's callsign database (best effort, a few per poll). */
  private async lookupRoutes(flights: LiveFlight[]) {
    if (this.routeBusy || Date.now() < this.routeBackoffUntil) return;
    const todo = flights
      .filter((f) => /^[A-Z]{3}\d/.test(f.callsign) && !this.routeCache.has(f.callsign))
      .sort((a, b) => Number(a.onGround) - Number(b.onGround))
      .slice(0, 12);
    if (!todo.length) return;
    this.routeBusy = true;
    for (const f of todo) this.routeCache.set(f.callsign, null);
    type Apt = { iata_code?: string; icao_code?: string; name?: string; municipality?: string };
    const one = async (f: LiveFlight) => {
      try {
        const j = await getJson<{ response?: { flightroute?: { origin?: Apt; destination?: Apt } } | string }>(`/api/adsbdb/v0/callsign/${encodeURIComponent(f.callsign)}`, undefined, 10_000);
        const r = typeof j.response === 'object' ? j.response.flightroute : undefined;
        if (r?.origin && r.destination) {
          this.routeCache.set(f.callsign, {
            o: r.origin.iata_code, d: r.destination.iata_code, oi: r.origin.icao_code, di: r.destination.icao_code,
            on: r.origin.municipality ?? r.origin.name, dn: r.destination.municipality ?? r.destination.name,
          });
        }
      } catch (e) {
        // rate limited / server trouble: forget this callsign so it's retried, and pause lookups
        if (/HTTP (429|5\d\d)/.test(String((e as Error).message))) {
          this.routeCache.delete(f.callsign);
          this.routeBackoffUntil = Date.now() + 120_000;
        }
      }
    };
    try {
      for (let i = 0; i < todo.length; i += 4) {
        if (Date.now() < this.routeBackoffUntil) {
          for (const f of todo.slice(i)) this.routeCache.delete(f.callsign);
          break;
        }
        await Promise.all(todo.slice(i, i + 4).map(one));
      }
    } finally {
      this.routeBusy = false;
    }
  }
}

export interface Metar { raw: string; wdir: number | null; wspd: number; visib?: string; temp?: number; altim?: number }

export async function fetchMetar(icao: string): Promise<Metar | null> {
  try {
    const j = await getJson<Array<{ rawOb: string; wdir: number | string; wspd: number; visib?: string | number; temp?: number; altim?: number }>>(`/api/awc/api/data/metar?ids=${icao}&format=json`);
    const m = j?.[0];
    if (!m) return null;
    return { raw: m.rawOb, wdir: typeof m.wdir === 'number' ? m.wdir : null, wspd: m.wspd ?? 0, visib: m.visib != null ? String(m.visib) : undefined, temp: m.temp, altim: m.altim };
  } catch (e) {
    console.warn('METAR unavailable', e);
    return null;
  }
}
