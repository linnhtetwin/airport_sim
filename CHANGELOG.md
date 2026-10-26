# Changelog

All notable changes to Airport Ops are listed here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Preset airports open almost at once.** Their OpenStreetMap layouts ship with the game in `public/airports/`, so first-time players no longer wait 30–90 s for the public Overpass servers. `npm run airports` refreshes them.
- **Shared airport layout cache.** The new `/api/airport/<ICAO>` endpoint downloads an airport once and serves that copy to every player for 30 days, worldwide when a Cloudflare KV namespace is bound as `AIRPORT_LAYOUTS`. The server builds the query from the ICAO code itself, so cached layouts can't be tampered with. The dev and preview servers provide the same endpoint.
- **FlightAware AeroAPI support (optional).** Adds the airport's real schedule: confirmed routes, gates, terminals, scheduled/estimated/actual times, delays, cancellations and diversions.
  - Live Watch: flight details gain a FlightAware block with times at both ends (in each airport's own time zone), gates, delay and route progress. The FIDS board shows the airport's real departures and arrivals with remarks such as BOARDING, FINAL CALL, DELAYED, LANDED and CANCELLED.
  - ATC Simulation: upcoming real arrivals become the planned arrival queue, and real departures are given to aircraft parked on the ramp, at their real times and (when the stand exists) their real gates.
  - Works with the player's own key (*Options → FlightAware AeroAPI key*) or a site-wide key stored as a Cloudflare secret, which is cached at the edge for 10 minutes per airport.
- **Live events log.** In Live Watch the radio panel becomes *LIVE EVENTS*, listing real events detected from ADS-B data: landings and departures (with the runway used), aircraft joining the approach, and emergency squawks 7700 / 7600 / 7500.
- **🎧 Real ATC audio** button in Live Watch that opens the airport's tower and ground feeds on LiveATC.net.
- **New loading screen.** A runway-style progress bar with a checklist of the real loading steps (OpenStreetMap layout, taxi network, 3D scene, satellite imagery, METAR, live traffic), download progress, elapsed time and gameplay tips. The game now waits briefly for imagery so the first view isn't grey ground.
- **3D aircraft models.** Logo-free glTF airliners (A320, A350, A380, B737, B787 from amvlab, CC BY 4.0; B757, B767 and E190 from Bluebell CSL, CC0) replace the procedural shapes for most types, tinted with the airline's colour. The E190 model is rescaled for the E170, E175, E195 and E195-E2. Types without a matching model keep an improved procedural airframe.
- **3D ground-service vehicles** (CC0, 3DAssets.dev): pushback tug, fuel bowser, catering truck, lavatory service truck, and baggage tug with cart.
- 3D models for the CRJ family (CRJ900 model, stretched to the CRJ200, CRJ700 and CRJ1000), light aircraft (Cessna 172) and helicopters (Bell 206 JetRanger, standing in for the Bell 407), instead of procedural shapes. All are Bluebell CSL models (CC0). The Piper PA-28 is now its own type, drawn with the Cessna model, and CRJs are no longer drawn as E-Jets. CRJ700 and CRJ900 flights join the simulated traffic.
- More aircraft types: A318, A220-100/-300, A330-800neo, A340-300/-600, B737-900ER, B757-300, B767-400ER, B777-200LR, E170, E195, E195-E2. Helicopter type detection is more accurate.
- Each preset airport now has its real IANA time zone, so clocks and boards show the correct local time, daylight saving included. Other airports use FlightAware's time zone when available, then fall back to a longitude estimate.
- Live aircraft use the true heading when the feed provides it; the details panel then shows *TRUE HDG* instead of *TRACK*.
- Double-clicking a flight strip follows that flight with the camera.
- Cloudflare Pages deployment (`npm run cf:deploy`, `npm run cf:dev`) with a Pages Function that proxies `/api/adsb`, `/api/opensky`, `/api/fr24`, `/api/awc`, `/api/overpass`, `/api/adsbdb` and `/api/flightaware`. It only allows GET requests to an allowlist of upstream endpoints and caches free feeds at the edge; airport layouts are cached for a day.
- Google Analytics with Consent Mode v2 and a cookie banner. Nothing is stored unless the player accepts, and the choice can be changed from the start screen or *Settings → Privacy*. Declining removes earlier GA cookies.
- Site metadata: page title and description, favicon, Apple touch icon, and Open Graph / Twitter social preview image.

### Changed

- Simulation and Live Watch are now fully separate. The simulation pauses in Live Watch, and its radio calls, alerts, toasts and voice never appear there. Each mode keeps its own log.
- The command panel only shows the actions that are currently possible, and scrolls the suggested action into view.
- Parked aircraft face the nearest terminal facade, and stands mapped on a building edge are moved so the fuselage stays outside the building.
- Airport layouts load from the browser cache, then the bundled file, then `/api/airport`, and only then directly from the public Overpass servers. This replaces the `/api/overpass` proxy, which cached each layout per Cloudflare data centre only.
- Flight-route lookups (adsbdb.com) go through the proxy, treat unknown callsigns as normal answers, and back off for two minutes when rate limited.
- FIDS split-flap board: column widths scale to the board's width, headings line up exactly over their columns, and the flap split line no longer cuts through letters.
- Upgraded to three.js r186, TypeScript 7 and Vite 8; added wrangler as a dev dependency.

### Fixed

- E-Jets drawn with another type's size (E170, E175, E195, E195-E2) had their length and wingspan scaling swapped.
- Navigation lights and beacons are scaled to the aircraft, instead of airliner-sized spheres on light aircraft and helicopters.
- Aircraft headings: parked live aircraft snap to their stand's heading, live aircraft point along their real nose heading instead of their ground track when the feed provides it, and the B787 / B777 models are no longer rotated 90°.
- The frame timer resets when the browser tab returns from the background, so the simulation no longer jumps forward.
- Overpass requests that some public servers rejected because of the site's origin.

## [0.1.0] - 2026-10-25

Initial public release.

- ATC Simulation: run the tower, ground and ramp of any real airport built in 3D from OpenStreetMap, with clearances, runway safety, taxi routing, turnarounds, ground vehicles, emergencies, scoring and optional auto-controllers.
- Live Watch: real ADS-B traffic around the airport from adsb.lol, OpenSky or Flightradar24, with routes from adsbdb.com.
- Satellite or OpenStreetMap ground imagery, METAR-based active runway, radar scope, flight strips, radio with text-to-speech, and a split-flap FIDS board.

[Unreleased]: https://github.com/linnhtetwin/airport_sim/compare/0860429...HEAD
[0.1.0]: https://github.com/linnhtetwin/airport_sim/commit/0860429
