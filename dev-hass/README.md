# dev-hass – throwaway Home Assistant for developing the Tesla View card

A real Home Assistant (Docker, `ghcr.io/home-assistant/home-assistant:stable`) with the integration mounted live from
`../custom_components`, a set of **dummy Model Y entities** and two dashboards. Use it to test what the mock harness
(`card/dev/`) cannot: the integration's Python (pack upload, repairs, resource registration), real `hass` objects, the
visual editor and the HA theme.

## Start

```bash
cd dev-hass
docker compose up -d                                  # first start pulls the image (~1 GB) and boots HA in ~30 s
python3 setup.py --pack ../path/to/tesla-view-pack-bayberry.zip
```

`setup.py` completes onboarding (owner `dev` / `dev`), adds the Tesla View integration, creates the dashboards, uploads
the pack through the integration's options flow (`--pack`, optional) and checks the index and the Repairs state. It is
idempotent; run it again after wiping `ha-config/.storage` or to check the state. It prints a short-lived REST token.

Then log in with `dev` / `dev` and open

- <http://localhost:8123/tesla-view> – YAML dashboard: the card next to controls for every dummy state;
- <http://localhost:8123/dev-cards> – storage-mode dashboard so the card's **visual editor** can be used: edit mode →
  card → *Edit*.

Without `--pack` the integration raises the *Repairs* item "Tesla View has no asset pack" and the card shows where to
get one – the state every new user sees first. Build packs with
[tesla-view-extractor](https://github.com/koenhendriks/tesla-view-extractor).

## Iterating

- **Card**: `cd card && npm run build`. The integration folder is bind-mounted, so the new bundle is served at once, but
  **Home Assistant's service worker caches `/tesla_view/tesla-view-card.js?v=…`** in the browser; a plain (even hard)
  refresh keeps the old bundle. Bump `VERSION` in `custom_components/tesla_view/const.py` (new URL → cache miss; that is
  what a release does) or, for quick iterations, clear the service worker once: DevTools → Application → Service
  workers → *Unregister* (+ *Clear storage*), or in the console

  ```js
  navigator.serviceWorker.getRegistrations().then(r => r.forEach(x => x.unregister())); caches.keys().then(k => k.forEach(c => caches.delete(c))); location.reload();
  ```

- **Python** (integration) or `ha-config/packages` / `dashboards`: `docker compose restart` (or Developer tools →
  YAML → *All YAML configuration* for the package/dashboard).
- **Packs**: upload via the UI (Configure → Upload), `python3 setup.py --pack file.zip`, or Repairs → Fix. Installed packs
  live in `ha-config/tesla_view/packs/` (root-owned like everything HA writes, gitignored).

## What is in `ha-config/`

| file | |
|---|---|
| `configuration.yaml` | `default_config`, loads `packages/`, declares the YAML dashboard `tesla-view` |
| `packages/tesla_dummy.yaml` | the dummy vehicle – see below |
| `dashboards/tesla-view.yaml` | dashboard: Tesla View card (`entities:` mapped to the dummies) + entity cards to flip each state |
| everything else | runtime state written by HA (`.storage/`, db, logs, `tesla_view/` packs) – gitignored, owned by root |

## The dummy Model Y

Same entity shapes the core Tesla Fleet integration creates, backed by helpers you can flip in the UI or via the API:

| card channel | entity | backing helper |
|---|---|---|
| frunk / trunk / charge_port | `cover.model_y_frunk`, `cover.model_y_trunk`, `cover.model_y_charge_port_door` | `input_boolean.tesla_frunk` / `_trunk` / `_charge_port` |
| lock | `lock.model_y_lock` | `input_boolean.tesla_locked` |
| door_fl … door_rr | `binary_sensor.model_y_{front,rear}_{driver,passenger}_door` | `input_boolean.tesla_door_{fl,fr,rl,rr}` |
| window_fl … window_rr | `binary_sensor.model_y_…_window` | `input_boolean.tesla_window_{fl,fr,rl,rr}` |
| charge_cable | `binary_sensor.model_y_charge_cable` | `input_boolean.tesla_charge_cable` |
| charging | `sensor.model_y_charging` (disconnected/no_power/starting/charging/complete/stopped) | `input_select.tesla_charging_state` |
| headlights / drl | `binary_sensor.model_y_headlights`, `binary_sensor.model_y_daytime_running_lights` | `input_boolean.tesla_headlights` / `_drl` |
| flash_lights | `button.model_y_flash_lights` (blinks the headlights twice) | – |

Commands from the card (`cover.open_cover`, `lock.unlock`, …) flip the helper after `input_number.tesla_latency`
seconds (default 2 s) so the card's optimistic state and confirmation path are exercised. Set it to 0 for instant, or to
30 s to watch the optimistic timeout behaviour.

These are template entities, not a `tesla_fleet` device, so the card is configured with `entities:` rather than
`device_id` (the visual editor's device picker only lists Tesla Fleet devices; the entity pickers work for anything).

## Scripted checks (REST)

```bash
TOKEN=$(python3 setup.py | sed -n 's/^access token.*: //p')
H="Authorization: Bearer $TOKEN"; U=http://localhost:8123
curl -s -H "$H" $U/api/states/cover.model_y_trunk | jq .state
curl -s -H "$H" -H 'Content-Type: application/json' -d '{"entity_id":"input_boolean.tesla_charge_cable"}' $U/api/services/input_boolean/turn_on
curl -s $U/tesla_view_assets/index.json | jq '.models | keys'
```

## Reset

```bash
docker compose down && sudo rm -rf ha-config/.storage ha-config/tesla_view ha-config/*.db* ha-config/*.log* && docker compose up -d && python3 setup.py
```
