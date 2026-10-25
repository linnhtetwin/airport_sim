import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { typeSpec } from '../data/aircraftTypes';
import { headingToRotY } from '../geo/projection';
import { buildAircraft, buildVehicle, buildMarshaller, type AircraftModel, type MarshallerModel, type VehicleKind } from './models';

export interface AcRender {
  id: string;
  type: string;
  category?: string;
  airline: string | null;
  x: number;
  y: number;
  z: number;
  heading: number;
  pitch: number;
  gear: boolean;
  label: string;
  cls: string;
  showLabel: boolean;
  lights: boolean;
}

interface Entry { model: AircraftModel; label: CSS2DObject; el: HTMLDivElement; html: string; cls: string; key: string }

/** Keeps a 3D model + HTML data block per aircraft in sync with a list of render states. */
export class TrafficView {
  readonly group = new THREE.Group();
  private entries = new Map<string, Entry>();
  onPick: (id: string) => void = () => {};

  sync(states: AcRender[], selected: string | null, t: number, night: boolean) {
    const seen = new Set<string>();
    for (const s of states) {
      seen.add(s.id);
      const key = `${s.type}|${s.airline}`;
      let e = this.entries.get(s.id);
      if (e && e.key !== key) { this.remove(s.id); e = undefined; }
      if (!e) e = this.create(s, key);
      const m = e.model;
      m.root.position.set(s.x, s.y, s.z);
      m.root.rotation.y = headingToRotY(s.heading);
      m.body.rotation.x = (s.pitch * Math.PI) / 180;
      for (const g of m.gear) g.visible = s.gear;
      const flash = (t * 1.1) % 1 < 0.12;
      m.beacon.visible = s.lights && flash;
      for (const st of m.strobes) st.visible = s.y > 2 && (t * 1.3) % 1.3 < 0.08;
      for (const n of m.navLights) n.visible = s.lights || night;
      const cls = `ac-label ${s.cls}${s.id === selected ? ' selected' : ''}`;
      if (e.cls !== cls) { e.el.className = cls; e.cls = cls; }
      if (e.html !== s.label) { e.el.innerHTML = s.label; e.html = s.label; }
      e.label.visible = s.showLabel || s.id === selected;
      e.label.position.set(0, Math.max(14, m.length * 0.32), 0);
    }
    for (const id of [...this.entries.keys()]) if (!seen.has(id)) this.remove(id);
  }

  private create(s: AcRender, key: string): Entry {
    const spec = typeSpec(s.type, s.category);
    const model = buildAircraft(spec, s.airline);
    const el = document.createElement('div');
    el.className = 'ac-label';
    el.addEventListener('pointerdown', (ev) => { ev.stopPropagation(); this.onPick(s.id); });
    const label = new CSS2DObject(el);
    label.center.set(0, 1);
    model.root.add(label);
    model.root.userData.id = s.id;
    this.group.add(model.root);
    const e: Entry = { model, label, el, html: '', cls: '', key };
    this.entries.set(s.id, e);
    return e;
  }

  private remove(id: string) {
    const e = this.entries.get(id);
    if (!e) return;
    e.label.element.remove();
    e.model.root.removeFromParent();
    this.entries.delete(id);
  }

  clear() {
    for (const id of [...this.entries.keys()]) this.remove(id);
  }

  position(id: string): THREE.Vector3 | null {
    const e = this.entries.get(id);
    return e ? e.model.root.position.clone() : null;
  }

  /** Nearest aircraft to a screen point, within `radius` pixels. */
  pick(x: number, y: number, camera: THREE.Camera, w: number, h: number, radius = 36): string | null {
    let best: string | null = null, bd = radius;
    const v = new THREE.Vector3();
    for (const [id, e] of this.entries) {
      v.copy(e.model.root.position).setY(e.model.root.position.y + 3).project(camera);
      if (v.z > 1) continue;
      const sx = ((v.x + 1) / 2) * w, sy = ((1 - v.y) / 2) * h;
      const d = Math.hypot(sx - x, sy - y);
      if (d < bd) { bd = d; best = id; }
    }
    return best;
  }
}

export interface VehRender { id: string; kind: VehicleKind; x: number; z: number; heading: number; visible: boolean; flashing: boolean }

export class VehicleView {
  readonly group = new THREE.Group();
  private items = new Map<string, THREE.Group>();

  sync(list: VehRender[], t: number) {
    for (const v of list) {
      let g = this.items.get(v.id);
      if (!g) {
        g = buildVehicle(v.kind);
        this.items.set(v.id, g);
        this.group.add(g);
      }
      g.visible = v.visible;
      if (!v.visible) continue;
      g.position.set(v.x, 0, v.z);
      g.rotation.y = headingToRotY(v.heading);
      const on = v.flashing && (t * 2) % 1 < 0.5;
      g.traverse((o) => { if (o.name === 'flasher') o.visible = on || !v.flashing; });
    }
  }
}

export interface MarshalRender { id: string; x: number; z: number; heading: number; state: 'GUIDE' | 'STOP' }

export class MarshallerView {
  readonly group = new THREE.Group();
  private items = new Map<string, MarshallerModel>();

  sync(list: MarshalRender[], t: number) {
    const seen = new Set<string>();
    for (const m of list) {
      seen.add(m.id);
      let model = this.items.get(m.id);
      if (!model) {
        model = buildMarshaller();
        this.items.set(m.id, model);
        this.group.add(model.root);
      }
      model.root.position.set(m.x, 0, m.z);
      model.root.rotation.y = headingToRotY(m.heading);
      if (m.state === 'GUIDE') {
        // "come ahead": arms raised, wands beckoning
        const a = Math.PI * 0.85 + Math.sin(t * 5) * 0.35;
        model.armL.rotation.z = -a; model.armR.rotation.z = a;
        model.armL.rotation.x = model.armR.rotation.x = Math.sin(t * 5) * 0.4;
      } else {
        // "stop": wands crossed above the head
        model.armL.rotation.z = -Math.PI * 0.82; model.armR.rotation.z = Math.PI * 0.82;
        model.armL.rotation.x = model.armR.rotation.x = 0;
      }
    }
    for (const [id, model] of this.items) {
      if (!seen.has(id)) { model.root.removeFromParent(); this.items.delete(id); }
    }
  }
}
