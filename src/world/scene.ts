import * as THREE from 'three';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

export type CameraMode = 'orbit' | 'tower' | 'follow';

/** Renderer, camera rig, lighting and sky. Everything else hangs off `scene`. */
export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly labels: CSS2DRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: MapControls;
  readonly sun = new THREE.DirectionalLight(0xffffff, 2.2);
  readonly hemi = new THREE.HemisphereLight(0xcfe4ff, 0x5a5040, 1.1);
  private sky: THREE.Mesh;
  private skyColors = { top: new THREE.Color(), horizon: new THREE.Color() };

  mode: CameraMode = 'orbit';
  night = false;
  towerEye = new THREE.Vector3(0, 70, 0);
  private towerYaw = 0;
  private towerPitch = -0.12;
  private followTarget: (() => THREE.Vector3 | null) | null = null;
  private lastFollow = new THREE.Vector3();
  private dragging: { x: number; y: number } | null = null;

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    host.appendChild(this.renderer.domElement);

    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = 'label-layer';
    host.appendChild(this.labels.domElement);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.5, 400_000);
    this.camera.position.set(-1800, 1400, 2200);

    this.controls = new MapControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.minDistance = 15;
    this.controls.maxDistance = 60_000;
    this.controls.zoomToCursor = true;
    this.controls.screenSpacePanning = false;

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -450; sc.right = 450; sc.top = 450; sc.bottom = -450; sc.near = 10; sc.far = 4000;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    this.scene.add(this.sun, this.sun.target, this.hemi);

    this.sky = this.makeSky();
    this.scene.add(this.sky);
    this.scene.fog = new THREE.Fog(0xbfd4e6, 20_000, 150_000);
    this.setNight(false);

    this.bindTowerControls();
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  private makeSky(): THREE.Mesh {
    const geo = new THREE.SphereGeometry(180_000, 32, 16);
    const colors = new Float32Array(geo.attributes.position.count * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false });
    const m = new THREE.Mesh(geo, mat);
    m.renderOrder = -100;
    m.frustumCulled = false;
    return m;
  }

  private paintSky(top: THREE.ColorRepresentation, horizon: THREE.ColorRepresentation) {
    this.skyColors.top.set(top);
    this.skyColors.horizon.set(horizon);
    const geo = this.sky.geometry as THREE.BufferGeometry;
    const pos = geo.attributes.position;
    const col = geo.attributes.color as THREE.BufferAttribute;
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const t = Math.max(0, pos.getY(i) / 180_000);
      c.copy(this.skyColors.horizon).lerp(this.skyColors.top, Math.pow(t, 0.45));
      col.setXYZ(i, c.r, c.g, c.b);
    }
    col.needsUpdate = true;
  }

  setNight(night: boolean) {
    this.night = night;
    if (night) {
      this.paintSky('#020611', '#14203a');
      this.sun.intensity = 0.15;
      this.sun.color.set('#9fb4ff');
      this.hemi.intensity = 0.35;
      (this.scene.fog as THREE.Fog).color.set('#0b1324');
      this.renderer.toneMappingExposure = 1.25;
    } else {
      this.paintSky('#3d7fd1', '#cfe2f3');
      this.sun.intensity = 2.4;
      this.sun.color.set('#fff5e6');
      this.hemi.intensity = 1.1;
      (this.scene.fog as THREE.Fog).color.set('#c7dbee');
      this.renderer.toneMappingExposure = 1.0;
    }
  }

  resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    this.renderer.setSize(w, h);
    this.labels.setSize(w, h);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  // ---------------- camera modes ----------------

  overview(center: THREE.Vector3, radius: number) {
    this.setMode('orbit');
    this.controls.target.copy(center);
    this.camera.position.set(center.x - radius * 0.55, radius * 0.75, center.z + radius * 0.85);
    this.camera.fov = 50;
    this.camera.updateProjectionMatrix();
  }

  rampView(at: THREE.Vector3, heading = 0) {
    this.setMode('orbit');
    this.controls.target.copy(at);
    const r = (heading * Math.PI) / 180;
    this.camera.position.set(at.x - Math.sin(r) * 140 + 60, 45, at.z + Math.cos(r) * 140);
  }

  towerView(eye: THREE.Vector3, lookAt: THREE.Vector3) {
    this.towerEye.copy(eye);
    this.setMode('tower');
    const d = lookAt.clone().sub(eye);
    this.towerYaw = Math.atan2(d.x, -d.z);
    this.towerPitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    this.camera.fov = 55;
    this.camera.updateProjectionMatrix();
    this.applyTower();
  }

  follow(getTarget: () => THREE.Vector3 | null) {
    const t = getTarget();
    if (!t) return;
    if (this.mode !== 'orbit' && this.mode !== 'follow') this.setMode('orbit');
    this.followTarget = getTarget;
    this.mode = 'follow';
    this.controls.enabled = true;
    const offset = this.camera.position.clone().sub(this.controls.target);
    if (offset.length() > 1500 || offset.length() < 40) offset.set(-120, 80, 160);
    this.controls.target.copy(t);
    this.camera.position.copy(t).add(offset);
    this.lastFollow.copy(t);
  }

  setMode(mode: CameraMode) {
    if (mode !== 'follow') this.followTarget = null;
    if (this.mode === 'tower' && mode !== 'tower') {
      // leave the tower looking at the same spot
      this.camera.fov = 50;
      this.camera.updateProjectionMatrix();
      const dir = new THREE.Vector3();
      this.camera.getWorldDirection(dir);
      const ground = this.camera.position.clone().add(dir.multiplyScalar(Math.min(3000, this.camera.position.y / Math.max(0.05, -dir.y))));
      this.controls.target.set(ground.x, 0, ground.z);
    }
    this.mode = mode;
    this.controls.enabled = mode !== 'tower';
  }

  private applyTower() {
    this.camera.position.copy(this.towerEye);
    const dir = new THREE.Vector3(Math.sin(this.towerYaw) * Math.cos(this.towerPitch), Math.sin(this.towerPitch), -Math.cos(this.towerYaw) * Math.cos(this.towerPitch));
    this.camera.lookAt(this.towerEye.clone().add(dir));
  }

  private bindTowerControls() {
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => {
      if (this.mode === 'tower' && e.button === 0) this.dragging = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener('pointerup', () => (this.dragging = null));
    window.addEventListener('pointermove', (e) => {
      if (!this.dragging || this.mode !== 'tower') return;
      const k = (this.camera.fov / 55) * 0.0035;
      this.towerYaw -= (e.clientX - this.dragging.x) * k;
      this.towerPitch = Math.max(-1.2, Math.min(0.6, this.towerPitch + (e.clientY - this.dragging.y) * k));
      this.dragging = { x: e.clientX, y: e.clientY };
    });
    el.addEventListener('wheel', (e) => {
      if (this.mode !== 'tower') return;
      e.preventDefault();
      this.camera.fov = Math.max(4, Math.min(75, this.camera.fov * (e.deltaY > 0 ? 1.12 : 0.89)));
      this.camera.updateProjectionMatrix();
    }, { passive: false });
  }

  /** Binocular zoom level for the HUD (tower view only). */
  get zoomFactor() { return 55 / this.camera.fov; }

  update() {
    if (this.mode === 'tower') {
      this.applyTower();
    } else {
      if (this.mode === 'follow' && this.followTarget) {
        const t = this.followTarget();
        if (t) {
          const delta = t.clone().sub(this.lastFollow);
          this.camera.position.add(delta);
          this.controls.target.add(delta);
          this.lastFollow.copy(t);
        } else {
          this.setMode('orbit');
        }
      }
      this.controls.update();
      if (this.camera.position.y < 3) this.camera.position.y = 3;
    }
    // keep the shadow frustum around whatever we're looking at
    const focus = this.mode === 'tower' ? this.towerEye : this.controls.target;
    const camDist = this.camera.position.distanceTo(this.controls.target);
    this.sun.castShadow = this.mode === 'tower' ? true : camDist < 3500;
    this.sun.target.position.set(focus.x, 0, focus.z);
    this.sun.position.set(focus.x - 900, 1600, focus.z + 600);
    this.sky.position.copy(this.camera.position).setY(0);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
  }
}
