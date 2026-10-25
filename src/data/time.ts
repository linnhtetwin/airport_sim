/** Minutes east of UTC for an IANA time zone at a given moment (handles daylight saving). */
export function utcOffsetMinutes(tz: string, at = new Date()): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
    }).formatToParts(at);
    const v = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    const local = Date.UTC(v('year'), v('month') - 1, v('day'), v('hour'), v('minute'));
    return Math.round((local - Math.floor(at.getTime() / 60_000) * 60_000) / 60_000);
  } catch {
    return null;
  }
}

/**
 * A Date whose *local* getters (getHours etc.) show the wall-clock time at the airport.
 * The game uses these "shifted" dates for its clocks and boards.
 */
export function airportWallClock(offsetMin: number, at = Date.now()): Date {
  return new Date(at + new Date(at).getTimezoneOffset() * 60_000 + offsetMin * 60_000);
}
