// FlightAware AeroAPI: the airport's schedule board (recent and upcoming arrivals and
// departures). ADS-B stays the source of positions; this adds what ADS-B can't know:
// confirmed routes, gates, terminals, scheduled/estimated/actual times, delays and status.
// Requests go through /api/flightaware (Pages Function or dev proxy), which uses the player's
// own key or the site key; see functions/api/[[path]].ts.

export interface FaAirport { icao?: string; iata?: string; city?: string; name?: string; tz?: string }

export interface FaFlight {
  id: string;
  ident: string; // as FlightAware shows it, e.g. "BAW117"
  identIcao?: string;
  identIata?: string; // e.g. "BA117" (what boards show)
  atcIdent?: string;
  kind: 'ARR' | 'DEP';
  origin: FaAirport;
  dest: FaAirport;
  gateOrigin?: string;
  gateDest?: string;
  terminalOrigin?: string;
  terminalDest?: string;
  baggage?: string;
  // epoch ms (null when unknown): gate out, runway off, runway on, gate in
  sOut: number | null; eOut: number | null; aOut: number | null;
  aOff: number | null;
  aOn: number | null;
  sIn: number | null; eIn: number | null; aIn: number | null;
  status: string;
  aircraftType?: string;
  registration?: string;
  progress?: number;
  cancelled: boolean;
  diverted: boolean;
  depDelay: number; // seconds
  arrDelay: number;
}

export interface FaBoard { fetchedAt: number; tz?: string; flights: FaFlight[] }

interface RawAirport { code?: string; code_icao?: string; code_iata?: string; city?: string; name?: string; timezone?: string }
interface RawFlight {
  fa_flight_id: string; ident: string; ident_icao?: string; ident_iata?: string; atc_ident?: string;
  origin?: RawAirport | null; destination?: RawAirport | null;
  gate_origin?: string | null; gate_destination?: string | null; terminal_origin?: string | null; terminal_destination?: string | null;
  baggage_claim?: string | null;
  scheduled_out?: string | null; estimated_out?: string | null; actual_out?: string | null;
  actual_off?: string | null; actual_on?: string | null;
  scheduled_in?: string | null; estimated_in?: string | null; actual_in?: string | null;
  status?: string; aircraft_type?: string | null; registration?: string | null; progress_percent?: number | null;
  cancelled?: boolean; diverted?: boolean; departure_delay?: number | null; arrival_delay?: number | null;
}
interface RawBoard { arrivals?: RawFlight[]; departures?: RawFlight[]; scheduled_arrivals?: RawFlight[]; scheduled_departures?: RawFlight[] }

const t = (s?: string | null) => (s ? Date.parse(s) || null : null);
const apt = (a?: RawAirport | null): FaAirport => ({ icao: a?.code_icao ?? a?.code, iata: a?.code_iata, city: a?.city, name: a?.name, tz: a?.timezone });

function normalize(f: RawFlight, kind: 'ARR' | 'DEP'): FaFlight {
  return {
    id: f.fa_flight_id,
    ident: f.ident,
    identIcao: f.ident_icao,
    identIata: f.ident_iata,
    atcIdent: f.atc_ident,
    kind,
    origin: apt(f.origin),
    dest: apt(f.destination),
    gateOrigin: f.gate_origin ?? undefined,
    gateDest: f.gate_destination ?? undefined,
    terminalOrigin: f.terminal_origin ?? undefined,
    terminalDest: f.terminal_destination ?? undefined,
    baggage: f.baggage_claim ?? undefined,
    sOut: t(f.scheduled_out), eOut: t(f.estimated_out), aOut: t(f.actual_out),
    aOff: t(f.actual_off), aOn: t(f.actual_on),
    sIn: t(f.scheduled_in), eIn: t(f.estimated_in), aIn: t(f.actual_in),
    status: f.status ?? '',
    aircraftType: f.aircraft_type ?? undefined,
    registration: f.registration ?? undefined,
    progress: f.progress_percent ?? undefined,
    cancelled: !!f.cancelled,
    diverted: !!f.diverted,
    depDelay: f.departure_delay ?? 0,
    arrDelay: f.arrival_delay ?? 0,
  };
}

/** "HH:MM" in an IANA time zone (falls back to the browser's zone). */
export function fmtTime(ms: number | null | undefined, tz?: string): string {
  if (!ms) return '';
  try {
    return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(ms);
  } catch {
    return new Date(ms).toTimeString().slice(0, 5);
  }
}

export class FlightAwareFeed {
  board: FaBoard | null = null;
  /** False once FlightAware turns out not to be configured or the key is rejected. */
  enabled = true;
  lastError = '';
  keySource: 'player' | 'site' | null = null;
  private index = new Map<string, FaFlight[]>();
  private backoffUntil = 0;

  constructor(public icao: string, public key = '') {}

  /** Seconds between refreshes: each call is billed, so stay modest (the site key is edge-cached 10 min). */
  get interval() { return this.key ? 300 : 600; }

  async refresh(): Promise<FaBoard | null> {
    if (!this.enabled || Date.now() < this.backoffUntil) return this.board;
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 25_000);
      const res = await fetch(`/api/flightaware/aeroapi/airports/${encodeURIComponent(this.icao)}/flights`, {
        headers: this.key ? { 'x-apikey': this.key, Accept: 'application/json' } : { Accept: 'application/json' },
        signal: ctl.signal,
      });
      clearTimeout(timer);
      if ([400, 401, 403, 404, 503].includes(res.status)) {
        // not configured, bad key, or airport unknown to FlightAware: stop asking
        this.enabled = false;
        this.lastError = res.status === 503 ? 'not configured' : res.status === 401 || res.status === 403 ? 'key rejected' : `HTTP ${res.status}`;
        return null;
      }
      if (!res.ok) {
        this.backoffUntil = Date.now() + 120_000;
        throw new Error(`HTTP ${res.status}`);
      }
      this.keySource = res.headers.get('X-FlightAware-Key') === 'player' ? 'player' : this.key ? 'player' : 'site';
      const raw = (await res.json()) as RawBoard;
      const flights = [
        ...(raw.arrivals ?? []).map((f) => normalize(f, 'ARR')),
        ...(raw.scheduled_arrivals ?? []).map((f) => normalize(f, 'ARR')),
        ...(raw.departures ?? []).map((f) => normalize(f, 'DEP')),
        ...(raw.scheduled_departures ?? []).map((f) => normalize(f, 'DEP')),
      ];
      const tz = flights.find((f) => f.kind === 'DEP')?.origin.tz ?? flights.find((f) => f.kind === 'ARR')?.dest.tz;
      this.board = { fetchedAt: Date.now(), tz, flights };
      this.index.clear();
      for (const f of flights) {
        for (const k of new Set([f.identIcao, f.atcIdent, f.ident].filter((x): x is string => !!x).map((x) => x.toUpperCase()))) {
          const list = this.index.get(k) ?? [];
          list.push(f);
          this.index.set(k, list);
        }
      }
      this.lastError = '';
      return this.board;
    } catch (e) {
      this.lastError = (e as Error).message;
      console.warn('FlightAware refresh failed', e);
      return this.board;
    }
  }

  /** The schedule entry for a callsign seen on ADS-B (the one closest to now if it repeats). */
  byCallsign(callsign: string): FaFlight | undefined {
    const list = this.index.get(callsign.trim().toUpperCase());
    if (!list?.length) return undefined;
    const now = Date.now();
    const when = (f: FaFlight) => (f.kind === 'DEP' ? f.aOut ?? f.eOut ?? f.sOut : f.aIn ?? f.eIn ?? f.sIn) ?? now;
    return list.reduce((a, b) => (Math.abs(when(b) - now) < Math.abs(when(a) - now) ? b : a));
  }
}
