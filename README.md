# Tesla View – interactive 3D Tesla card for Home Assistant

A Home Assistant custom integration + Lovelace card that shows your Model Y as an interactive 3D model rendered the way
the Tesla app renders it (same meshes, materials, lighting), driven by your Home Assistant entities: doors, windows,
frunk, trunk, charge port, charge cable + charging flow, lock and lights. Hotspots on the car fire real actions
(open frunk/trunk, open/close charge port, lock/unlock, flash lights) through the Tesla Fleet integration – or through any
other entity you map (BLE, MQTT…).

![card](extracted/preview-ha-card.jpeg)

## Install

1. Copy `custom_components/tesla_view/` into your Home Assistant `config/custom_components/` (the folder already
   contains the built card and ~60 MB of 3D assets under `frontend/`).
2. Restart Home Assistant.
3. Settings → Devices & services → **Add integration** → *Tesla View*. This serves the card at `/tesla_view/…` and
   registers `tesla-view-card.js` as a dashboard resource (storage-mode dashboards; in YAML mode add the resource
   printed in the log manually).
4. Add a card: *Manual* → paste the YAML below, or pick **Tesla View** from the card picker and use the visual editor.

## Card configuration

```yaml
type: custom:tesla-view-card
device_id: <your Tesla Fleet vehicle device>   # entities are auto-mapped from this device
model: juniper          # juniper (2025+ Model Y Premium/Performance) | standard (Model Y Standard)
trim: premium           # premium | performance
paint: Quicksilver      # any name from extracted/paint-colors.json
wheels: Crossflow19     # Crossflow19 | HelixV220 | HelixV220Dark
plate: eu               # eu | us
theme: auto             # auto (follows HA dark mode) | dark | light
camera: parked          # parked | top_down | free
aspect_ratio: "16:9"    # or height: 360
hotspots: true
```

### Mapping entities (optional)

With `device_id` the card reads the Tesla Fleet entity registry and maps every channel by its `translation_key`
(`vehicle_state_ft` → frunk, `vehicle_state_rt` → trunk, `charge_state_charge_port_door_open` → charge port,
`vehicle_state_locked` → lock, `vehicle_state_df/pf/dr/pr` → doors, `…_window` → windows, `charge_state_conn_charge_cable`
→ cable, `charge_state_charging_state` → charging, `flash_lights` → flash). Any channel can be pointed at any entity from
any integration instead – useful for local BLE data:

```yaml
entities:
  frunk: cover.model_y_frunk
  trunk: cover.model_y_trunk
  charge_port: cover.model_y_charge_port_door
  charge_cable: binary_sensor.ble_charge_cable_connected
  charging: sensor.model_y_charging          # charging|starting → flow, complete → solid, stopped|no_power → amber pulse
  lock: lock.model_y_lock
  door_fl: binary_sensor.model_y_front_driver_door      # door_fr door_rl door_rr, window_fl … window_rr
  headlights: binary_sensor.ble_headlights   # no Fleet equivalent – optional
  drl: …
  flash_lights: button.model_y_flash_lights
states:                                       # what counts as "on" / which enum values mean what
  headlights: { on: ["on", "true", "1"] }
  charging: { charging: [charging, starting], complete: [complete], stopped: [stopped, no_power] }
actions:                                      # override the service a hotspot calls
  trunk_open: { action: cover.open_cover, target: { entity_id: cover.model_y_trunk } }
  # keys: frunk_open trunk_open trunk_close charge_port_open charge_port_close lock unlock flash_lights
rhd: false                                    # right-hand drive: swaps driver/passenger sides and the dashboard
```

Default readers: `cover` open/opening → open, `lock` locked → locked, everything else `on`. Commands are shown
optimistically for up to 60 s until the entity confirms; failures (e.g. missing vehicle command key) show a toast.

## Repository layout

| path | |
|---|---|
| `custom_components/tesla_view/` | the HA integration; `frontend/` holds the built `tesla-view-card.js` and `assets/` |
| `card/` | card source (TypeScript, Lit, three.js, Vite). `npm run dev` opens a harness with a mock `hass`; `npm run build` rebuilds the bundle + assets into the integration |
| `tools/build-assets.py` | copies only the referenced assets from `extracted/` into the integration |
| `extracted/` | everything recovered from the Tesla app (models, textures, materials, decompiled scripts, converters, standalone `viewer.html`) – see `extracted/README.md` |

## How the 3D side works

The assets come from the Tesla Android app's embedded Godot project (recovered with GDRE Tools). The card loads the
scene GLB, applies the app's per-surface materials and node transforms from `scene-overrides.json`
(`extracted/tools/godot2three.py`), reproduces the app's GLES2 gamma-space lighting with its studio panorama, plays the
app's own closure animations and uses the app's `Marker` nodes as hotspot anchors. Details in `extracted/README.md`.

These assets are © Tesla, Inc.; this repository is for personal use with your own car.
