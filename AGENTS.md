# AGENTS.md – Tesla View

Home Assistant custom integration + Lovelace card that renders Koen's Tesla Model Y as an interactive three.js scene
built from the official Tesla app's own 3D assets. Read this before touching anything; `README.md` is the user-facing
install/config reference, `extracted/README.md` is the deep asset reference.

## Ground truth about the car and the assets

- The car: 2026 Model Y **Premium** Long Range RWD ("Juniper" refresh), paint **Quicksilver**, wheels **Crossflow19**,
  EU/NL spec, left-hand drive. Card defaults (`DEFAULTS` in `card/src/tesla-view-card.ts`) match this.
- Tesla codenames (from `ProductManager.gd`): `Bayberry` = 2025+ Model Y Premium/Performance = **this car**
  (`extracted/model-y-juniper/`, `Fascia_Standard` visible). `BayberryE41` = Model Y *Standard* (corner lamps, no light
  bar, `extracted/model-y-standard-e41/`) – supported as `model: standard`, **not** the user's car. `BayberryE80` = Model Y L,
  `Y_High` = pre-2025 Model Y, `Poppyseed` = Model 3 Highland, `Palladium` = S/X refresh. Wheel `Crossflow19` = Godot scene
  `GeminiDark`; `HelixV220(Dark)` = `Helix2(_Dark)`.
- **A GLB alone renders wrong** (white interior, purple decor, transparent roof, wheel pivots at origin). Always apply the
  sibling `scene-overrides.json` (node matrices, visibility, per-surface materials) – generated from the `.tscn` by
  `extracted/tools/godot2three.py`. `card/src/scene/vehicle.ts` → `applyOverrides()` / `createTscnNodes()` does this.
- Godot MRA textures pack metallic/roughness/AO in arbitrary channels; three.js wants AO=R, roughness=G, metalness=B.
  `TextureCache.packed()` in `card/src/scene/assets.ts` re-packs per material – don't bypass it.
- The app renders in Godot **GLES2 gamma space**: no lights, one panorama (`shared/environment/studio/New_Studio.png`),
  sky rotation (0,−7,83)°, env/ambient energy 4, background `#161718`, camera fov 40, "parked" pivot (68.6,−138,0)°.
  Quicksilver is intentionally dark (albedo `#2b2d35`, metallic 0.85, roughness 0.2); the reflections give it its look.
  If it "looks too dark", the fix is lighting/tone mapping parity with the app, not brightening the paint.
- Assets are © Tesla. `*.apks` and `extracted/full-godot-project-recovered/` stay local (gitignored). Never add code that
  downloads or redistributes them elsewhere. Re-extraction recipe lives in `extracted/README.md` (GDRE Tools 2.6.4).

## Repository map

| path | what | notes |
|---|---|---|
| `custom_components/tesla_view/` | HA integration (Python) | Only serves `frontend/` at `/tesla_view/` and registers the Lovelace resource. **No vehicle logic here.** |
| `custom_components/tesla_view/frontend/` | **build output** – `tesla-view-card.js` + `assets/` (~60 MB) | Committed on purpose so users install by copying the folder. Regenerate with `npm run build`; never hand-edit. |
| `card/src/tesla-view-card.ts` | the `<tesla-view-card>` Lit element | config, camera, theme, hotspots wiring, optimistic state, render-on-demand loop |
| `card/src/scene/vehicle.ts` | `MODELS`, `WHEELS`, `CLOSURE_ANIMS`, `Vehicle` class | node-name tables per model, closure animations, light groups, charge cable + flow shader |
| `card/src/scene/materials.ts` | `MaterialFactory` | `MaterialDesc` (converter output) → three.js materials incl. car paint, tinted glass |
| `card/src/scene/assets.ts` | loaders, `ASSET_BASE`, `TextureCache` | asset URL resolution (see "Paths" below) |
| `card/src/ha/channels.ts` | entity ↔ channel mapping | `DISCOVERY` (Tesla Fleet `translation_key` table), `readBool`, `readCharging`, `actionFor` |
| `card/src/hotspots.ts` | ring/dot/leader-line hotspots | anchored on the scene's Godot `Marker` nodes |
| `card/src/editor.ts` | visual card editor (`ha-form` schema) | device + look + expandable *Entities* section (one entity picker per channel, domain-filtered via `CHANNEL_DOMAINS`); `states:`/`actions:` stay YAML-only |
| `card/dev/` | mock-hass harness (`npm run dev`) | `window.__mock.setState(id, state)` drives it; `?second=1` adds a Standard/top-down card |
| `tools/build-assets.py` | copies only referenced assets `extracted/` → `frontend/assets/` | run by `npm run build`; edit `SCENES`/`EXTRA` when adding a wheel/model |
| `tools/smoke-server.py` | serves the **built** bundle under real `/tesla_view/…` paths | `python3 tools/smoke-server.py` → http://127.0.0.1:8766/ |
| `dev-hass/` | real Home Assistant in Docker with dummy Model Y template entities, a YAML dashboard (`/tesla-view`) and a storage dashboard for the visual editor (`/dev-cards`) | `docker compose up -d && python3 setup.py`; login dev/dev; see `dev-hass/README.md` |
| `extracted/` | everything recovered from the Tesla app | models, textures, `.tres/.tscn`, decompiled `.gd` scripts, `viewer.html` (standalone reference viewer), `paint-colors.json`, `wheel-map.json` |

## Commands

```bash
cd card && npm install            # once
npm run dev                       # Vite harness on http://127.0.0.1:5173/dev/index.html (strict port)
npm run typecheck                 # tsc --noEmit
npm run build                     # build-assets.py + tsc + vite build → custom_components/tesla_view/frontend/
python3 tools/smoke-server.py     # serve built bundle as HA would, open http://127.0.0.1:8766/
cd dev-hass && docker compose up -d && python3 setup.py   # real HA on :8123 with dummy entities, dashboard /tesla-view
```

There is no test suite. Verification is visual: run the harness, toggle mock entities, screenshot; for the integration
side use the real HA in `dev-hass/` (the integration folder is bind-mounted, so `npm run build` + hard refresh is enough). Use the
`tesla-view-dev` skill (`.claude/skills/tesla-view-dev/`) for the exact loop, including headless checks via Chrome
DevTools MCP (wait for `card.vehicle`, check console for errors, screenshot).

## Paths and how the card finds its assets

- In HA the bundle is `/tesla_view/tesla-view-card.js?v=<VERSION>`; assets resolve relative to the module URL →
  `/tesla_view/assets/…`. The dev harness overrides this with `window.TESLA_VIEW_ASSET_BASE`.
- Do **not** write `new URL('./assets/', import.meta.url)` literally – Vite rewrites it as an asset import. The
  variable-based form in `assets.ts` is deliberate.
- Vite builds a single ES module (`inlineDynamicImports: true`, no code-splitting, no CDN). Keep it that way: HA
  loads exactly one resource file.
- Cache busting: the resource URL carries `?v=VERSION` from `const.py`. **Bumping the version is how users get a new
  bundle.** Keep `custom_components/tesla_view/const.py` `VERSION`, `manifest.json` `version` and `card/package.json`
  `version` in sync.

## Home Assistant conventions

- Entities come from core **Tesla Fleet** (`tesla_fleet`). `device_id` auto-maps channels via the entity registry
  `translation_key` (table in `channels.ts` `DISCOVERY`). Any channel can be overridden with `entities:`; boolean
  semantics with `states:`; hotspot services with `actions:`. Preserve this layering when adding a channel:
  add to `ChannelId` (types.ts) → `CHANNELS` + `DISCOVERY` + default reader (channels.ts) → `VehicleState` → apply in
  `applyState()` (card) → `CHANNEL_DOMAINS`/`LABELS` in editor.ts → mock entity in `card/dev/mock-hass.ts` → dummy in
  `dev-hass/ha-config/packages/tesla_dummy.yaml` → README table.
- Hotspots only exist for actions the Fleet API can actually perform (frunk open, trunk open/close, charge port
  open/close, lock/unlock, flash lights). Doors/windows are display-only – don't add door hotspots.
- Commands are optimistic for 60 s until the entity confirms; failures show a toast. Tesla Fleet polls every 10 min
  while awake, so external state changes lag – that's upstream, not a card bug.
- The integration must stay compatible with `async_register_static_paths` (≥2024.7) *and* the old
  `register_static_path`, and with both dict- and object-style `hass.data["lovelace"]`.
- HA loads the card in a shadow root: only use `ha-card`, `ha-form` and CSS vars (`--primary-text-color`, …); follow
  `hass.themes.darkMode` for `theme: auto`.

## Rendering rules of thumb

- Render on demand only (`wake(ms)`); never a free-running rAF loop. Pause when off-screen (IntersectionObserver).
- One `TextureCache`/`MaterialFactory` per card; dispose on disconnect.
- Match the app, not "nicer": when in doubt, read the relevant `.gd` (`extracted/scripts/mobile/scripts/Vehicles/
  Vehicle.gd`, `Model_Y.gd`, `Bayberry.gd`, `ChargeCable.gd`) and copy its logic (which nodes toggle for which state).
- Node names in `MODELS.*.show/hide/lights` and `CLOSURE_ANIMS` must exist in the GLB/`.tscn`; check with
  `extracted/README.md` "GLB scene graph" or `python3 -c` over `scene-overrides.json` `nodes` before using a new one.

## Adding things (recipes)

- **New wheel:** convert its `.tscn` with `godot2three.py` → `extracted/wheels/<Name>/scene-overrides.json`; add to
  `SCENES` in `tools/build-assets.py`, to `WHEELS` in `vehicle.ts`, to the editor's wheel list, README.
- **New paint:** paints come from `extracted/paint-colors.json`; nothing to code. The editor lists them at runtime.
- **New model (e.g. Model Y L / BayberryE80):** extract folder + overrides, add a `MODELS` entry with its own
  show/hide/lights/closure names (they differ per scene), a `SCENES` line, editor option, README.
- **New state channel:** see the layering list under "Home Assistant conventions".

## Git / release

- Remote: `git@git.pixelfy.nl:koenhendriks/tesla-view.git` (self-hosted GitLab; use `glab`). Work on `main`.
- Commit the rebuilt `frontend/tesla-view-card.js` together with the source change that produced it.
- Release = bump the three version fields, `npm run build`, commit, push. Users re-copy the folder and restart HA.
- Python `__pycache__` and `card/node_modules` are gitignored; `.apks` must never be committed.
- `dev-hass/ha-config/` runtime state (`.storage`, db, logs) is gitignored and root-owned; only `configuration.yaml`,
  `packages/` and `dashboards/` are versioned. Never commit `.storage` (contains auth tokens).
