// IATA airport code -> city name, as shown on departure boards.
export const CITY: Record<string, string> = {
  LHR: 'London', LGW: 'London Gatwick', STN: 'London Stansted', CDG: 'Paris', ORY: 'Paris Orly', FRA: 'Frankfurt', MUC: 'Munich',
  AMS: 'Amsterdam', BRU: 'Brussels', ZRH: 'Zurich', GVA: 'Geneva', VIE: 'Vienna', CPH: 'Copenhagen', ARN: 'Stockholm', OSL: 'Oslo',
  HEL: 'Helsinki', DUB: 'Dublin', LIS: 'Lisbon', MAD: 'Madrid', BCN: 'Barcelona', FCO: 'Rome', MXP: 'Milan', ATH: 'Athens',
  IST: 'Istanbul', WAW: 'Warsaw', PRG: 'Prague', BUD: 'Budapest', KEF: 'Reykjavik', MAN: 'Manchester', EDI: 'Edinburgh',
  DXB: 'Dubai', DOH: 'Doha', AUH: 'Abu Dhabi', RUH: 'Riyadh', JED: 'Jeddah', TLV: 'Tel Aviv', CAI: 'Cairo', AMM: 'Amman',
  BAH: 'Bahrain', MCT: 'Muscat', KWI: 'Kuwait', DEL: 'Delhi', BOM: 'Mumbai', BLR: 'Bengaluru', MAA: 'Chennai', CMB: 'Colombo',
  KTM: 'Kathmandu', DAC: 'Dhaka', SIN: 'Singapore', KUL: 'Kuala Lumpur', BKK: 'Bangkok', DMK: 'Bangkok Don Mueang', HKT: 'Phuket',
  CNX: 'Chiang Mai', CGK: 'Jakarta', DPS: 'Bali', MNL: 'Manila', SGN: 'Ho Chi Minh', HAN: 'Hanoi', RGN: 'Yangon',
  MDL: 'Mandalay', NPT: 'Nay Pyi Taw', HKG: 'Hong Kong', TPE: 'Taipei', PEK: 'Beijing', PKX: 'Beijing Daxing', PVG: 'Shanghai',
  CAN: 'Guangzhou', SZX: 'Shenzhen', CTU: 'Chengdu', NRT: 'Tokyo Narita', HND: 'Tokyo Haneda', KIX: 'Osaka', ICN: 'Seoul',
  GMP: 'Seoul Gimpo', SYD: 'Sydney', MEL: 'Melbourne', BNE: 'Brisbane', PER: 'Perth', AKL: 'Auckland', JFK: 'New York JFK',
  EWR: 'Newark', LGA: 'New York LGA', BOS: 'Boston', IAD: 'Washington', DCA: 'Washington DCA', PHL: 'Philadelphia',
  ORD: 'Chicago', ATL: 'Atlanta', MIA: 'Miami', MCO: 'Orlando', FLL: 'Fort Lauderdale', DFW: 'Dallas', IAH: 'Houston',
  DEN: 'Denver', LAS: 'Las Vegas', LAX: 'Los Angeles', SFO: 'San Francisco', SEA: 'Seattle', PHX: 'Phoenix', MSP: 'Minneapolis',
  DTW: 'Detroit', CLT: 'Charlotte', SAN: 'San Diego', HNL: 'Honolulu', YYZ: 'Toronto', YVR: 'Vancouver', YUL: 'Montreal',
  MEX: 'Mexico City', CUN: 'Cancun', BOG: 'Bogota', LIM: 'Lima', SCL: 'Santiago', GRU: 'Sao Paulo', GIG: 'Rio de Janeiro',
  EZE: 'Buenos Aires', PTY: 'Panama City', JNB: 'Johannesburg', CPT: 'Cape Town', NBO: 'Nairobi', ADD: 'Addis Ababa',
  LOS: 'Lagos', CMN: 'Casablanca', RSW: 'Fort Myers',
};

export const cityOf = (iata?: string | null, fallback?: string) => (iata && CITY[iata]) || fallback || iata || '';
