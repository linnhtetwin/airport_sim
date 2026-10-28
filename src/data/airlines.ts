export interface AirlineInfo { name: string; tel: string; color: string; accent?: string }

// ICAO code -> display name, radio telephony, livery colours.
export const AIRLINES: Record<string, AirlineInfo> = {
  AAL: { name: 'American Airlines', tel: 'American', color: '#b6bcc3', accent: '#c8102e' },
  DAL: { name: 'Delta Air Lines', tel: 'Delta', color: '#0b2161', accent: '#c01933' },
  UAL: { name: 'United Airlines', tel: 'United', color: '#002244', accent: '#1b75bc' },
  SWA: { name: 'Southwest', tel: 'Southwest', color: '#304cb2', accent: '#ffbf27' },
  JBU: { name: 'JetBlue', tel: 'JetBlue', color: '#003876', accent: '#5aa0e6' },
  ASA: { name: 'Alaska Airlines', tel: 'Alaska', color: '#01426a', accent: '#48a9c5' },
  NKS: { name: 'Spirit', tel: 'Spirit Wings', color: '#ffe600', accent: '#222222' },
  FFT: { name: 'Frontier', tel: 'Frontier Flight', color: '#00843d', accent: '#ffffff' },
  EDV: { name: 'Endeavor Air', tel: 'Endeavor', color: '#0b2161', accent: '#c01933' },
  SKW: { name: 'SkyWest', tel: 'SkyWest', color: '#1f3b73', accent: '#9aa8bd' },
  ACA: { name: 'Air Canada', tel: 'Air Canada', color: '#111111', accent: '#d22630' },
  BAW: { name: 'British Airways', tel: 'Speedbird', color: '#1b2c5c', accent: '#d71920' },
  VIR: { name: 'Virgin Atlantic', tel: 'Virgin', color: '#da0530', accent: '#5b1a6e' },
  EZY: { name: 'easyJet', tel: 'Easy', color: '#ff6600', accent: '#ffffff' },
  RYR: { name: 'Ryanair', tel: 'Ryanair', color: '#073590', accent: '#f1c933' },
  EIN: { name: 'Aer Lingus', tel: 'Shamrock', color: '#00785b', accent: '#7ac143' },
  AFR: { name: 'Air France', tel: 'Air France', color: '#ffffff', accent: '#002157' },
  DLH: { name: 'Lufthansa', tel: 'Lufthansa', color: '#05164d', accent: '#ffad00' },
  CFG: { name: 'Condor', tel: 'Condor', color: '#ffcc00', accent: '#333333' },
  KLM: { name: 'KLM', tel: 'KLM', color: '#00a1de', accent: '#ffffff' },
  TRA: { name: 'Transavia', tel: 'Transavia', color: '#00d66c', accent: '#002a4d' },
  SWR: { name: 'Swiss', tel: 'Swiss', color: '#e2001a', accent: '#ffffff' },
  SAS: { name: 'Scandinavian', tel: 'Scandinavian', color: '#000a4d', accent: '#ffffff' },
  VLG: { name: 'Vueling', tel: 'Vueling', color: '#ffcc00', accent: '#555555' },
  THY: { name: 'Turkish Airlines', tel: 'Turkish', color: '#c70a0c', accent: '#ffffff' },
  UAE: { name: 'Emirates', tel: 'Emirates', color: '#d71921', accent: '#c8a656' },
  QTR: { name: 'Qatar Airways', tel: 'Qatari', color: '#5c0632', accent: '#a6a6a6' },
  ETD: { name: 'Etihad', tel: 'Etihad', color: '#bd8b13', accent: '#4a4a4a' },
  FDB: { name: 'flydubai', tel: 'Sky Dubai', color: '#1d3b6c', accent: '#f26522' },
  SVA: { name: 'Saudia', tel: 'Saudia', color: '#006c35', accent: '#c8a656' },
  PIA: { name: 'Pakistan Intl', tel: 'Pakistan', color: '#006a4e', accent: '#c8a656' },
  AIC: { name: 'Air India', tel: 'Air India', color: '#da0000', accent: '#ffb000' },
  SIA: { name: 'Singapore Airlines', tel: 'Singapore', color: '#1d2b5c', accent: '#f9a01b' },
  TGW: { name: 'Scoot', tel: 'Scooter', color: '#ffd400', accent: '#222222' },
  MAS: { name: 'Malaysia Airlines', tel: 'Malaysian', color: '#003a70', accent: '#e4002b' },
  GIA: { name: 'Garuda Indonesia', tel: 'Indonesia', color: '#00597c', accent: '#76b72a' },
  THA: { name: 'Thai Airways', tel: 'Thai', color: '#5c2483', accent: '#d4a017' },
  BKP: { name: 'Bangkok Airways', tel: 'Bangkok Air', color: '#0067b1', accent: '#e4007c' },
  AIQ: { name: 'Thai AirAsia', tel: 'Thai Asia', color: '#e00000', accent: '#ffffff' },
  UBA: { name: 'Myanmar National Airlines', tel: 'Unionair', color: '#c8102e', accent: '#ffcd00' },
  MMA: { name: 'Myanmar Airways Intl', tel: 'Myanmar', color: '#003b7a', accent: '#d4a017' },
  CPA: { name: 'Cathay Pacific', tel: 'Cathay', color: '#006564', accent: '#ffffff' },
  HKE: { name: 'HK Express', tel: 'Hongkong Shuttle', color: '#5f259f', accent: '#ffffff' },
  CES: { name: 'China Eastern', tel: 'China Eastern', color: '#0d2c6c', accent: '#c8102e' },
  CSN: { name: 'China Southern', tel: 'China Southern', color: '#0b6ab0', accent: '#d71920' },
  CCA: { name: 'Air China', tel: 'Air China', color: '#ffffff', accent: '#e30613' },
  EVA: { name: 'EVA Air', tel: 'Eva', color: '#00653b', accent: '#f39800' },
  JAL: { name: 'Japan Airlines', tel: 'Japan Air', color: '#ffffff', accent: '#cc0000' },
  ANA: { name: 'All Nippon Airways', tel: 'All Nippon', color: '#13448f', accent: '#00a0e9' },
  SKY: { name: 'Skymark', tel: 'Skymark', color: '#ffffff', accent: '#0068b7' },
  ADO: { name: 'Air Do', tel: 'Air Do', color: '#0090d0', accent: '#ffd400' },
  SFJ: { name: 'StarFlyer', tel: 'Starflyer', color: '#111111', accent: '#ffffff' },
  KAL: { name: 'Korean Air', tel: 'Korean Air', color: '#8cc8e8', accent: '#0d3a7c' },
  AAR: { name: 'Asiana', tel: 'Asiana', color: '#5d5d5d', accent: '#d0102b' },
  JJA: { name: 'Jeju Air', tel: 'Jeju Air', color: '#ff5000', accent: '#ffffff' },
  TWB: { name: 'T-way Air', tel: 'Teeway', color: '#d6001c', accent: '#ffffff' },
  QFA: { name: 'Qantas', tel: 'Qantas', color: '#e0001b', accent: '#ffffff' },
  JST: { name: 'Jetstar', tel: 'Jetstar', color: '#ff5f00', accent: '#1a1a1a' },
  VOZ: { name: 'Virgin Australia', tel: 'Velocity', color: '#e1112a', accent: '#5e2a84' },
  ANZ: { name: 'Air New Zealand', tel: 'New Zealand', color: '#111111', accent: '#ffffff' },
  FDX: { name: 'FedEx', tel: 'FedEx', color: '#4d148c', accent: '#ff6600' },
  UPS: { name: 'UPS', tel: 'UPS', color: '#351c15', accent: '#ffb500' },
  // more operators commonly seen in live traffic
  AVA: { name: 'Avianca', tel: 'Avianca', color: '#da291c', accent: '#ffffff' },
  ELY: { name: 'El Al', tel: 'El Al', color: '#0e2a6b', accent: '#ffffff' },
  BWA: { name: 'Caribbean Airlines', tel: 'Caribbean', color: '#0b4ea2', accent: '#f6b021' },
  AMX: { name: 'Aeromexico', tel: 'Aeromexico', color: '#0b2343', accent: '#e4002b' },
  CMP: { name: 'Copa Airlines', tel: 'Copa', color: '#0032a0', accent: '#c6a656' },
  LAN: { name: 'LATAM', tel: 'LAN', color: '#1b0088', accent: '#e8114b' },
  TAM: { name: 'LATAM Brasil', tel: 'TAM', color: '#1b0088', accent: '#e8114b' },
  ARG: { name: 'Aerolineas Argentinas', tel: 'Argentina', color: '#00a3e0', accent: '#ffffff' },
  IBE: { name: 'Iberia', tel: 'Iberia', color: '#d7192d', accent: '#ffcc00' },
  TAP: { name: 'TAP Air Portugal', tel: 'Air Portugal', color: '#00a19a', accent: '#e4002b' },
  ITY: { name: 'ITA Airways', tel: 'Itarrow', color: '#0c3c78', accent: '#00a3e0' },
  AUA: { name: 'Austrian', tel: 'Austrian', color: '#e30613', accent: '#ffffff' },
  BEL: { name: 'Brussels Airlines', tel: 'Bee-Line', color: '#002f6c', accent: '#e4002b' },
  LOT: { name: 'LOT Polish', tel: 'LOT', color: '#0c2340', accent: '#ffffff' },
  FIN: { name: 'Finnair', tel: 'Finnair', color: '#0b1560', accent: '#ffffff' },
  ICE: { name: 'Icelandair', tel: 'Iceair', color: '#002e5b', accent: '#f2a900' },
  NAX: { name: 'Norwegian', tel: 'Nor Shuttle', color: '#d81939', accent: '#ffffff' },
  WZZ: { name: 'Wizz Air', tel: 'Wizz Air', color: '#c6007e', accent: '#2e2a6b' },
  AEE: { name: 'Aegean', tel: 'Aegean', color: '#1a3b73', accent: '#7fbadc' },
  MSR: { name: 'EgyptAir', tel: 'Egyptair', color: '#0d2a5c', accent: '#c6a656' },
  RAM: { name: 'Royal Air Maroc', tel: 'Royal Air Maroc', color: '#c8102e', accent: '#00843d' },
  ETH: { name: 'Ethiopian', tel: 'Ethiopian', color: '#078930', accent: '#fcdd09' },
  KQA: { name: 'Kenya Airways', tel: 'Kenya', color: '#c8102e', accent: '#111111' },
  SAA: { name: 'South African', tel: 'Springbok', color: '#0a3161', accent: '#ffb612' },
  RJA: { name: 'Royal Jordanian', tel: 'Jordanian', color: '#1d1d1b', accent: '#c6a656' },
  GFA: { name: 'Gulf Air', tel: 'Gulf Air', color: '#8a7350', accent: '#d71920' },
  OMA: { name: 'Oman Air', tel: 'Oman Air', color: '#7a6a4f', accent: '#00796b' },
  KAC: { name: 'Kuwait Airways', tel: 'Kuwaiti', color: '#0c4da2', accent: '#ffffff' },
  IGO: { name: 'IndiGo', tel: 'Ifly', color: '#001b94', accent: '#ffffff' },
  CAL: { name: 'China Airlines', tel: 'Dynasty', color: '#1f2c5c', accent: '#e5007e' },
  CHH: { name: 'Hainan Airlines', tel: 'Hainan', color: '#c8102e', accent: '#f2a900' },
  CXA: { name: 'Xiamen Airlines', tel: 'Xiamen Air', color: '#0067b1', accent: '#ffffff' },
  HVN: { name: 'Vietnam Airlines', tel: 'Viet Nam Airlines', color: '#00616e', accent: '#c6a656' },
  VJC: { name: 'VietJet', tel: 'Vietjet', color: '#e4002b', accent: '#ffd400' },
  PAL: { name: 'Philippine Airlines', tel: 'Philippine', color: '#0033a0', accent: '#e4002b' },
  CEB: { name: 'Cebu Pacific', tel: 'Cebu', color: '#ffd200', accent: '#00a0dc' },
  AXM: { name: 'AirAsia', tel: 'Red Cap', color: '#e00000', accent: '#ffffff' },
  WJA: { name: 'WestJet', tel: 'Westjet', color: '#00285f', accent: '#00a7b5' },
  HAL: { name: 'Hawaiian Airlines', tel: 'Hawaiian', color: '#4a1f6b', accent: '#e4007c' },
  AAY: { name: 'Allegiant', tel: 'Allegiant', color: '#f2a900', accent: '#0b3d91' },
  SCX: { name: 'Sun Country', tel: 'Sun Country', color: '#f68b1f', accent: '#0b2240' },
  RPA: { name: 'Republic Airways', tel: 'Brickyard', color: '#1b2a4a', accent: '#c8102e' },
  ENY: { name: 'Envoy', tel: 'Envoy', color: '#b6bcc3', accent: '#c8102e' },
  PDT: { name: 'Piedmont', tel: 'Piedmont', color: '#b6bcc3', accent: '#c8102e' },
  JIA: { name: 'PSA Airlines', tel: 'Blue Streak', color: '#b6bcc3', accent: '#c8102e' },
  GJS: { name: 'GoJet', tel: 'Lindbergh', color: '#002244', accent: '#1b75bc' },
  ASH: { name: 'Mesa', tel: 'Air Shuttle', color: '#002244', accent: '#1b75bc' },
  QXE: { name: 'Horizon', tel: 'Horizon', color: '#01426a', accent: '#48a9c5' },
  JZA: { name: 'Jazz', tel: 'Jazz', color: '#111111', accent: '#d22630' },
  GTI: { name: 'Atlas Air', tel: 'Giant', color: '#1b3a6b', accent: '#ffffff' },
  CLX: { name: 'Cargolux', tel: 'Cargolux', color: '#e4002b', accent: '#5b6770' },
  ABX: { name: 'ABX Air', tel: 'Abex', color: '#ffffff', accent: '#0b3d91' },
  DHK: { name: 'DHL Air', tel: 'World Express', color: '#ffcc00', accent: '#d40511' },
  BOX: { name: 'AeroLogic', tel: 'German Cargo', color: '#ffcc00', accent: '#d40511' },
  CKS: { name: 'Kalitta Air', tel: 'Connie', color: '#c8102e', accent: '#ffffff' },
};

export function airlineOf(callsign: string): string | null {
  const m = /^([A-Z]{3})\d/.exec(callsign.trim().toUpperCase());
  return m ? m[1] : null;
}

const DIGITS = ['zero', 'one', 'two', 'three', 'four', 'fife', 'six', 'seven', 'eight', 'niner'];

/** Radio telephony for a callsign, e.g. "BAW117" -> "Speedbird 117". */
export function telephony(callsign: string): string {
  const cs = callsign.trim().toUpperCase();
  const code = airlineOf(cs);
  if (code && AIRLINES[code]) return `${AIRLINES[code].tel} ${cs.slice(3)}`;
  return cs;
}

// ICAO spelling alphabet (Alpha/Juliet rather than ICAO's Alfa/Juliett, so speech engines say them right)
const PHONETIC = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliet', 'Kilo', 'Lima', 'Mike',
  'November', 'Oscar', 'Papa', 'Quebec', 'Romeo', 'Sierra', 'Tango', 'Uniform', 'Victor', 'Whiskey', 'X-ray', 'Yankee', 'Zulu'];
const RUNWAY_SIDE: Record<string, string> = { L: 'left', R: 'right', C: 'center' };

const spell = (code: string) => code.replace(/[A-Z]/g, (c) => ` ${PHONETIC[c.charCodeAt(0) - 65]} `);

/**
 * Version for text-to-speech: digits read out one by one, runway sides as left/right/center,
 * and taxiways, stands, helipads and registrations in the spelling alphabet ("A3" -> "Alpha
 * three"). Airline callsigns are read as their telephony ("BAW117" -> "Speedbird 117"), and
 * the message's own callsign, when it is a registration, spelled out.
 */
export function spokenText(text: string, callsign?: string): string {
  const cs = callsign?.trim().toUpperCase();
  const s = text.replace(/\b[A-Z]{3}\d[A-Z0-9]*\b/g, telephony).replace(/\b[A-Z0-9]+\b/g, (w) => {
    const rwy = /^(\d{2})([LRC])$/.exec(w);
    if (rwy) return `${rwy[1]} ${RUNWAY_SIDE[rwy[2]]}`;
    // letters with digits (taxiway B3, stand A12), lone letters (taxiway K), or a registration
    if (/\d/.test(w) && /[A-Z]/.test(w) || /^[A-Z]{1,2}$/.test(w) || w === cs) return spell(w);
    return w;
  });
  return s.replace(/\d/g, (d) => ` ${DIGITS[+d]} `).replace(/\s+/g, ' ').replace(/ ([,:])/g, '$1').trim();
}

export function airlineColors(code: string | null): { body: string; tail: string; accent: string } {
  const a = code ? AIRLINES[code] : undefined;
  if (!a) {
    // deterministic tail colour for unknown operators
    let h = 0;
    for (const ch of code ?? 'GA') h = (h * 31 + ch.charCodeAt(0)) % 360;
    return { body: '#f2f4f7', tail: `hsl(${h}, 55%, 40%)`, accent: '#888888' };
  }
  const tail = a.color === '#ffffff' ? a.accent ?? '#333333' : a.color;
  return { body: '#f2f4f7', tail, accent: a.accent ?? '#888888' };
}
