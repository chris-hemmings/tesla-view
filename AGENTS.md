# AGENTS.md – Tesla View

Home Assistant custom integration + Lovelace card that renders a Tesla as an interactive three.js scene from an **asset
pack** the user builds from their own copy of the Tesla app with the sibling project
[tesla-view-extractor](https://github.com/koenhendriks/tesla-view-extractor). Read this before touching anything;
`README.md` is the user-facing install/config reference.

## Ground rules

- **No Tesla material in this repo, ever.** No models, textures, animations, decompiled scripts, paint tables or
  node-name tables. Everything model-specific comes from the pack manifest at runtime; the card source must stay free of
  Tesla-internal node names (the old `MODELS`/`WHEELS`/`CLOSURE_ANIMS` tables are gone on purpose). Vehicle codenames may
  appear only in docs as examples.
- The extractor owns the **pack format** (format 1); the card and integration consume it. Reference:
  `tesla-view-extractor/docs/asset-pack-format.md`. Additive fields are fine; a breaking change bumps `format` in both
  repos and `PACK_FORMAT` in `custom_components/tesla_view/packs.py`.
- Match the Tesla app, not "nicer". The app renders in Godot 3.2 **GLES2 gamma space**: no tone mapping, LinearSRGB
  output, textures without sRGB decode, one studio panorama for reflections and ambient. Lighting/camera presets, paint
  values and light-node groups come from the pack; if something looks off, fix the mapping, not the values.
- Hotspots exist only for actions the Fleet API can perform: frunk open (no close – the label says so), trunk open/close,
  charge port open/close, lock/unlock, flash lights. Doors/windows are display-only.

## Repository map

| path | what | notes |
|---|---|---|
| `custom_components/tesla_view/__init__.py` | integration setup | serves `frontend/` at `/tesla_view/` and `<config>/tesla_view/` at `/tesla_view_assets/`; registers the Lovelace resource `…?v=<VERSION>&assets=/tesla_view_assets/&p=<index rev>`; Repairs issue while no pack |
| `custom_components/tesla_view/packs.py` | pack store, **pure Python** | validate zip (manifest, format, ids, zip-slip), unpack to `packs/<ids>-<sha8>/`, replace packs with overlapping models, write `index.json`. Reused by `tools/dev-assets.py` |
| `custom_components/tesla_view/config_flow.py`, `repairs.py` | config flow (optional upload), options flow (upload / remove), repair fix flow (upload) | `FileSelector` + `process_uploaded_file`; `PackError.code` == `strings.json` error key |
| `custom_components/tesla_view/frontend/tesla-view-card.js` | **build output**, not committed | CI builds it; HACS installs the release zip |
| `card/src/pack.ts` | pack index/manifest types, `PackLoader`, `resolveModel/Wheel/Paint/Cable` | id → alias → codename → API key → pack default |
| `card/src/scene/assets.ts` | asset base resolution, loaders, `TextureCache` | base = `window.TESLA_VIEW_ASSET_BASE` → `?assets=` on the module URL → `./assets/`; JSON cache keyed by absolute URL |
| `card/src/scene/vehicle.ts` | `Vehicle.load({manifest, modelId, base, …})` | applies overrides + variants + lights from the manifest; wheels/brakes/cable/animations by pack paths; marker anchors |
| `card/src/scene/materials.ts` | `MaterialFactory` | `MaterialDesc` (pack overrides) → three.js materials (car paint, tinted glass, pbr, beam glow) |
| `card/src/tesla-view-card.ts` | the `<tesla-view-card>` element | index → manifest → vehicle; environment/camera presets; hotspots; optimistic state; no-pack notice |
| `card/src/editor.ts` | visual editor | models/wheels/paints/presets/variants from the pack; *Entities* picker per channel; `states:`/`actions:` stay YAML |
| `card/src/ha/channels.ts` | entity ↔ channel mapping | Tesla Fleet `translation_key` table, readers, default actions |
| `card/src/hotspots.ts` | ring/dot/leader-line hotspots | anchored on marker nodes from the pack |
| `card/dev/` | mock-hass harness | `npm run dev:assets -- pack.zip` first; `window.__mock.setState(id, state)`; `?model=&second=<id>&paint=&wheels=` |
| `tools/dev-assets.py` | install pack zips into `card/dev/public/tesla_view/` (gitignored) | same `packs.py` code path as HA |
| `tools/smoke-server.py` | serve the built bundle + packs under HA-like URLs | `python3 tools/smoke-server.py` → http://127.0.0.1:8766/ |
| `dev-hass/` | Docker Home Assistant with dummy Model Y template entities and two dashboards | `docker compose up -d && python3 setup.py --pack pack.zip`; login dev/dev; see `dev-hass/README.md` |

## Commands

```bash
cd card && npm install
npm run dev:assets -- /path/to/tesla-view-pack-x.zip   # once per pack (harness + smoke server)
npm run dev                                            # Vite harness on http://127.0.0.1:5173/dev/index.html (strict port)
npm run typecheck                                      # tsc --noEmit
npm run build                                          # tsc + vite build → custom_components/tesla_view/frontend/tesla-view-card.js
python3 tools/smoke-server.py                          # built bundle as HA serves it
cd dev-hass && docker compose up -d && python3 setup.py --pack /path/to/pack.zip   # real HA on :8123
```

There is no unit test suite for the card; verification is visual (harness, smoke server, dev-hass) – the
`tesla-view-dev` skill (`.claude/skills/tesla-view-dev/`) describes the loop, including headless checks via Chrome
DevTools. A pack to test with is produced by the extractor (`tesla-view-extract <bundle> --models bayberry`).

## Paths and caching

- Bundle: `/tesla_view/tesla-view-card.js?v=<VERSION>&assets=/tesla_view_assets/&p=<rev>`. `v` busts the bundle, `p`
  the index, hashed pack directories the assets (served with cache headers). Home Assistant's service worker caches
  the bundle URL aggressively: **a new bundle needs a `VERSION` bump** to reach browsers that loaded the old one.
- Do **not** write `new URL('./assets/', import.meta.url)` literally in `assets.ts` – Vite rewrites it as an asset
  import. The variable-based form is deliberate.
- Vite emits a single ES module (`inlineDynamicImports`, no code splitting, no CDN). HA loads exactly one resource.
- The integration must keep working on HA ≥ 2024.7 (`async_register_static_paths`; the legacy fallback is kept) and
  with dict- and object-style `hass.data["lovelace"]`. Create the data dir **before** registering the static path: a
  missing directory is silently never served.

## Adding things

- **New state channel**: `ChannelId` (types.ts) → `CHANNELS` + `DISCOVERY` + reader (channels.ts) → `VehicleState` →
  `applyState()` (card) → `CHANNEL_DOMAINS`/`LABELS` (editor.ts) → mock entity (`card/dev/mock-hass.ts`) → dummy
  (`dev-hass/ha-config/packages/tesla_dummy.yaml`) → README table.
- **New manifest field**: add it in the extractor first (format doc + tests), then read it here with a fallback so older
  packs keep working.
- **New vehicle**: nothing to do here – rules live in the extractor (`rules/<codename>.yaml`); the card renders whatever
  the manifest describes (GLB-based vehicles only for now; `kind: obj` scenes raise a clear error).

## Release

1. Bump `VERSION` in `custom_components/tesla_view/const.py`, `version` in `manifest.json` and `card/package.json` (same value).
2. `git commit -m "chore(release): x.y.z"`, `git tag vx.y.z`, push branch and tag.
3. `.github/workflows/release.yml` builds the card, zips `custom_components/tesla_view` (contents at zip root) as
   `tesla_view.zip` and attaches it to a GitHub release; HACS (`zip_release`) installs that file.
4. GitHub remote `git@github.com:koenhendriks/tesla-view.git`, branch `main`, conventional commits.
