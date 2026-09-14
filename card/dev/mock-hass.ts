// Minimal fake `hass` for developing the card without Home Assistant.
import '../src/tesla-view-card';

const DEVICE = 'dev-model-y';
const ENT: Record<string, { state: string; key: string; attributes?: any }> = {
  'cover.model_y_frunk':              { state: 'closed', key: 'vehicle_state_ft' },
  'cover.model_y_trunk':              { state: 'closed', key: 'vehicle_state_rt' },
  'cover.model_y_charge_port_door':   { state: 'closed', key: 'charge_state_charge_port_door_open' },
  'lock.model_y_lock':                { state: 'locked', key: 'vehicle_state_locked' },
  'binary_sensor.model_y_front_driver_door':    { state: 'off', key: 'vehicle_state_df' },
  'binary_sensor.model_y_front_passenger_door': { state: 'off', key: 'vehicle_state_pf' },
  'binary_sensor.model_y_rear_driver_door':     { state: 'off', key: 'vehicle_state_dr' },
  'binary_sensor.model_y_rear_passenger_door':  { state: 'off', key: 'vehicle_state_pr' },
  'binary_sensor.model_y_front_driver_window':  { state: 'off', key: 'vehicle_state_fd_window' },
  'binary_sensor.model_y_front_passenger_window': { state: 'off', key: 'vehicle_state_fp_window' },
  'binary_sensor.model_y_rear_driver_window':   { state: 'off', key: 'vehicle_state_rd_window' },
  'binary_sensor.model_y_rear_passenger_window': { state: 'off', key: 'vehicle_state_rp_window' },
  'binary_sensor.model_y_charge_cable': { state: 'off', key: 'charge_state_conn_charge_cable' },
  'sensor.model_y_charging':          { state: 'disconnected', key: 'charge_state_charging_state' },
  'button.model_y_flash_lights':      { state: 'unknown', key: 'flash_lights' },
  'binary_sensor.ble_headlights':     { state: 'off', key: '' },      // not on the device – mapped via entities:
};
const CYCLES: Record<string, string[]> = { cover: ['closed', 'open'], lock: ['locked', 'unlocked'], binary_sensor: ['off', 'on'], sensor: ['disconnected', 'charging', 'complete', 'stopped'] };

const states: Record<string, any> = {};
const now = () => new Date().toISOString();
for (const [id, e] of Object.entries(ENT)) states[id] = { entity_id: id, state: e.state, attributes: e.attributes || { friendly_name: id }, last_changed: now(), last_updated: now() };

const cards: any[] = [];
const logEl = document.getElementById('log')!;
const log = (s: string) => { logEl.textContent = `${new Date().toLocaleTimeString()} ${s}\n` + logEl.textContent; };

function setState(id: string, state: string) {
  states[id] = { ...states[id], state, last_changed: now(), last_updated: now() };
  publish();
}
function publish() {
  hass = { ...hass, states: { ...states } };
  for (const c of cards) c.hass = hass;
  renderToggles();
}

let hass: any = {
  states,
  themes: { darkMode: true },
  language: 'en',
  async callService(domain: string, service: string, data: any, target: any) {
    log(`${domain}.${service} ${JSON.stringify({ ...data, ...target })}`);
    const id = target?.entity_id || data?.entity_id;
    if (domain === 'cover') { setState(id, service === 'open_cover' ? 'opening' : 'closing'); setTimeout(() => setState(id, service === 'open_cover' ? 'open' : 'closed'), 1500); }
    if (domain === 'lock') { setTimeout(() => setState(id, service === 'lock' ? 'locked' : 'unlocked'), 800); }
    if (domain === 'button') { setState(id, now()); }
  },
  async callWS(msg: any) {
    log(`ws ${msg.type}`);
    if (msg.type === 'config/entity_registry/list') return Object.entries(ENT).filter(([, e]) => e.key).map(([id, e]) => ({ entity_id: id, device_id: DEVICE, translation_key: e.key, platform: 'tesla_fleet', disabled_by: null }));
    return [];
  },
};

function renderToggles() {
  const t = document.getElementById('toggles')!; t.innerHTML = '';
  for (const id of Object.keys(ENT)) {
    const b = document.createElement('button'); const st = states[id].state;
    b.textContent = `${id}  →  ${st}`; b.classList.toggle('on', ['open', 'on', 'unlocked', 'charging', 'complete', 'stopped'].includes(st));
    b.onclick = () => { const cyc = CYCLES[id.split('.')[0]] || ['off', 'on']; setState(id, cyc[(cyc.indexOf(st) + 1) % cyc.length]); };
    t.appendChild(b);
  }
  const theme = document.createElement('button'); theme.textContent = `theme: ${hass.themes.darkMode ? 'dark' : 'light'}`;
  theme.onclick = () => { hass.themes.darkMode = !hass.themes.darkMode; document.body.style.background = hass.themes.darkMode ? '#111' : '#eee'; publish(); }; t.appendChild(theme);
}

const configs = [
  { type: 'custom:tesla-view-card', device_id: DEVICE, paint: 'Quicksilver', entities: { headlights: 'binary_sensor.ble_headlights' } },
];
const params = new URLSearchParams(location.search);
if (params.get('second')) configs.push({ type: 'custom:tesla-view-card', device_id: DEVICE, model: 'standard', paint: 'UltraRed', camera: 'top_down', aspect_ratio: '4:3' } as any);
for (const cfg of configs) {
  const card = document.createElement('tesla-view-card') as any;
  card.setConfig(cfg); card.hass = hass; cards.push(card);
  document.getElementById('cards')!.appendChild(card);
}
renderToggles();
(window as any).__mock = { setState, states, cards, hass: () => hass };
