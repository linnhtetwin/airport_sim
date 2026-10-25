export interface AirportPreset {
  icao: string;
  iata: string;
  name: string;
  city: string;
  lat: number;
  lon: number;
  /** IANA time zone, for the airport's local clock. */
  tz: string;
  /** Name the tower uses on the radio, e.g. "Kennedy". */
  radio: string;
  airlines: string[];
}

export const AIRPORTS: AirportPreset[] = [
  { icao: 'KJFK', tz: 'America/New_York', iata: 'JFK', name: 'John F. Kennedy Intl', city: 'New York', lat: 40.6413, lon: -73.7781, radio: 'Kennedy', airlines: ['DAL', 'JBU', 'AAL', 'BAW', 'UAE', 'AFR', 'DLH', 'KAL', 'QTR', 'VIR', 'SWR', 'JAL'] },
  { icao: 'EGLL', tz: 'Europe/London', iata: 'LHR', name: 'London Heathrow', city: 'London', lat: 51.47, lon: -0.4543, radio: 'Heathrow', airlines: ['BAW', 'VIR', 'AAL', 'UAE', 'QTR', 'DLH', 'AFR', 'KLM', 'SIA', 'EIN', 'UAL', 'CPA'] },
  { icao: 'RJTT', tz: 'Asia/Tokyo', iata: 'HND', name: 'Tokyo Haneda', city: 'Tokyo', lat: 35.5494, lon: 139.7798, radio: 'Tokyo', airlines: ['JAL', 'ANA', 'SKY', 'ADO', 'SFJ', 'DAL', 'UAL', 'BAW', 'SIA'] },
  { icao: 'WSSS', tz: 'Asia/Singapore', iata: 'SIN', name: 'Singapore Changi', city: 'Singapore', lat: 1.3644, lon: 103.9915, radio: 'Changi', airlines: ['SIA', 'TGW', 'QFA', 'CPA', 'THA', 'MAS', 'GIA', 'UAE', 'JST'] },
  { icao: 'VTBS', tz: 'Asia/Bangkok', iata: 'BKK', name: 'Suvarnabhumi', city: 'Bangkok', lat: 13.69, lon: 100.7501, radio: 'Suvarnabhumi', airlines: ['THA', 'BKP', 'AIQ', 'SIA', 'CPA', 'UAE', 'MAS', 'QTR', 'JAL'] },
  { icao: 'VYYY', tz: 'Asia/Yangon', iata: 'RGN', name: 'Yangon Intl', city: 'Yangon', lat: 16.9073, lon: 96.1332, radio: 'Yangon', airlines: ['UBA', 'MMA', 'THA', 'BKP', 'SIA', 'MAS', 'AIQ', 'CES'] },
  { icao: 'VHHH', tz: 'Asia/Hong_Kong', iata: 'HKG', name: 'Hong Kong Intl', city: 'Hong Kong', lat: 22.308, lon: 113.9185, radio: 'Hong Kong', airlines: ['CPA', 'HKE', 'SIA', 'UAE', 'CES', 'CSN', 'JAL', 'KAL', 'EVA'] },
  { icao: 'OMDB', tz: 'Asia/Dubai', iata: 'DXB', name: 'Dubai Intl', city: 'Dubai', lat: 25.2532, lon: 55.3657, radio: 'Dubai', airlines: ['UAE', 'FDB', 'QTR', 'SVA', 'PIA', 'BAW', 'AIC', 'THY'] },
  { icao: 'KSFO', tz: 'America/Los_Angeles', iata: 'SFO', name: 'San Francisco Intl', city: 'San Francisco', lat: 37.6213, lon: -122.379, radio: 'San Francisco', airlines: ['UAL', 'ASA', 'DAL', 'AAL', 'SWA', 'JAL', 'ANA', 'SIA', 'EVA', 'CPA'] },
  { icao: 'KLAX', tz: 'America/Los_Angeles', iata: 'LAX', name: 'Los Angeles Intl', city: 'Los Angeles', lat: 33.9416, lon: -118.4085, radio: 'Los Angeles', airlines: ['AAL', 'DAL', 'UAL', 'SWA', 'ASA', 'QFA', 'KAL', 'JAL', 'ANA'] },
  { icao: 'KATL', tz: 'America/New_York', iata: 'ATL', name: 'Hartsfield-Jackson', city: 'Atlanta', lat: 33.6407, lon: -84.4277, radio: 'Atlanta', airlines: ['DAL', 'SWA', 'AAL', 'UAL', 'NKS', 'FFT', 'EDV'] },
  { icao: 'LFPG', tz: 'Europe/Paris', iata: 'CDG', name: 'Paris Charles de Gaulle', city: 'Paris', lat: 49.0097, lon: 2.5479, radio: 'De Gaulle', airlines: ['AFR', 'EZY', 'DLH', 'KLM', 'UAE', 'DAL', 'VLG', 'THY'] },
  { icao: 'EHAM', tz: 'Europe/Amsterdam', iata: 'AMS', name: 'Amsterdam Schiphol', city: 'Amsterdam', lat: 52.3105, lon: 4.7683, radio: 'Schiphol', airlines: ['KLM', 'TRA', 'EZY', 'DAL', 'BAW', 'DLH', 'SAS'] },
  { icao: 'EDDF', tz: 'Europe/Berlin', iata: 'FRA', name: 'Frankfurt am Main', city: 'Frankfurt', lat: 50.0379, lon: 8.5622, radio: 'Frankfurt', airlines: ['DLH', 'CFG', 'UAE', 'UAL', 'THY', 'SIA', 'ANA'] },
  { icao: 'RKSI', tz: 'Asia/Seoul', iata: 'ICN', name: 'Incheon Intl', city: 'Seoul', lat: 37.4602, lon: 126.4407, radio: 'Incheon', airlines: ['KAL', 'AAR', 'JJA', 'TWB', 'DAL', 'JAL', 'CPA'] },
  { icao: 'YSSY', tz: 'Australia/Sydney', iata: 'SYD', name: 'Sydney Kingsford Smith', city: 'Sydney', lat: -33.9399, lon: 151.1753, radio: 'Sydney', airlines: ['QFA', 'VOZ', 'JST', 'UAE', 'SIA', 'ANZ'] },
];

export const DEFAULT_AIRLINES = ['UAE', 'DLH', 'BAW', 'SIA', 'QTR', 'THY', 'AFR', 'KLM'];
