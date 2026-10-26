# Airport Ops — 3D airport & ATC simulation

Run the **tower, ground and ramp** of a real airport, built in 3D from OpenStreetMap, with **live ADS-B traffic**.

**Play online:** https://airport-ops-sim.pages.dev/ · **What's new:** see the [changelog](./CHANGELOG.md).

- **ATC Simulation** — clear landings and takeoffs, approve runway crossings, taxi aircraft to stands and runways, send marshallers, dispatch fuel / catering / baggage / cleaning trucks, pushback tugs, follow-me cars and fire tenders. Real airlines currently operating at the airport fill the schedule, and with FlightAware the airport runs today's real timetable.
- **Live Watch** — every real aircraft around the airport in 3D, with callsign, airline, type, registration, route, altitude, speed, vertical rate, squawk, heading and flight phase, plus a live log of real landings, departures, approaches and emergency squawks.
- **3D models** — glTF airliners (A320, B737, B757, B767, B787, A350, A380, E-Jets, CRJs) tinted in airline colours, a Cessna 172 for light aircraft, a Bell JetRanger for helicopters, and real ground-service vehicles.
- **Real local time** — clocks, logs and the split-flap FIDS board use the airport's own time zone.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:5173, pick an airport and a mode. Direct link: `http://localhost:5173/?icao=EGLL&mode=live`.

Airport layouts come from OpenStreetMap. The 16 preset airports ship with the game (`public/airports/`), so they open in a second or two. Any other airport is fetched by the game's own `/api/airport/<ICAO>` endpoint, which queries the public Overpass servers. The first time anyone opens that airport this can take 30–90 s, because those servers are often busy. After that the game's server keeps a copy for every player (see below), and each browser also caches it for 30 days. The loading screen shows each step and the download progress.

### Updating the bundled airport layouts

```bash
npm run airports
```

This downloads the preset airports again from OpenStreetMap into `public/airports/<ICAO>.json`, one at a time (about 30–60 s each, with retries when the servers are busy). `npm run airports -- EGLL KJFK` updates just those airports. Run it now and then to pick up map edits, and after adding a preset to `src/data/airports.ts`. It needs Node 22.18 or newer.

`npm run build` then `npm run preview` serves a production build. The API proxies in `vite.config.ts` are active in both `dev` and `preview`.

### Deploying to Cloudflare Pages

```bash
npm run cf:deploy
```

Live traffic and weather APIs don't allow direct browser access, and the public OpenStreetMap (Overpass) servers are slow and reject some site origins. So in production these go through a Pages Function, [`functions/api/[[path]].ts`](functions/api/[[path]].ts). It serves the same `/api/adsb`, `/api/opensky`, `/api/fr24`, `/api/awc`, `/api/adsbdb`, `/api/flightaware` and `/api/airport` paths as the dev server. It accepts only GET requests to an allowlist of upstream endpoints, so it can't be used as an open proxy. Free feeds are cached at the edge for a few seconds (METAR for 5 minutes, flight routes for 6 hours). Flightradar24 requests carry the player's own key and are never cached.

`/api/airport/<ICAO>` builds the OpenStreetMap query itself from the ICAO code, so a request can't store anything except that airport's real layout. It keeps one copy per airport for 30 days, which every player then gets at once. Unknown codes are remembered for a day. To share that copy worldwide, bind a KV namespace:

```bash
npx wrangler kv namespace create airport-layouts
```

Then, in the Cloudflare dashboard, open the Pages project → *Settings* → *Bindings* → *Add* → *KV namespace*, use the variable name `AIRPORT_LAYOUTS` and pick that namespace, for both Production and Preview. Redeploy afterwards. Without the binding the endpoint still works, but each Cloudflare data centre keeps its own copy for a day only, so players in other regions may wait again.

`npm run cf:dev` runs the built site plus the function locally with wrangler (http://localhost:8788), with a local `AIRPORT_LAYOUTS` namespace. If you host `dist/` somewhere other than Cloudflare, you need an equivalent proxy for those paths.

## How to play (ATC Simulation)

Aircraft ask for clearances on the radio and in the flight strips (yellow = waiting). Select one and use the command panel. It only shows the actions that are possible right now, and the highlighted button is the action the aircraft is asking for.

1. **Tower:** *Cleared to land* before ~1 nm final, or it goes around. *Cross runway*, *Line up & wait*, *Cleared for takeoff*.
2. **Ground:** *Taxi to stand* (or pick another stand first), *Follow-me car*, *Approve pushback*, *Taxi to runway*, *Hold position*.
3. **Ramp:** *Send marshaller* when the aircraft reaches its stand, then dispatch turnaround services. When the turnaround is done the aircraft becomes a departure and asks for pushback.
4. **Emergencies:** a MAYDAY call (squawk 7700) means *Alert fire services* before it lands.

Scoring: +100 per arrival on blocks and per departure, +10 per completed service. −50 for a go-around without clearance, −150 for clearing a landing onto an occupied runway, −250 for a runway incursion, plus a slow drain while aircraft wait more than a minute for you. In *Settings* you can hand Tower, Ground or Ramp to the computer and run just one position yourself.

### Keys

| Key | Action |
|---|---|
| `Tab` / `Enter` | next aircraft needing attention / do the requested action |
| Double-click a strip | follow that flight with the camera |
| `T` `O` `F` `R` | tower view (scroll = binoculars) / overview / follow / ramp view |
| `Space`, `1`–`4` | pause, sim speed 1×/2×/4×/8× |
| `N`, `L`, `Esc` | day/night, labels, deselect |
| `H` | hide / show all panels (clean map view) |

Each panel's **–** button minimises it to its title bar; **+** restores it. The layout is remembered between visits. Click the radar scope to change its range. Select a runway configuration (ARR / DEP) in the top bar.

## Live Watch

**Live Watch only shows the real world.** The simulation pauses while you're in Live Watch, and its radio calls, alerts and emergencies never appear there. Each mode keeps its own log.

- The **LIVE EVENTS** log lists real events detected from ADS-B data: landings and departures (with the runway used), aircraft joining the approach, and emergency squawks (7700 / 7600 / 7500).
- The **🎧 Real ATC audio** button opens the airport's real tower and ground feeds on LiveATC.net.
- Aircraft are drawn along their true heading when the feed provides it, otherwise along their ground track. Parked aircraft line up with their stand.

## Data sources

| What | Source |
|---|---|
| Runways, taxiways, aprons, stands, terminals, jet bridges, tower | OpenStreetMap via Overpass API |
| Ground imagery | Esri World Imagery (satellite) or OpenStreetMap tiles |
| Live positions | adsb.lol (default, free) → OpenSky fallback → Flightradar24 (official API, your own key) |
| Flight routes (origin/destination) | adsbdb.com, or FlightAware when enabled |
| Schedules, gates, delays (optional) | FlightAware AeroAPI |
| Wind / active runway | aviationweather.gov METAR |

**Flightradar24:** FR24 only offers a paid API. Choose *Flightradar24 API* under *Options* on the start screen and paste your token. It's stored only in your browser's localStorage and is sent only through the game's own proxy (the dev server, or the Pages Function when deployed).

### FlightAware (optional, more precise flight data)

ADS-B gives exact positions but has to guess everything else. FlightAware's [AeroAPI](https://www.flightaware.com/aeroapi/) adds the airport's real schedule: confirmed routes, gates, terminals, scheduled/estimated/actual times, delays, cancellations and diversions. With it on:

- **Live Watch:** flight details show departure and arrival times (in each airport's own time zone), gates, delay and route progress. The FIDS board shows the airport's real departures and arrivals.
- **ATC Simulation:** upcoming real flights become the planned arrivals, and real departures are given to aircraft parked on the ramp, at their real times.

AeroAPI is paid per query, so there are two ways to switch it on:

- **Player key:** paste your own key under *Options → FlightAware AeroAPI key* on the start screen. It's stored only in your browser and forwarded as-is, never shared or cached. The game refreshes at most every 5 minutes.
- **Site key (every player gets it):** store your key as a Cloudflare secret:

  ```bash
  npx wrangler pages secret put FLIGHTAWARE_API_KEY --project-name airport-ops-sim
  ```

  The site key can only fetch one page of an airport's schedule board, and each answer is cached at the edge for 10 minutes per airport. Cost therefore depends on how many airports are in use, at most about 6 queries per airport per hour, not on the number of players.

For local testing put `FLIGHTAWARE_API_KEY=...` in `.env.local` (for `npm run dev`) or `.dev.vars` (for `npm run cf:dev`). Both are git-ignored. Without any key the game just carries on with ADS-B data.

If OpenStreetMap can't be reached, the game generates a stand-in two-runway airport so it stays playable.

## Privacy

The deployed site uses Google Analytics with Consent Mode v2. No analytics cookies are set unless the player accepts the cookie banner, and ad signals are always denied (the game has no ads). The choice can be changed at any time from *Cookie settings* on the start screen or *Settings → Privacy*; declining also removes earlier GA cookies. API keys you enter stay in your browser's localStorage. If you host your own copy, remove or replace the `gtag` snippet in `index.html`.

## Code map

- `src/data/osm.ts` — loads an airport layout (browser cache → bundled file → `/api/airport` → public Overpass servers) and parses it (merges split runways, multipolygons)
- `src/data/airportSource.ts` — the Overpass queries and server-side download, shared by the game, the Pages Function, the dev server and the update script
- `scripts/update-airports.mjs`, `public/airports/*` — prebuilt layouts for the preset airports
- `src/data/flightaware.ts` — FlightAware AeroAPI schedule feed
- `src/data/time.ts` — airport time zones and local wall-clock time
- `src/sim/taxiGraph.ts` — taxi network graph, stand detection and parking headings, runway exits/entries, A* routing
- `src/sim/simulation.ts` — aircraft lifecycle, clearances, runway safety, turnarounds, real schedules, scoring, auto-controllers
- `src/sim/vehicles.ts` — ground vehicle fleet with depots
- `src/sim/radio.ts` — radio log with separate simulation and live channels, text-to-speech
- `src/live/liveTraffic.ts`, `src/data/flights.ts` — live feeds, dead reckoning, phase classification, live event detection
- `src/world/*` — Three.js scene, tiles, airport meshes, aircraft and vehicle models
- `src/ui/*` — start screen, loading screen, cookie consent, HUD (strips, details, radio, FIDS), radar
- `functions/api/[[path]].ts` — Cloudflare Pages Function: API proxy and the airport layout cache
- `public/models/*` — 3D models; see the model credit files

## License and attribution

The Airport Ops Simulator source code is licensed under the [MIT License](./LICENSE).
Third-party data and services are not covered by that license and remain subject to
their own terms. OpenStreetMap data is © OpenStreetMap contributors and is available
under the [Open Database License](https://www.openstreetmap.org/copyright).

3D models are not covered by the MIT License either:

- A320, A350, A380, B737 and B787 airliners: [amvlab](https://github.com/amvlab/aircraft-models), [CC BY 4.0](./public/models/LICENSE-CC-BY-4.0.txt).
- B757, B767, E190 and CRJ900 airliners, the Cessna 172 and the Bell 206 helicopter: [Bluebell CSL](https://github.com/oktal3700/bluebell) contributors (via SDRangel and Clear Aviation Tracking for most), CC0 1.0.
- Ground-service vehicles: [3DAssets.dev](https://3dassets.dev/packs/airport-terminal-and-ground-operations), CC0 1.0.

Full credits are in [`public/models/CREDITS.txt`](./public/models/CREDITS.txt) and [`public/models/vehicles/CREDITS.txt`](./public/models/vehicles/CREDITS.txt).

This is a game. Don't use it for real-world navigation or ATC.
