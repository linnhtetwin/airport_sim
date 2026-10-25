import { Projection, type XZ } from '../geo/projection';
import type { OsmElement } from './osm';

/**
 * A generic two-runway airport expressed as OSM elements, used when Overpass
 * is unreachable so the game stays playable offline.
 */
export function syntheticAirport(lat: number, lon: number): OsmElement[] {
  const proj = new Projection(lat, lon);
  const out: OsmElement[] = [];
  const nodeIds = new Map<string, number>();
  let nextId = -1;

  const nodeFor = (p: XZ) => {
    const k = `${Math.round(p.x)},${Math.round(p.z)}`;
    let id = nodeIds.get(k);
    if (id == null) { id = nextId--; nodeIds.set(k, id); }
    return id;
  };
  const way = (pts: XZ[], tags: Record<string, string>) => {
    out.push({
      type: 'way',
      id: nextId--,
      nodes: pts.map(nodeFor),
      geometry: pts.map((p) => proj.toLatLon(p.x, p.z)),
      tags,
    });
  };
  const node = (p: XZ, tags: Record<string, string>) => {
    const ll = proj.toLatLon(p.x, p.z);
    out.push({ type: 'node', id: nextId--, lat: ll.lat, lon: ll.lon, tags });
  };
  const rect = (x0: number, z0: number, x1: number, z1: number): XZ[] =>
    [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }, { x: x0, z: z0 }];
  const row = (z: number, xs: number[]) => xs.slice().sort((a, b) => a - b).map((x) => ({ x, z }));

  way(rect(-2300, -1250, 2300, 1350), { aeroway: 'aerodrome', name: 'Generated Airport', ele: '10' });

  // Runways (09L/27R north, 09R/27L south)
  const northX = [-1750, -900, 0, 900, 1750];
  const southX = [-1500, -750, 0, 750, 1500];
  way(row(-800, northX), { aeroway: 'runway', ref: '09L/27R', width: '45' });
  way(row(900, southX), { aeroway: 'runway', ref: '09R/27L', width: '45' });

  // Parallel taxiways
  const crossX = [-1100, 1100];
  way(row(-600, [...northX, ...crossX]), { aeroway: 'taxiway', ref: 'A', width: '23' });
  way(row(700, [...southX, ...crossX]), { aeroway: 'taxiway', ref: 'B', width: '23' });
  northX.forEach((x, i) => way([{ x, z: -800 }, { x, z: -600 }], { aeroway: 'taxiway', ref: `A${i + 1}`, width: '23' }));
  southX.forEach((x, i) => way([{ x, z: 700 }, { x, z: 900 }], { aeroway: 'taxiway', ref: `B${i + 1}`, width: '23' }));

  // Apron, taxilane and stands
  const standX: number[] = [];
  for (let i = 0; i < 14; i++) standX.push(-780 + i * 120);
  crossX.forEach((x, i) => way([{ x, z: -600 }, { x, z: -150 }, { x, z: 700 }], { aeroway: 'taxiway', ref: i ? 'C' : 'D', width: '23' }));
  way(row(-150, [...crossX, ...standX]), { aeroway: 'taxilane', ref: 'L', width: '18' });
  way(rect(-1000, -260, 1000, 150), { aeroway: 'apron' });
  standX.forEach((x, i) => {
    way([{ x, z: -150 }, { x, z: -60 }, { x, z: 95 }], { aeroway: 'parking_position', ref: String(i + 1) });
    way([{ x: x - 14, z: 150 }, { x: x - 14, z: 112 }], { aeroway: 'jet_bridge' });
    node({ x: x - 14, z: 155 }, { aeroway: 'gate', ref: `G${i + 1}` });
  });
  way(rect(-900, 150, 900, 300), { aeroway: 'terminal', building: 'terminal', name: 'Terminal 1', height: '20' });

  // Cargo / maintenance area
  way(rect(1200, -420, 1700, -170), { aeroway: 'apron' });
  way(rect(1260, -400, 1520, -260), { aeroway: 'hangar', building: 'hangar', height: '26' });
  way([{ x: 1100, z: -150 }, { x: 1350, z: -150 }, { x: 1350, z: -220 }], { aeroway: 'parking_position', ref: 'H1' });

  node({ x: 120, z: 420 }, { aeroway: 'tower', height: '70', name: 'Control Tower' });
  way(rect(-300, 320, -100, 420), { building: 'yes', height: '12' });
  way(rect(300, 330, 520, 440), { building: 'yes', height: '10' });
  return out;
}
