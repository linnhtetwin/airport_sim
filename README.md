# Airport Ops — 3D airport & ATC simulation

Run the **tower, ground and ramp** of a real airport, built in 3D from OpenStreetMap, with **live ADS-B traffic**.

- **ATC Simulation** — clear landings and takeoffs, approve runway crossings, taxi aircraft to stands and runways, send marshallers, dispatch fuel / catering / baggage / cleaning trucks, pushback tugs, follow-me cars and fire tenders. Real airlines currently operating at the airport fill the schedule.
- **Live Watch** — every real aircraft around the airport in 3D, with callsign, airline, type, registration, route, altitude, speed, vertical rate, squawk and flight phase.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:5173, pick an airport and a mode. Direct link: `http://localhost:5173/?icao=EGLL&mode=live`.

The first visit to an airport downloads its layout from OpenStreetMap (Overpass), which can take 30–90 s when the public servers are busy. After that it's cached in the browser for 30 days.

`npm run build` then `npm run preview` serves a production build. The API proxies in `vite.config.ts` are active in both `dev` and `preview`. If you host the `dist/` folder elsewhere, you need an equivalent proxy for `/api/adsb`, `/api/opensky`, `/api/fr24` and `/api/awc`.

## Data sources

| What | Source |
|---|---|
| Runways, taxiways, aprons, stands, terminals, jet bridges, tower | OpenStreetMap via Overpass API |
| Ground imagery | Esri World Imagery (satellite) or OpenStreetMap tiles |
| Live positions | adsb.lol (default, free) → OpenSky fallback → Flightradar24 (official API, your own key) |
| Flight routes (origin/destination) | adsbdb.com |
| Wind / active runway | aviationweather.gov METAR |

**Flightradar24:** FR24 only offers a paid API. Choose *Flightradar24 API* under *Options* on the start screen and paste your token. It's stored only in your browser's localStorage and sent only through the local proxy.

If OpenStreetMap can't be reached, the game generates a stand-in two-runway airport so it stays playable.

## License and attribution

The Airport Ops Simulator source code is licensed under the [MIT License](./LICENSE).
Third-party data and services are not covered by that license and remain subject to
their own terms. OpenStreetMap data is © OpenStreetMap contributors and is available
under the [Open Database License](https://www.openstreetmap.org/copyright).

## How to play (ATC Simulation)

Aircraft ask for clearances on the radio and in the flight strips (yellow = waiting). Select one and use the command panel. The highlighted button is the action it's asking for.

1. **Tower:** *Cleared to land* before ~1 nm final, or it goes around. *Cross runway*, *Line up & wait*, *Cleared for takeoff*.
2. **Ground:** *Taxi to stand* (or pick another stand first), *Follow-me car*, *Approve pushback*, *Taxi to runway*, *Hold position*.
3. **Ramp:** *Send marshaller* when the aircraft reaches its stand, then dispatch turnaround services. When the turnaround is done the aircraft becomes a departure and asks for pushback.
4. **Emergencies:** a MAYDAY call (squawk 7700) means *Alert fire services* before it lands.

Scoring: +100 per arrival on blocks and per departure, +10 per completed service. −50 for a go-around without clearance, −150 for clearing a landing onto an occupied runway, −250 for a runway incursion, plus a slow drain while aircraft wait more than a minute for you. In *Settings* you can hand Tower, Ground or Ramp to the computer and run just one position yourself.

### Keys

| Key | Action |
|---|---|
| `Tab` / `Enter` | next aircraft needing attention / do the requested action |
| `T` `O` `F` `R` | tower view (scroll = binoculars) / overview / follow / ramp view |
| `Space`, `1`–`4` | pause, sim speed 1×/2×/4×/8× |
| `N`, `L`, `Esc` | day/night, labels, deselect |
| `H` | hide / show all panels (clean map view) |

Each panel's **–** button minimises it to its title bar; **+** restores it. The layout is remembered between visits. Click the radar scope to change its range. Select a runway configuration (ARR / DEP) in the top bar.

## Code map

- `src/data/osm.ts` — Overpass download and parsing into an airport layout (merges split runways, multipolygons)
- `src/sim/taxiGraph.ts` — taxi network graph, stand detection, runway exits/entries, A* routing
- `src/sim/simulation.ts` — aircraft lifecycle, clearances, runway safety, turnarounds, scoring, auto-controllers
- `src/sim/vehicles.ts` — ground vehicle fleet with depots
- `src/live/liveTraffic.ts`, `src/data/flights.ts` — live feeds, dead reckoning, phase classification
- `src/world/*` — Three.js scene, tiles, airport meshes, procedural aircraft/vehicle models
- `src/ui/*` — start screen, HUD (strips, details, radio, FIDS), radar

This is a game. Don't use it for real-world navigation or ATC.
