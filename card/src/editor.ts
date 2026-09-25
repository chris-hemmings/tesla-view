import { LitElement, html } from 'lit';
import { ASSETS_ROOT, INDEX_REV } from './scene/assets';
import { PackLoader, type PackIndex, type PackManifest } from './pack';
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
  device_id: 'Tesla Fleet device', model: 'Model', trim: 'Trim', paint: 'Paint', wheels: 'Wheels', plate: 'Plate', seats: 'Seats', cable: 'Charge cable',
  theme: 'Theme', background_dark: 'Dark background', background_light: 'Light background', camera: 'Camera', aspect_ratio: 'Aspect ratio', rhd: 'Right-hand drive', hotspots: 'Show hotspots',
  frunk: 'Frunk', trunk: 'Trunk', charge_port: 'Charge port door', lock: 'Lock',
  door_fl: 'Front left door', door_fr: 'Front right door', door_rl: 'Rear left door', door_rr: 'Rear right door',
  window_fl: 'Front left window', window_fr: 'Front right window', window_rl: 'Rear left window', window_rr: 'Rear right window',
  charge_cable: 'Charge cable connected', charging: 'Charging state', headlights: 'Headlights', drl: 'Daytime running lights',
  flash_lights: 'Flash lights',
};

const HELPERS: Record<string, string> = {
  device_id: 'Optional. Maps every channel from the Tesla Fleet entity registry; entities below add to or override that mapping.',
  model: 'Vehicles from your installed asset packs.',
  frunk: 'cover (open/closed) or on/off entity; the hotspot calls cover.open_cover',
  trunk: 'cover or on/off entity; hotspot calls cover.open_cover / close_cover',
  charge_port: 'cover or on/off entity; hotspot calls cover.open_cover / close_cover',
  lock: 'lock (locked/unlocked) or on/off entity; hotspot calls lock.lock / unlock',
  charging: 'Tesla Fleet charging state sensor (charging, complete, stopped, …) or any on/off entity',
  charge_cable: 'on = cable plugged in',
  flash_lights: 'button/script pressed by the lights hotspot',
  headlights: 'no Tesla Fleet equivalent – e.g. a BLE binary sensor',
  drl: 'no Tesla Fleet equivalent',
  background_dark: 'Any CSS colour, e.g. #000000; empty = pack default',
  background_light: 'Any CSS colour, e.g. #ffffff; empty = pack default',
};

/** Visual editor: device + look (from the asset pack) + one entity picker per channel. `states:` / `actions:` stay YAML. */
export class TeslaViewCardEditor extends LitElement {
  hass?: HomeAssistant;
  private config: CardConfig = { type: 'custom:tesla-view-card' };
  private index: PackIndex | null | undefined = undefined;   // undefined = loading
  private manifest?: PackManifest;
  private manifestFor = '';
  private packs = new PackLoader(ASSETS_ROOT);

  static properties = { hass: {}, config: { state: true }, index: { state: true }, manifest: { state: true } } as any;

  setConfig(config: CardConfig) { this.config = { ...config }; this.loadManifest(); }
  connectedCallback() {
    super.connectedCallback();
    this.packs.index(INDEX_REV).then(idx => { this.index = idx; this.loadManifest(); }).catch(() => { this.index = null; });
  }
  private modelPick() { return PackLoader.resolveModel(this.index || null, this.config.model); }
  private async loadManifest() {
    const pick = this.modelPick(); if (!pick || !this.index) return;
    if (this.manifestFor === pick.entry.pack) return;
    this.manifestFor = pick.entry.pack;
    try { this.manifest = await this.packs.manifest(this.index, pick.entry.pack); } catch { this.manifest = undefined; }
    this.requestUpdate();
  }

  private schema() {
    const sel = (opts: { value: string; label: string }[]) => ({ select: { mode: 'dropdown', options: opts } });
    const plain = (opts: string[]) => sel(opts.map(o => ({ value: o, label: o })));
    const entity = (ch: ChannelId) => ({ name: ch, selector: { entity: { domain: CHANNEL_DOMAINS[ch] } } });
    const group = (chs: ChannelId[]) => chs.map(entity);
    const idx = this.index, pick = this.modelPick(), m = this.manifest;
    const look: any[] = [];
    if (idx && pick) {
      const entry = pick.entry;
      look.push({ name: 'model', selector: sel(Object.entries(idx.models).map(([id, mm]) => ({ value: id, label: mm.name }))) });
      if (entry.variants.includes('performance')) look.push({ name: 'trim', selector: plain(['premium', 'performance']) });
      if (m) look.push({ name: 'paint', selector: sel([{ value: '', label: 'Pack default' }, ...Object.keys(m.paints?.colors || {}).map(o => ({ value: o, label: o }))]) });
      if (entry.wheels.length) look.push({ name: 'wheels', selector: plain(entry.wheels) });
      if (entry.variants.includes('plate_eu') && entry.variants.includes('plate_us')) look.push({ name: 'plate', selector: plain(['eu', 'us']) });
      if (entry.variants.includes('seats_7')) look.push({ name: 'seats', selector: sel([{ value: '5', label: '5' }, { value: '7', label: '7' }]) });
      if (m && Object.keys(m.cables || {}).length > 1) look.push({ name: 'cable', selector: plain(['auto', ...Object.keys(m.cables)]) });
      look.push({ name: 'theme', selector: plain(['auto', 'dark', 'light']) });
      if (this.config.theme !== 'light') look.push({ name: 'background_dark', selector: { text: {} } });
      if (this.config.theme !== 'dark') look.push({ name: 'background_light', selector: { text: {} } });
      look.push({ name: 'camera', selector: plain([...Object.keys(m?.environment?.presets || { parked: 1, top_down: 1 }), 'free']) });
      look.push({ name: 'aspect_ratio', selector: { text: {} } });
    }
    const flags: any[] = [{ name: 'hotspots', selector: { boolean: {} } }];
    if (pick?.entry.variants.includes('rhd')) flags.unshift({ name: 'rhd', selector: { boolean: {} } });
    return [
      { name: 'device_id', selector: { device: { filter: { integration: 'tesla_fleet' } } } },
      ...(look.length ? [{ type: 'grid', name: '', schema: look }] : []),
      { type: 'grid', name: '', schema: flags },
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
    if (!value.paint) delete value.paint;
    if (!value.background_dark?.trim()) delete value.background_dark;
    if (!value.background_light?.trim()) delete value.background_light;
    if ((value as any).seats !== undefined) (value as any).seats = Number((value as any).seats) === 7 ? 7 : 5;
    this.config = value;
    this.loadManifest();
    this.dispatchEvent(new CustomEvent('config-changed', { detail: { config: this.config }, bubbles: true, composed: true }));
  }

  render() {
    if (!this.hass) return html``;
    const pick = this.modelPick();
    const noPack = this.index !== undefined && !pick;
    const defaults: any = { trim: 'premium', plate: 'eu', seats: '5', cable: 'auto', theme: 'auto', camera: 'parked', aspect_ratio: '16:9', hotspots: true };
    if (pick) { defaults.model = pick.id; defaults.wheels = pick.entry.default_wheel; }
    const data = { ...defaults, ...this.config, seats: String((this.config as any).seats ?? 5), entities: { ...(this.config.entities || {}) } };
    return html`
      ${noPack ? html`<ha-alert alert-type="warning" title="No asset pack installed">
        Build one from your copy of the Tesla app with
        <a href="https://github.com/koenhendriks/tesla-view-extractor" target="_blank" rel="noopener">tesla-view-extractor</a> and upload it under
        <a href="/config/integrations/integration/tesla_view">Settings → Devices &amp; services → Tesla View → Configure</a>.</ha-alert>` : ''}
      <ha-form .hass=${this.hass} .data=${data} .schema=${this.schema()} .computeLabel=${this.label} .computeHelper=${this.helper}
        @value-changed=${(ev: CustomEvent) => this.onChange(ev)}></ha-form>`;
  }
}
customElements.define('tesla-view-card-editor', TeslaViewCardEditor);
