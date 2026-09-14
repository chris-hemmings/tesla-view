import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';

/** Where the extracted assets live. In Home Assistant the card is served from /tesla_view/tesla-view-card.js, so
 *  ./assets/ resolves to /tesla_view/assets/. The dev harness overrides it via window.TESLA_VIEW_ASSET_BASE. */
// (built with a variable, not the literal `new URL('./assets/', import.meta.url)` pattern, which Vite rewrites as an asset import)
const moduleUrl: string = import.meta.url;
export const ASSET_BASE: string =
  (globalThis as any).TESLA_VIEW_ASSET_BASE || moduleUrl.slice(0, moduleUrl.lastIndexOf('/') + 1) + 'assets/';

export const assetUrl = (rel: string) => new URL(rel, ASSET_BASE).href;

const jsonCache = new Map<string, Promise<any>>();
export function fetchJson<T = any>(rel: string): Promise<T> {
  if (!jsonCache.has(rel)) jsonCache.set(rel, fetch(assetUrl(rel)).then(r => { if (!r.ok) throw new Error(`${rel}: HTTP ${r.status}`); return r.json(); }));
  return jsonCache.get(rel)!;
}

const gltfLoader = new GLTFLoader();
const objLoader = new OBJLoader();
export const loadGltf = (rel: string) => new Promise<GLTF>((res, rej) => gltfLoader.load(assetUrl(rel), res, undefined, rej));
export const loadObj = (rel: string) => new Promise<THREE.Group>((res, rej) => objLoader.load(assetUrl(rel), res, undefined, rej));

/** Texture cache shared by all materials of a card. `gamma` = GLES2 look: no sRGB decode on colour textures. */
export class TextureCache {
  private loader = new THREE.TextureLoader();
  private cache = new Map<string, THREE.Texture>();
  constructor(private gamma: boolean) {}

  texture(rel: string, { color = false, channel = 0 } = {}): THREE.Texture {
    const k = `${rel}|${color}|${channel}`;
    let t = this.cache.get(k);
    if (t) return t;
    t = this.loader.load(assetUrl(rel));
    t.flipY = false;                                  // glTF UV convention
    t.colorSpace = color && !this.gamma ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.channel = channel;                              // 0 = TEXCOORD_0, 1 = TEXCOORD_1 (Godot "on_uv2")
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    this.cache.set(k, t);
    return t;
  }

  /** Godot packs metal/rough/AO in arbitrary channels (0=R 1=G 2=B 3=A 4=gray); three.js reads AO from R,
   *  roughness from G, metalness from B. Re-pack the requested source channel into the channel three.js expects. */
  packed(rel: string, srcChannel: number, dstChannel: number, uvChannel = 0): THREE.Texture {
    const k = `pack|${rel}|${srcChannel}|${dstChannel}|${uvChannel}`;
    let t = this.cache.get(k);
    if (t) return t;
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 4;
    const tex = new THREE.CanvasTexture(canvas);
    tex.flipY = false; tex.colorSpace = THREE.NoColorSpace; tex.channel = uvChannel;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;     // body UVs sit outside 0..1 and rely on repeat
    const img = new Image(); img.crossOrigin = 'anonymous'; img.src = assetUrl(rel);
    img.onload = () => {
      canvas.width = img.width; canvas.height = img.height;
      const g = canvas.getContext('2d')!; g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, img.width, img.height); const p = d.data; const si = Math.min(srcChannel, 3);
      for (let i = 0; i < p.length; i += 4) {
        const v = srcChannel === 4 ? (p[i] + p[i + 1] + p[i + 2]) / 3 : p[i + si];
        p[i] = p[i + 1] = p[i + 2] = 255; p[i + dstChannel] = v; p[i + 3] = 255;
      }
      g.putImageData(d, 0, 0); tex.needsUpdate = true;
    };
    this.cache.set(k, tex);
    return tex;
  }

  dispose() { for (const t of this.cache.values()) t.dispose(); this.cache.clear(); }
}
