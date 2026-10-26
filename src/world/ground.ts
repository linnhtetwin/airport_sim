import * as THREE from 'three';
import type { AirportLayout } from '../data/osm';

export type MapStyle = 'satellite' | 'osm' | 'plain';

const TILE_URL: Record<Exclude<MapStyle, 'plain'>, (z: number, x: number, y: number) => string> = {
  satellite: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
  osm: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
};

export const ATTRIBUTION: Record<MapStyle, string> = {
  satellite: 'Airport data © OpenStreetMap contributors · Imagery © Esri, Maxar, Earthstar Geographics',
  osm: 'Airport data and map tiles © OpenStreetMap contributors',
  plain: 'Airport data © OpenStreetMap contributors',
};

const lon2tile = (lon: number, z: number) => ((lon + 180) / 360) * 2 ** z;
const lat2tile = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};
const tile2lon = (x: number, z: number) => (x / 2 ** z) * 360 - 180;
const tile2lat = (y: number, z: number) => {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};

/**
 * Slippy-map tiles laid flat on the ground: a detailed inner layer covering the
 * airfield and a coarse outer ring for context on approach. Both layers skip
 * depth writes and draw in a fixed order, so flat ground layers never z-fight.
 */
export class TileGround {
  readonly group = new THREE.Group();
  private materials: THREE.MeshBasicMaterial[] = [];
  private loader = new THREE.TextureLoader();
  /** Tile counts for the loading screen (failed tiles count as done). */
  total = 0;
  done = 0;
  onProgress: (done: number, total: number) => void = () => {};
  private waiters: (() => void)[] = [];

  constructor(private layout: AirportLayout, private style: MapStyle, private maxAniso: number) {
    this.loader.setCrossOrigin('anonymous');
    const base = new THREE.Mesh(
      new THREE.PlaneGeometry(400_000, 400_000).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: style === 'satellite' ? 0x3b4a35 : 0xd9d6cc, depthWrite: false }),
    );
    base.renderOrder = -20;
    base.position.y = -2;
    this.group.add(base);
    this.materials.push(base.material as THREE.MeshBasicMaterial);
    if (style === 'plain') {
      (base.material as THREE.MeshBasicMaterial).color.set(0x6f7f62);
      return;
    }
    const b = layout.bounds;
    const pad = 2500;
    this.addLayer(b.minX - pad, b.maxX + pad, b.minZ - pad, b.maxZ + pad, 120, 16, -11);
    const R = 32_000;
    this.addLayer(-R, R, -R, R, 64, 12, -12);
  }

  private addLayer(minX: number, maxX: number, minZ: number, maxZ: number, maxTiles: number, maxZoom: number, order: number) {
    const P = this.layout.proj;
    const nw = P.toLatLon(minX, minZ), se = P.toLatLon(maxX, maxZ);
    let z = maxZoom;
    let x0 = 0, x1 = 0, y0 = 0, y1 = 0;
    for (; z > 3; z--) {
      x0 = Math.floor(lon2tile(nw.lon, z)); x1 = Math.floor(lon2tile(se.lon, z));
      y0 = Math.floor(lat2tile(nw.lat, z)); y1 = Math.floor(lat2tile(se.lat, z));
      if ((x1 - x0 + 1) * (y1 - y0 + 1) <= maxTiles) break;
    }
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) this.addTile(z, x, y, order);
    }
  }

  private addTile(z: number, x: number, y: number, order: number) {
    const P = this.layout.proj;
    const a = P.toXZ(tile2lat(y, z), tile2lon(x, z));
    const c = P.toXZ(tile2lat(y + 1, z), tile2lon(x + 1, z));
    const w = c.x - a.x, h = c.z - a.z;
    const geo = new THREE.PlaneGeometry(w, h).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0x8a8a8a, depthWrite: false, fog: order < -11 });
    this.materials.push(mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(a.x + w / 2, order < -11 ? -1 : -0.5, a.z + h / 2);
    mesh.renderOrder = order;
    mesh.visible = false;
    this.group.add(mesh);
    const style = this.style as Exclude<MapStyle, 'plain'>;
    this.total++;
    this.loader.load(TILE_URL[style](z, x, y), (tex) => {
      if (this.disposed) { tex.dispose(); return; } // arrived after a map style switch
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = this.maxAniso;
      tex.generateMipmaps = true;
      mat.map = tex;
      mat.color.set(this.dim);
      mat.needsUpdate = true;
      mesh.visible = true;
      this.tileDone();
    }, undefined, () => this.tileDone() /* missing tile: base plane shows through */);
  }

  private tileDone() {
    this.done++;
    this.onProgress(this.done, this.total);
    if (this.done >= this.total * 0.95) for (const w of this.waiters.splice(0)) w();
  }

  /** Resolves once ~all tiles are in, or after `timeoutMs` (imagery keeps loading behind). */
  ready(timeoutMs: number): Promise<void> {
    if (this.done >= this.total * 0.95) return Promise.resolve();
    return new Promise((resolve) => {
      this.waiters.push(resolve);
      setTimeout(resolve, timeoutMs);
    });
  }

  /** Free the tiles' textures and materials (switching map style builds a new ground). */
  private disposed = false;
  dispose() {
    this.disposed = true;
    for (const m of this.materials) { m.map?.dispose(); m.dispose(); }
    this.group.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
  }

  private dim = 0xffffff;
  setNight(night: boolean) {
    this.dim = night ? 0x2a3040 : 0xffffff;
    for (const m of this.materials) if (m.map) m.color.set(this.dim);
    if (this.materials[0] && !this.materials[0].map) {
      this.materials[0].color.set(night ? 0x0d1210 : this.style === 'satellite' ? 0x3b4a35 : this.style === 'plain' ? 0x6f7f62 : 0xd9d6cc);
    }
  }
}
