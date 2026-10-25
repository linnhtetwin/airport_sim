export type SizeClass = 'light' | 'heli' | 'regional' | 'narrow' | 'wide' | 'jumbo';

export interface TypeSpec {
  code: string;
  name: string;
  size: SizeClass;
  length: number; // m
  span: number; // m
  engines: 2 | 4;
  tailEngines: boolean;
  vref: number; // approach speed, kt
  vr: number; // rotation speed, kt
}

const T = (code: string, name: string, size: SizeClass, length: number, span: number, engines: 2 | 4, vref: number, vr: number, tailEngines = false): TypeSpec =>
  ({ code, name, size, length, span, engines, vref, vr, tailEngines });

export const TYPES: Record<string, TypeSpec> = Object.fromEntries([
  T('C172', 'Cessna 172', 'light', 8.3, 11, 2, 65, 55),
  T('B407', 'Bell 407', 'heli', 12.7, 10.7, 2, 60, 0),
  T('E170', 'Embraer 170', 'regional', 29.9, 26, 2, 128, 123),
  T('CRJ9', 'Bombardier CRJ900', 'regional', 36.2, 24.9, 2, 140, 135, true),
  T('E75L', 'Embraer 175', 'regional', 31.7, 28.7, 2, 130, 125),
  T('E190', 'Embraer 190', 'regional', 36.2, 28.7, 2, 132, 128),
  T('E195', 'Embraer 195', 'regional', 38.7, 28.7, 2, 134, 130),
  T('E295', 'Embraer E195-E2', 'regional', 41.5, 35.1, 2, 136, 132),
  T('AT76', 'ATR 72-600', 'regional', 27.2, 27.1, 2, 110, 105),
  T('DH8D', 'Dash 8 Q400', 'regional', 32.8, 28.4, 2, 120, 115),
  T('A318', 'Airbus A318', 'narrow', 31.44, 34.1, 2, 130, 138),
  T('A319', 'Airbus A319', 'narrow', 33.8, 35.8, 2, 132, 140),
  T('A320', 'Airbus A320', 'narrow', 37.6, 35.8, 2, 136, 145),
  T('A20N', 'Airbus A320neo', 'narrow', 37.6, 35.8, 2, 136, 145),
  T('A321', 'Airbus A321', 'narrow', 44.5, 35.8, 2, 142, 150),
  T('A21N', 'Airbus A321neo', 'narrow', 44.5, 35.8, 2, 142, 150),
  T('BCS1', 'Airbus A220-100', 'narrow', 35, 35.1, 2, 130, 140),
  T('BCS3', 'Airbus A220-300', 'narrow', 38.7, 35.1, 2, 132, 142),
  T('B737', 'Boeing 737-700', 'narrow', 33.6, 35.8, 2, 130, 140),
  T('B738', 'Boeing 737-800', 'narrow', 39.5, 35.8, 2, 145, 150),
  T('B739', 'Boeing 737-900ER', 'narrow', 42.1, 35.8, 2, 145, 152),
  T('B38M', 'Boeing 737 MAX 8', 'narrow', 39.5, 35.9, 2, 145, 150),
  T('B39M', 'Boeing 737 MAX 9', 'narrow', 42.2, 35.9, 2, 147, 152),
  T('B752', 'Boeing 757-200', 'narrow', 47.3, 38.1, 2, 135, 145),
  T('B753', 'Boeing 757-300', 'narrow', 54.5, 38.1, 2, 138, 148),
  T('B763', 'Boeing 767-300', 'wide', 54.9, 47.6, 2, 140, 150),
  T('B764', 'Boeing 767-400ER', 'wide', 61.4, 51.9, 2, 143, 153),
  T('A338', 'Airbus A330-800neo', 'wide', 58.8, 64, 2, 138, 152),
  T('A332', 'Airbus A330-200', 'wide', 58.8, 60.3, 2, 137, 150),
  T('A333', 'Airbus A330-300', 'wide', 63.7, 60.3, 2, 138, 152),
  T('A339', 'Airbus A330-900', 'wide', 63.7, 64, 2, 138, 152),
  T('A343', 'Airbus A340-300', 'wide', 63.7, 60.3, 4, 140, 150),
  T('A346', 'Airbus A340-600', 'wide', 75.3, 63.45, 4, 145, 155),
  T('A359', 'Airbus A350-900', 'wide', 66.8, 64.8, 2, 140, 155),
  T('A35K', 'Airbus A350-1000', 'wide', 73.8, 64.8, 2, 145, 158),
  T('B788', 'Boeing 787-8', 'wide', 56.7, 60.1, 2, 140, 150),
  T('B789', 'Boeing 787-9', 'wide', 62.8, 60.1, 2, 145, 155),
  T('B78X', 'Boeing 787-10', 'wide', 68.3, 60.1, 2, 150, 158),
  T('B772', 'Boeing 777-200', 'wide', 63.7, 60.9, 2, 140, 155),
  T('B77L', 'Boeing 777-200LR', 'wide', 63.7, 64.8, 2, 145, 160),
  T('B77W', 'Boeing 777-300ER', 'wide', 73.9, 64.8, 2, 150, 165),
  T('B744', 'Boeing 747-400', 'jumbo', 70.7, 64.4, 4, 155, 165),
  T('B748', 'Boeing 747-8', 'jumbo', 76.3, 68.4, 4, 158, 168),
  T('A388', 'Airbus A380-800', 'jumbo', 72.7, 79.8, 4, 140, 155),
].map((t) => [t.code, t]));

/** Best-effort mapping of any ICAO type designator to one of our specs. */
export function typeSpec(code: string | undefined | null, category?: string): TypeSpec {
  const c = (code ?? '').toUpperCase();
  if (TYPES[c]) return TYPES[c];
  if (/^A38/.test(c)) return TYPES.A388;
  if (/^B74/.test(c)) return TYPES.B744;
  if (/^E17/.test(c)) return TYPES.E170;
  if (/^E19/.test(c)) return TYPES.E190;
  if (/^E29/.test(c)) return TYPES.E295;
  if (/^BCS1/.test(c)) return TYPES.BCS1;
  if (/^BCS3/.test(c)) return TYPES.BCS3;
  if (/^A318/.test(c)) return TYPES.A318;
  if (/^A346/.test(c)) return TYPES.A346;
  if (/^A343/.test(c)) return TYPES.A343;
  if (/^A338/.test(c)) return TYPES.A338;
  if (/^(B77|A35|A34)/.test(c)) return TYPES.B77W;
  if (/^(B78|A33|B76|A30|A31|MD11|IL96)/.test(c)) return TYPES.B789;
  if (/^(A32|A2|B73|B3|B75|MD8|MD9|C919|BCS|A22)/.test(c)) return TYPES.A320;
  if (/^(E1|E2|E7|E9|CRJ|AT|DH8|SF34|SU95|J328)/.test(c)) return TYPES.E190;
  if (category === 'A7' || /^(?:EC(?:20|30|35|45|55|65|75|155|175)|AS(?:32|35|50|55|65)|B0?6|B205|B206|B212|B214|B407|B412|B427|B429|B430|B47G|R22|R44|R66|S76|S92|A109|A119|A139|A169|A189|H(?:47|53|60|64|125|130|135|145|160|175|215|225|269|500)|UH1|AH64|CH47|CH53)/.test(c)) return TYPES.B407;
  if (/^(C1|C2|PA|SR2|DA4|BE|PC12|C5|C6|C7|LJ|GLF|GL|CL|FA|E5)/.test(c) || category === 'A1' || category === 'A2') return TYPES.C172;
  if (category === 'A5') return TYPES.B77W;
  if (category === 'A4') return TYPES.B752;
  return TYPES.A320;
}

/** Weighted pool used when generating simulated traffic. */
export const SIM_TYPE_POOL: Array<[string, number]> = [
  ['A320', 14], ['A20N', 8], ['A321', 9], ['A21N', 6], ['A319', 4], ['A318', 2], ['BCS3', 4], ['BCS1', 2],
  ['B738', 14], ['B38M', 6], ['B39M', 3], ['B739', 3], ['B737', 3], ['B752', 2], ['B753', 1],
  ['E190', 5], ['E195', 3], ['E75L', 3], ['E170', 2], ['E295', 2], ['B407', 2],
  ['B789', 6], ['B788', 3], ['B772', 2], ['B77L', 1], ['B77W', 5], ['B763', 2], ['B764', 1], ['B748', 1], ['B744', 1],
  ['A359', 5], ['A35K', 2], ['A333', 3], ['A332', 2], ['A339', 2], ['A338', 1], ['A343', 1], ['A346', 1], ['A388', 2],
];
