import { LitElement, html } from 'lit';
import { fetchJson } from './scene/assets';
import { CHANNELS } from './ha/channels';
import type { CardConfig, ChannelId, HomeAssistant } from './types';

/** Domains offered by the entity picker of each channel (any entity can still be set in YAML). */
const CHANNEL_DOMAINS: Record<ChannelId, string[]> = {
  frunk: ['cover', 'binary_sensor', 'input_boolean', 'switch'],
  trunk: ['cover', 'binary_sensor', 'input_boolean', 'switch'],
  charge_port: ['cover', 'binary_sensor', 'input_boolean', 'switch'],
  lock: ['lock', 'binary_sensor', 'input_boolean', 'switch'],
  door_fl: ['binary_sensor', 'input_boolean', 'switch', 'sensor'], door_fr: ['binary_sensor', 'input_boolean', 'switch', 'sensor'],
  door_rl: ['binary_sensor', 'input_boolean', 'switch', 'sensor'], door_rr: ['binary_sensor', 'input_boolean', 'switch', 'sensor'],
  window_fl: ['binary_sensor', 'input_boolean', 'switch', 'sensor', 'cover'], window_fr: ['binary_sensor', 'input_boolean', 'switch', 'sensor', 'cover'],
  window_rl: ['binary_sensor', 'input_boolean', 'switch', 'sensor', 'cover'], window_rr: ['binary_sensor', 'input_boolean', 'switch', 'sensor', 'cover'],
  charge_cable: ['binary_sensor', 'input_boolean', 'switch', 'sensor'],
  charging: ['sensor', 'input_select', 'binary_sensor', 'switch', 'input_boolean'],
  headlights: ['binary_sensor', 'input_boolean', 'switch', 'light', 'sensor'],
  drl: ['binary_sensor', 'input_boolean', 'switch', 'light', 'sensor'],
  flash_lights: ['button', 'input_button', 'script', 'switch', 'light'],
};

const LABELS: Record<string, string> = {
  device_id: 'Tesla Fleet device', model: 'Model', trim: 'Trim', paint: 'Paint', wheels: 'Wheels', plate: 'Plate', theme: 'Theme',
  camera: 'Camera', aspect_ratio: 'Aspect ratio', rhd: 'Right-hand drive', hotspots: 'Show hotspots',
  frunk: 'Frunk', trunk: 'Trunk', charge_port: 'Charge port door', lock: 'Lock',
  door_fl: 'Front left door', door_fr: 'Front right door', door_rl: 'Rear left door', door_rr: 'Rear right door',
  window_fl: 'Front left window', window_fr: 'Front right window', window_rl: 'Rear left window', window_rr: 'Rear right window',
  charge_cable: 'Charge cable connected', charging: 'Charging state', headlights: 'Headlights', drl: 'Daytime running lights',
  flash_lights: 'Flash lights',
};

const HELPERS: Record<string, string> = {
  device_id: 'Optional. Maps every channel from the Tesla Fleet entity registry; entities below add to or override that mapping.',
  frunk: 'cover (open/closed) or on/off entity; the hotspot calls cover.open_cover',
  trunk: 'cover or on/off entity; hotspot calls cover.open_cover / close_cover',
  charge_port: 'cover or on/off entity; hotspot calls cover.open_cover / close_cover',
  lock: 'lock (locked/unlocked) or on/off entity; hotspot calls lock.lock / unlock',
  charging: 'Tesla Fleet charging state sensor (charging, complete, stopped, …) or any on/off entity',
  charge_cable: 'on = cable plugged in',
  flash_lights: 'button/script pressed by the lights hotspot',
  headlights: 'no Tesla Fleet equivalent – e.g. a BLE binary sensor',
  drl: 'no Tesla Fleet equivalent',
};

/** Visual editor: device + look + one entity picker per channel. `states:` / `actions:` overrides stay YAML. */
export class TeslaViewCardEditor extends LitElement {
  hass?: HomeAssistant;
  private config: CardConfig = { type: 'custom:tesla-view-card' };
  private paints: string[] = ['Quicksilver'];

  static properties = { hass: {}, config: { state: true }, paints: { state: true } } as any;

  setConfig(config: CardConfig) { this.config = { ...config }; }
  connectedCallback() {
    super.connectedCallback();
    fetchJson<{ colors: Record<string, any> }>('paint-colors.json').then(p => { this.paints = Object.keys(p.colors); this.requestUpdate(); }).catch(() => {});
  }

  private schema() {
    const sel = (opts: string[]) => ({ select: { mode: 'dropdown', options: opts.map(o => ({ value: o, label: o })) } });
    const entity = (ch: ChannelId) => ({ name: ch, selector: { entity: { domain: CHANNEL_DOMAINS[ch] } } });
    const group = (chs: ChannelId[]) => chs.map(entity);
    return [
      { name: 'device_id', selector: { device: { filter: { integration: 'tesla_fleet' } } } },
      { type: 'grid', name: '', schema: [
        { name: 'model', selector: sel(['juniper', 'standard']) },
        { name: 'trim', selector: sel(['premium', 'performance']) },
        { name: 'paint', selector: sel(this.paints) },
        { name: 'wheels', selector: sel(['Crossflow19', 'HelixV220', 'HelixV220Dark']) },
        { name: 'plate', selector: sel(['eu', 'us']) },
        { name: 'theme', selector: sel(['auto', 'dark', 'light']) },
        { name: 'camera', selector: sel(['parked', 'top_down', 'free']) },
        { name: 'aspect_ratio', selector: { text: {} } },
      ] },
      { type: 'grid', name: '', schema: [
        { name: 'rhd', selector: { boolean: {} } },
        { name: 'hotspots', selector: { boolean: {} } },
      ] },
      { type: 'expandable', name: 'entities', title: 'Entities', icon: 'mdi:car-connected',
        expanded: !this.config.device_id && !!this.config.entities && Object.keys(this.config.entities).length > 0,
        schema: [
          ...group(['frunk', 'trunk', 'charge_port', 'lock']),
          { type: 'grid', name: '', schema: group(['door_fl', 'door_fr', 'door_rl', 'door_rr']) },
          { type: 'grid', name: '', schema: group(['window_fl', 'window_fr', 'window_rl', 'window_rr']) },
          ...group(['charge_cable', 'charging', 'headlights', 'drl', 'flash_lights']),
        ] },
    ];
  }

  private label = (s: any) => LABELS[s.name] || s.name;
  private helper = (s: any) => HELPERS[s.name];

  private onChange(ev: CustomEvent) {
    ev.stopPropagation();
    const value = { ...ev.detail.value } as CardConfig;
    // drop cleared pickers so the YAML stays tidy and the card falls back to the device mapping
    const entities: Partial<Record<ChannelId, string>> = {};
    for (const ch of CHANNELS) { const id = (value.entities as any)?.[ch]; if (id) entities[ch] = id; }
    if (Object.keys(entities).length) value.entities = entities; else delete value.entities;
    if (!value.device_id) delete value.device_id;
    this.config = value;
    this.dispatchEvent(new CustomEvent('config-changed', { detail: { config: this.config }, bubbles: true, composed: true }));
  }

  render() {
    if (!this.hass) return html``;
    const data = { model: 'juniper', trim: 'premium', paint: 'Quicksilver', wheels: 'Crossflow19', plate: 'eu', theme: 'auto', camera: 'parked', aspect_ratio: '16:9', hotspots: true, ...this.config, entities: { ...(this.config.entities || {}) } };
    return html`<ha-form .hass=${this.hass} .data=${data} .schema=${this.schema()} .computeLabel=${this.label} .computeHelper=${this.helper}
      @value-changed=${(ev: CustomEvent) => this.onChange(ev)}></ha-form>`;
  }
}
customElements.define('tesla-view-card-editor', TeslaViewCardEditor);
