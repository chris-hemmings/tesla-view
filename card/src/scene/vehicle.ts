import * as THREE from 'three';
import { fetchJson, loadGltf, loadObj } from './assets';
import { MaterialFactory, type MaterialDesc } from './materials';
import type { ChargingState } from '../types';

/** tools/godot2three.py output */
export interface SceneOverrides {
  nodes: Record<string, { parent?: string | null; type?: string; visible?: boolean; matrix?: number[]; mesh?: string; materials?: Record<string, string> }>;
  materials: Record<string, MaterialDesc>;
  materials_by_name?: Record<string, string>;
}
interface AnimJson { name: string; length: number; tracks: { nodePath: string; keys: { time: number; position: number[]; quaternion: number[]; scale: number[] }[] }[] }
export interface LightGroup { on: string[]; off?: string[] }

/** Vehicle scenes (ProductManager.gd → fascia_type). Node names come from the GLB / .tscn of each scene. */
export const MODELS = {
  // 2025+ Model Y Premium (fascia_type "baseBayberry"); Performance = trim 'performance'
  juniper: {
    dir: 'model-y-juniper', glb: 'Bayberry.glb',
    show: ['Fascia_Standard', 'Seats_Standard', 'Skullcap_LF_Paint', 'Skullcap_RF_Paint', 'Brake_Lights_Off', 'LHD'],
    hide: ['Tesla_Badge', 'Fascia_Perf', 'Seats_Perf', 'Seats_7S', 'Skullcap_LF_Perf', 'Skullcap_RF_Perf', 'Spoiler_Perf', 'Light_Off', 'RHD'],
    perf: { show: ['Fascia_Perf', 'Seats_Perf', 'Skullcap_LF_Perf', 'Skullcap_RF_Perf', 'Spoiler_Perf'], hide: ['Fascia_Standard', 'Seats_Standard', 'Skullcap_LF_Paint', 'Skullcap_RF_Paint'] },
    rhd: { show: ['RHD', 'Doorcard_LF_RHD', 'Doorcard_RF_RHD'], hide: ['LHD', 'Doorcard_LF_LHD', 'Doorcard_RF_LHD'] },
    lights: {   // Bayberry.gd: beam & DRL follow drl_on || headlights_on || parking_lights_on
      drl:        { on: ['DRL', 'Headlights_Beam'] },
      headlights: { on: ['Headlights_On', 'DRL', 'Headlights_Beam', 'Parking_Lights_On', 'Parking_Light_Projection', 'HeadLightProjection'] },
      parking:    { on: ['DRL', 'Headlights_Beam', 'Parking_Lights_On', 'Parking_Light_Projection'] },
      brake:      { on: ['Brake_Lights_On', 'BrakeLightProjection'], off: ['Brake_Lights_Off'] },
      turn_l:     { on: ['Left_Turn_Signal_On', 'Back_Left_Turn_Signal_On'] },
      turn_r:     { on: ['Right_Turn_Signal_On', 'Back_Right_Turn_Signal_On'] },
      reverse:    { on: ['Reverse Light On'] },
      fog:        { on: ['Fog_Light_On'] },
    } as Record<string, LightGroup>,
  },
  // Model Y Standard (fascia_type "e41Bayberry")
  standard: {
    dir: 'model-y-standard-e41', glb: 'BayberryE41.glb',
    show: ['LHD'], hide: ['Tesla_Badge', 'Light_Off', 'RHD'], perf: undefined as any,
    rhd: { show: ['RHD', 'Doorcard_LF_RHD', 'Doorcard_RF_RHD'], hide: ['LHD', 'Doorcard_LF_LHD', 'Doorcard_RF_LHD'] },
    lights: {
      drl:        { on: ['DRL_Left', 'DRL_Right'] },
      headlights: { on: ['HighBeam_Left', 'HighBeam_Right', 'DRL_Left', 'DRL_Right', 'HeadLightProjection'] },
      brake:      { on: ['Brake_Lights_CHMSL_On', 'Left_Turn_Signal_US', 'Right_Turn_Signal_US', 'BrakeLightProjection'], off: ['Brake_Lights_CHMSL_Off'] },
      turn_l:     { on: ['Left_Turn_Signal_EU'] }, turn_r: { on: ['Right_Turn_Signal_EU'] },
      reverse:    { on: ['Reverse'] }, fog: { on: ['Rear_Fog'] },
    } as Record<string, LightGroup>,
  },
};
export type ModelId = keyof typeof MODELS;

/** closure channel → AnimationPlayer names (from the .tscn) */
export const CLOSURE_ANIMS: Record<string, string[]> = {
  frunk: ['HoodAnimation'],
  trunk: ['TrunkAnimation', 'LHStrutAnimation', 'RHStrutAnimation', 'LLStrutAnimation', 'RLStrutAnimation'],
  charge_port: ['ChargeportAnimation'],
  door_fl: ['LFDoorAnimation'], door_fr: ['RFDoorAnimation'], door_rl: ['LRDoorAnimation'], door_rr: ['RRDoorAnimation'],
  window_fl: ['LFWindowAnimation'], window_fr: ['RFWindowAnimation'], window_rl: ['LRWindowAnimation'], window_rr: ['RRWindowAnimation'],
};

/** wheel_type (API string) → wheel scene folder; only wheels with a scene-overrides.json ship in the card assets */
export const WHEELS: Record<string, { dir: string; glb: string; root: string }> = {
  Crossflow19:   { dir: 'wheels/GeminiDark', glb: 'wheels/GeminiDark/GeminiDark.glb', root: 'GeminiDark' },
  HelixV220:     { dir: 'wheels/Helix2', glb: 'wheels/Helix2/Helix2.glb', root: 'Helix2' },
  HelixV220Dark: { dir: 'wheels/Helix2_Dark', glb: 'wheels/Helix2/Helix2.glb', root: 'Helix2' },
};

const meshesOf = (o: THREE.Object3D): THREE.Mesh[] => (o as THREE.Mesh).isMesh ? [o as THREE.Mesh] : o.children.filter(c => (c as THREE.Mesh).isMesh) as THREE.Mesh[];

/** Loads a Godot scene GLB and applies its scene-overrides.json (transforms, visibility, per-surface materials). */
export function applyOverrides(root: THREE.Object3D, ov: SceneOverrides, byName: Record<string, THREE.Object3D>, factory: MaterialFactory) {
  root.traverse(o => { if (o.name) byName[o.name] = o; });
  const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
  const overridden = new Set<THREE.Mesh>();
  for (const [name, n] of Object.entries(ov.nodes)) {
    const o = byName[name]; if (!o) continue;
    if (n.matrix) { new THREE.Matrix4().fromArray(n.matrix).decompose(pos, quat, scl); o.position.copy(pos); o.quaternion.copy(quat); o.scale.copy(scl); }
    if (n.visible !== undefined) o.visible = n.visible;
    if (n.materials) {
      const ms = meshesOf(o);
      for (const [slot, key] of Object.entries(n.materials)) {
        const mesh = ms[+slot]; if (!mesh) continue;
        mesh.material = factory.build(ov.materials[key], key); mesh.renderOrder = (mesh.material as any).userData.renderPriority; overridden.add(mesh);
      }
    }
  }
  if (ov.materials_by_name) root.traverse(o => {      // importer materials for surfaces the .tscn leaves alone
    const mesh = o as THREE.Mesh; if (!mesh.isMesh || overridden.has(mesh)) return;
    const key = ov.materials_by_name![(mesh.material as THREE.Material).name]; if (!key) return;
    mesh.material = factory.build(ov.materials[key], key); mesh.renderOrder = (mesh.material as any).userData.renderPriority;
  });
}

/** Nodes that exist only in the .tscn (the app's Marker hotspots, Spatials group, corner Position3Ds…) are not in the
 *  GLB: create them with their .tscn transform under the right parent so they can be used as 3D anchors. */
export function createTscnNodes(ov: SceneOverrides, glbRoot: THREE.Object3D, byName: Record<string, THREE.Object3D>) {
  const ensure = (name: string): THREE.Object3D | null => {
    if (byName[name]) return byName[name];
    const v = ov.nodes[name]; if (!v) return null;
    const parent = (!v.parent || v.parent === '.') ? glbRoot : ensure(v.parent.split('/').pop()!) || glbRoot;
    const o = new THREE.Object3D(); o.name = name;
    if (v.matrix) new THREE.Matrix4().fromArray(v.matrix).decompose(o.position, o.quaternion, o.scale);
    parent.add(o); byName[name] = o; return o;
  };
  for (const [name, v] of Object.entries(ov.nodes)) if (!byName[name] && v.matrix && /^(Spatial|Position3D)$/.test(v.type || '')) ensure(name);
}

/** Instantiates an .obj-based Godot scene (brakes, charge cable) from its overrides JSON. */
async function loadObjScene(ov: SceneOverrides, factory: MaterialFactory, materialFor?: (node: string, key: string, desc: MaterialDesc) => THREE.Material | undefined) {
  const root = new THREE.Group(); const byName: Record<string, THREE.Object3D> = {};
  const names = Object.keys(ov.nodes).sort((a, b) => (ov.nodes[a].parent || '').split('/').length - (ov.nodes[b].parent || '').split('/').length);
  for (const name of names) {
    const v = ov.nodes[name];
    const parent = (!v.parent || v.parent === '.') ? root : byName[v.parent.split('/').pop()!] || root;
    let o: THREE.Object3D;
    if (v.mesh) {
      o = await loadObj(v.mesh); o.name = name;
      const meshes: THREE.Mesh[] = []; o.traverse(c => { if ((c as THREE.Mesh).isMesh) meshes.push(c as THREE.Mesh); });
      for (const [slot, key] of Object.entries(v.materials || {})) {
        const desc = ov.materials[key]; const mesh = meshes[+slot] || meshes[0]; if (!mesh) continue;
        mesh.material = materialFor?.(name, key, desc) || factory.build(desc, key);
      }
    } else { o = new THREE.Object3D(); o.name = name; }
    if (v.matrix) new THREE.Matrix4().fromArray(v.matrix).decompose(o.position, o.quaternion, o.scale);
    if (v.visible !== undefined) o.visible = v.visible;
    parent.add(o); byName[name] = o;
  }
  return { root, byName };
}

/** three.js port of mobile/materials/PowerflowSingle.shader: travelling pulse of emission along the cable's U. */
export class FlowMaterial extends THREE.MeshStandardMaterial {
  flow = { uFlowState: { value: 0 }, uFlowColor: { value: new THREE.Color(0.18, 0.8, 0.44) }, uTime: { value: 0 },
           uPulseLength: { value: 1.5 }, uPulseFreq: { value: 1.5 }, uSnakeFraction: { value: 1.0 }, uSnakeExponent: { value: 2.0 } };
  constructor(bc: THREE.Texture, roughness: THREE.Texture) {
    super({ map: bc, roughnessMap: roughness, roughness: 1, metalness: 0 });
    this.customProgramCacheKey = () => 'tesla-view-flow';
    this.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, this.flow);
      shader.vertexShader = shader.vertexShader
        .replace('void main() {', 'varying vec2 vFlowUv;\nvoid main() {')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\n vFlowUv = uv;');
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', `uniform int uFlowState; uniform vec3 uFlowColor; uniform float uTime, uPulseLength, uPulseFreq, uSnakeFraction, uSnakeExponent;
varying vec2 vFlowUv;
void main() {`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  { float t = uTime / uPulseFreq; float flow = 0.0;
    if (uFlowState == 1) flow = pow(max(1.0 - fract(t - vFlowUv.x / uPulseLength) / uSnakeFraction, 0.0), uSnakeExponent);
    if (uFlowState == 5) flow = pow(max(1.0 - fract(t + vFlowUv.x / uPulseLength) / uSnakeFraction, 0.0), uSnakeExponent);
    if (uFlowState == 1 || uFlowState == 5) { diffuseColor.rgb *= (1.0 - flow) * 0.2; totalEmissiveRadiance += uFlowColor * flow; }
    else if (uFlowState == 2) { diffuseColor.rgb *= 0.2; totalEmissiveRadiance += uFlowColor * abs(sin(3.14159265 * t)) * 0.7; }
    else if (uFlowState == 3) { diffuseColor.rgb *= 0.2; totalEmissiveRadiance += uFlowColor * 0.5; }
    else { diffuseColor.rgb *= 0.2; } }`);
    };
  }
}

interface Player { t: number; dir: number; json: AnimJson }

export class Vehicle {
  root!: THREE.Group;                 // GLTF scene
  glbRoot!: THREE.Object3D;           // GODOT_single_root node
  nodes: Record<string, THREE.Object3D> = {};
  anims: Record<string, AnimJson> = {};
  private players: Record<string, Player> = {};
  private lightState: Record<string, boolean> = {};
  private flash?: { until: number; timer: any };
  cable?: { group: THREE.Group; flow: FlowMaterial; state: ChargingState };
  private cablePending?: Promise<void>;

  constructor(public readonly def: typeof MODELS[ModelId], public readonly factory: MaterialFactory) {}

  static async load(opts: { model: ModelId; trim?: 'premium' | 'performance'; rhd?: boolean; plate?: 'eu' | 'us'; wheels?: string; factory: MaterialFactory }) {
    const def = MODELS[opts.model];
    const v = new Vehicle(def, opts.factory);
    const [gltf, ov] = await Promise.all([loadGltf(`${def.dir}/${def.glb}`), fetchJson<SceneOverrides>(`${def.dir}/scene-overrides.json`)]);
    v.root = gltf.scene; v.glbRoot = v.root.children[0] || v.root;
    applyOverrides(v.root, ov, v.nodes, opts.factory);
    createTscnNodes(ov, v.glbRoot, v.nodes);
    v.setVisible(def.show, true); v.setVisible(def.hide, false);
    if (opts.trim === 'performance' && def.perf) { v.setVisible(def.perf.show, true); v.setVisible(def.perf.hide, false); }
    if (opts.rhd) { v.setVisible(def.rhd.show, true); v.setVisible(def.rhd.hide, false); }
    v.setVisible(['Plate_EU'], opts.plate !== 'us'); v.setVisible(['Plate_US'], opts.plate === 'us');
    // anchor for the lights hotspot: the front marker raised to light-bar height
    const lights = new THREE.Object3D(); lights.name = 'LightsAnchor'; lights.position.set(0, 0.75, -2.3); v.glbRoot.add(lights); v.nodes.LightsAnchor = lights;
    await Promise.all([v.loadWheels(opts.wheels || 'Crossflow19'), v.loadBrakes(), v.loadAnimations()]);
    for (const group of Object.values(def.lights)) { group.on.forEach(n => v.setVisible([n], false)); (group.off || []).forEach(n => v.setVisible([n], true)); }
    return v;
  }

  setVisible(names: string[], on: boolean) { for (const n of names) if (this.nodes[n]) this.nodes[n].visible = on; }

  private async loadWheels(type: string) {
    const w = WHEELS[type] || WHEELS.Crossflow19;
    const [gltf, ov] = await Promise.all([loadGltf(w.glb), fetchJson<SceneOverrides>(`${w.dir}/scene-overrides.json`).catch(() => null)]);
    const scene = gltf.scene;
    if (ov) {
      const byName: Record<string, THREE.Object3D> = {};
      applyOverrides(scene, ov, byName, this.factory);
      // the .tscn overrides the single mesh child by its Godot name; GDRE renames it in the GLB (e.g. GeminiDark → GeminiDark2)
      const mesh = scene.getObjectByProperty('isMesh', true) as THREE.Mesh | undefined;
      const slots = (Object.values(ov.nodes) as SceneOverrides['nodes'][string][]).find(n => n.materials)?.materials;
      if (mesh && slots) { const ms = meshesOf(mesh.parent!.children.length > 1 ? mesh.parent! : mesh); for (const [slot, key] of Object.entries(slots)) if (ms[+slot]) ms[+slot].material = this.factory.build(ov.materials[key], key); }
    }
    for (const n of ['Wheel_LF_Spatial', 'Wheel_RF_Spatial', 'Wheel_RL_Spatial', 'Wheel_RR_Spatial']) this.nodes[n]?.add(scene.clone(true));
  }

  private async loadBrakes() {
    const [f, r] = await Promise.all([fetchJson<SceneOverrides>('brakes/Brakes_Std_F.json'), fetchJson<SceneOverrides>('brakes/Brakes_Std_R.json')]);
    const T = this.factory.textures;
    const mat = new THREE.MeshStandardMaterial({ map: T.texture('brakes/Textures/Brakes_Std_BC.png', { color: true }),
      metalnessMap: T.packed('brakes/Textures/Brakes_Std_MRA.png', 0, 2), roughnessMap: T.packed('brakes/Textures/Brakes_Std_MRA.png', 1, 1), metalness: 1, roughness: 1 });
    for (const [pivot, ov] of [['Brake_LF_Spatial', f], ['Brake_RF_Spatial', f], ['Brake_RL_Spatial', r], ['Brake_RR_Spatial', r]] as const) {
      const { root } = await loadObjScene(ov, this.factory, () => mat);
      const p = this.nodes[pivot]; if (p) { p.add(root); p.visible = true; }
    }
  }

  private async loadAnimations() {
    const names = [...new Set(Object.values(CLOSURE_ANIMS).flat())];
    await Promise.all(names.map(async n => { try { this.anims[n] = await fetchJson<AnimJson>(`${this.def.dir}/animations/json/${n}.json`); } catch { /* not every model has every clip */ } }));
  }

  // ---------- closures ----------
  /** open/close a closure; animate=false seeks to the end state immediately (initial sync) */
  setClosure(channel: string, open: boolean, animate = true) {
    for (const name of CLOSURE_ANIMS[channel] || []) {
      const json = this.anims[name]; if (!json) continue;
      const p = this.players[name] || (this.players[name] = { t: 0, dir: 0, json });
      if (animate) p.dir = open ? 1 : -1;
      else { p.t = open ? json.length : 0; p.dir = 0; this.applyAnim(json, p.t); }
    }
  }
  private applyAnim(j: AnimJson, t: number) {
    for (const tr of j.tracks) {
      const node = this.nodes[tr.nodePath.split('/').pop()!]; if (!node) continue;
      const k = tr.keys; let s: { position: number[]; quaternion: number[]; scale: number[] };
      if (t <= k[0].time) s = k[0]; else if (t >= k[k.length - 1].time) s = k[k.length - 1];
      else { let i = 1; while (k[i].time < t) i++; const a = k[i - 1], b = k[i], f = (t - a.time) / (b.time - a.time);
        s = { position: new THREE.Vector3().fromArray(a.position).lerp(new THREE.Vector3().fromArray(b.position), f).toArray(),
              quaternion: new THREE.Quaternion().fromArray(a.quaternion).slerp(new THREE.Quaternion().fromArray(b.quaternion), f).toArray(), scale: a.scale }; }
      node.position.fromArray(s.position); node.quaternion.fromArray(s.quaternion); node.scale.fromArray(s.scale);
    }
  }

  // ---------- lights ----------
  setLights(states: Record<string, boolean>) {
    Object.assign(this.lightState, states);
    this.applyLights();
  }
  private applyLights() {
    const on = new Set<string>(), offHide = new Set<string>();
    const flashing = this.flash && performance.now() < this.flash.until;
    for (const [name, g] of Object.entries(this.def.lights)) {
      const active = this.lightState[name] || (flashing && (name === 'headlights' || name === 'drl'));
      if (active) { g.on.forEach(n => on.add(n)); (g.off || []).forEach(n => offHide.add(n)); }
    }
    for (const g of Object.values(this.def.lights)) { g.on.forEach(n => this.setVisible([n], on.has(n))); (g.off || []).forEach(n => this.setVisible([n], !offHide.has(n))); }
  }
  /** VehicleManager.on_flash_headlights: flash_duration 1.5 s, flash_interval 1 s */
  flashLights(count = 1, onChange?: () => void) {
    if (this.flash) clearTimeout(this.flash.timer);
    let i = 0;
    const step = () => {
      if (i++ >= count) { this.flash = undefined; this.applyLights(); onChange?.(); return; }
      this.flash = { until: performance.now() + 1500, timer: setTimeout(() => { this.applyLights(); onChange?.(); this.flash!.timer = setTimeout(step, 1000); }, 1500) };
      this.applyLights(); onChange?.();
    };
    step();
  }

  // ---------- charge cable ----------
  /** plugged → CCS2 cable in the port (Vehicle.gd::update_charge_state); state drives PowerflowSingle */
  setCable(plugged: boolean, state: ChargingState) {
    if (!plugged) { if (this.cable) this.cable.group.visible = false; return; }
    if (!this.cable) {
      if (!this.cablePending) this.cablePending = this.loadCable();
      this.cablePending.then(() => this.setCable(true, state));
      return;
    }
    this.cable.group.visible = true;
    this.cable.state = state;
    const f = this.cable.flow.flow;
    // port LED colours: green flowing while charging, solid green when complete, amber pulse when stopped / no power
    if (state === 'charging') { f.uFlowState.value = 1; f.uFlowColor.value.setRGB(0.18, 0.8, 0.44); }
    else if (state === 'complete') { f.uFlowState.value = 3; f.uFlowColor.value.setRGB(0.18, 0.8, 0.44); }
    else if (state === 'stopped') { f.uFlowState.value = 2; f.uFlowColor.value.setRGB(1.0, 0.69, 0.0); }
    else { f.uFlowState.value = 0; }
  }
  private async loadCable() {
    const ov = await fetchJson<SceneOverrides>('charging/Charging_Cable/Charging_Cable_CCS2_V3.json');
    const T = this.factory.textures;
    const flow = new FlowMaterial(T.texture('charging/Charging_Cable/Textures/Charging_Cable_CCS2_V3_BC.png', { color: true }),
                                  T.packed('charging/Charging_Cable/Textures/Charging_Cable_CCS2_V3_MRA.png', 1, 1));
    flow.transparent = true;
    const { root } = await loadObjScene(ov, this.factory, (node) => node === 'Charger_Cable' ? flow : undefined);
    root.name = 'ChargeCable';
    (this.nodes.ChargePortMarker || this.glbRoot).add(root);
    this.cable = { group: root, flow, state: 'unknown' };
  }

  /** advance animations; returns true while something is still moving (caller keeps rendering) */
  update(dt: number): boolean {
    let busy = false;
    for (const p of Object.values(this.players)) {
      if (p.dir === 0) continue;
      p.t = THREE.MathUtils.clamp(p.t + dt * p.dir, 0, p.json.length); this.applyAnim(p.json, p.t);
      if ((p.dir > 0 && p.t >= p.json.length) || (p.dir < 0 && p.t <= 0)) p.dir = 0; else busy = true;
    }
    if (this.cable?.group.visible && this.cable.flow.flow.uFlowState.value !== 0) {
      const u = this.cable.flow.flow; u.uTime.value = (u.uTime.value + dt) % u.uPulseFreq.value; busy = true;
    }
    if (this.flash) busy = true;
    return busy;
  }

  dispose() { this.root?.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); }); }
}
