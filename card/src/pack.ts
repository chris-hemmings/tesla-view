// Asset packs: the index the integration writes (`index.json`) and the manifest each pack carries (`manifest.json`).
// Format reference: https://github.com/koenhendriks/tesla-view-extractor/blob/main/docs/asset-pack-format.md
import { fetchJson } from './scene/assets';
import type { Paint } from './scene/materials';

export interface PackIndexModel {
  pack: string; name: string; codename?: string | null; aliases: string[];
  api_match: { model_key?: string | null; fascia_type?: string[]; chassis_type?: string[] };
  variants: string[]; wheel_family?: string | null; default_wheel?: string | null; wheels: string[];
}
export interface PackIndex {
  format: number; rev: string; default_model: string | null;
  packs: Record<string, { dir: string; app_version?: string | null; models: string[]; wheels: string[]; paints: string[] }>;
  models: Record<string, PackIndexModel>;
}

export interface LightGroup { on: string[]; off?: string[] }
export interface Marker { name: string; node: string; parent: string | null; position: number[]; kind: 'marker' | 'locator' | string }
export interface Variant { show: string[]; hide: string[] }
export interface ModelDef {
  name: string; codename?: string; aliases?: string[]; kind: 'glb' | 'obj'; dir: string; glb: string | null; overrides: string; root?: string;
  animations: Record<string, string>; closures: Record<string, string[]>; bindings: Record<string, string>;
  show: string[]; hide: string[]; variants: Record<string, Variant | null>;
  lights: Record<string, LightGroup>; lights_eu?: Record<string, LightGroup> | null;
  pivots: { wheels: string[]; brakes: string[]; charge_port?: string | null; front?: string | null; rear?: string | null };
  markers: Marker[]; brakes: Record<string, { front?: string; rear?: string }>; brakes_default?: string | null;
  wheel_family?: string | null; default_wheel?: string | null; warnings?: string[];
}
export interface WheelDef {
  internal: string; family?: string; dir: string; scene?: string; kind: 'glb' | 'obj' | 'unsupported';
  glb?: string | null; root?: string; overrides?: string | null; root_matrix?: number[] | null; reason?: string;
}
export interface CableDef { overrides: string; flow_node: string | null; root?: string }
export interface EnvPreset { sky_rot_deg: number[]; env_energy: number; amb_energy: number; camera: { pivot_deg: number[]; offset: number[]; target?: number[] } }
export interface PackEnvironment {
  panorama: string | null; renderer: string; presets: Record<string, EnvPreset>; fallback: string;
  fallback_energy?: { env_energy: number; amb_energy: number }; fov: number; bg: { dark: string; light: string };
  flash: { duration_s: number; interval_s: number };
}
export interface PackManifest {
  format: number; app_version?: string | null; generated_by?: { tool: string; version: string };
  models: Record<string, ModelDef>; wheels: Record<string, WheelDef>; wheel_aliases: Record<string, string>;
  cables: Record<string, CableDef>;
  paints: { base_roughness: number; base_metallic?: number; fallback: Paint | null; colors: Record<string, Paint> };
  environment: PackEnvironment; warnings?: string[];
}

export class PackLoader {
  constructor(readonly root: string) {}

  /** `index.json` next to the packs; null when the integration has not written one (no pack installed / old version). */
  async index(rev?: string | null): Promise<PackIndex | null> {
    try { return await fetchJson<PackIndex>('index.json' + (rev ? `?p=${encodeURIComponent(rev)}` : ''), this.root, { noStore: true }); }
    catch { return null; }
  }
  baseOf(index: PackIndex, packId: string) { return new URL(index.packs[packId].dir, this.root).href; }
  async manifest(index: PackIndex, packId: string) { return fetchJson<PackManifest>('manifest.json', this.baseOf(index, packId)); }

  /** exact id → alias → codename → API model_key → the index default. */
  static resolveModel(index: PackIndex | null, want?: string | null): { id: string; entry: PackIndexModel } | null {
    if (!index || !Object.keys(index.models).length) return null;
    const models = Object.entries(index.models);
    const w = (want || '').toLowerCase();
    if (w) {
      const hit = models.find(([id]) => id === w)
        || models.find(([, m]) => (m.aliases || []).some(a => a.toLowerCase() === w))
        || models.find(([, m]) => (m.codename || '').toLowerCase() === w)
        || models.find(([, m]) => (m.api_match?.model_key || '').toLowerCase() === w);
      if (hit) return { id: hit[0], entry: hit[1] };
      console.warn(`tesla-view-card: model "${want}" is not in any installed asset pack; using ${index.default_model}`);
    }
    const id = index.default_model || models[0][0];
    return index.models[id] ? { id, entry: index.models[id] } : { id: models[0][0], entry: models[0][1] };
  }
}

/** API wheel name → WheelDef (exact, via wheel_aliases, or the model's default). */
export function resolveWheel(manifest: PackManifest, model: ModelDef, want?: string | null): { name: string; def: WheelDef } | null {
  const ok = (n: string | null | undefined) => n && manifest.wheels[n] && manifest.wheels[n].kind !== 'unsupported' ? { name: n, def: manifest.wheels[n] } : null;
  const norm = (want || '').replace(/_/g, '');
  const direct = ok(want) || ok(Object.keys(manifest.wheels).find(k => k.toLowerCase() === norm.toLowerCase()));
  if (direct) return direct;
  if (want && manifest.wheel_aliases[want]) {
    const enumName = manifest.wheel_aliases[want];
    const byInternal = Object.entries(manifest.wheels).find(([, w]) => w.internal === enumName)?.[0];
    const a = ok(byInternal); if (a) return a;
  }
  if (want) console.warn(`tesla-view-card: wheel "${want}" not in the asset pack; using ${model.default_wheel}`);
  return ok(model.default_wheel) || ok(Object.keys(manifest.wheels).find(k => manifest.wheels[k].family === model.wheel_family && manifest.wheels[k].kind !== 'unsupported')) || ok(Object.keys(manifest.wheels)[0]);
}

export function resolvePaint(manifest: PackManifest, want?: string | null): { name: string; paint: Paint } {
  const colors = manifest.paints?.colors || {};
  if (want && colors[want]) return { name: want, paint: colors[want] };
  const ci = want ? Object.keys(colors).find(k => k.toLowerCase() === want.toLowerCase()) : undefined;
  if (ci) return { name: ci, paint: colors[ci] };
  if (want) console.warn(`tesla-view-card: paint "${want}" not in the asset pack`);
  if (manifest.paints?.fallback) return { name: 'fallback', paint: manifest.paints.fallback };
  const first = Object.keys(colors)[0];
  return first ? { name: first, paint: colors[first] } : { name: 'default', paint: { albedo: '#2b2d35', metallic: 0.85, roughness: 0.2 } };
}

export function resolveCable(manifest: PackManifest, want: string | undefined, plate: 'eu' | 'us' | undefined): CableDef | null {
  const c = manifest.cables || {};
  if (want && want !== 'auto' && c[want]) return c[want];
  if (plate === 'us' && c.US) return c.US;
  return c.CCS || c.EU || c.US || Object.values(c)[0] || null;
}
