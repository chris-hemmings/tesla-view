import { LitElement, html } from 'lit';
import { fetchJson } from './scene/assets';
import type { CardConfig, HomeAssistant } from './types';

/** Visual editor: device + look. Entity/state/action overrides stay YAML (documented in the README). */
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
      { name: 'rhd', selector: { boolean: {} } },
      { name: 'hotspots', selector: { boolean: {} } },
    ];
  }
  private label = (s: any) => ({ device_id: 'Tesla Fleet device', model: 'Model', trim: 'Trim', paint: 'Paint', wheels: 'Wheels', plate: 'Plate', theme: 'Theme',
    camera: 'Camera', aspect_ratio: 'Aspect ratio', rhd: 'Right-hand drive', hotspots: 'Show hotspots' } as any)[s.name] || s.name;

  render() {
    if (!this.hass) return html``;
    const data = { model: 'juniper', trim: 'premium', paint: 'Quicksilver', wheels: 'Crossflow19', plate: 'eu', theme: 'auto', camera: 'parked', aspect_ratio: '16:9', hotspots: true, ...this.config };
    return html`<ha-form .hass=${this.hass} .data=${data} .schema=${this.schema()} .computeLabel=${this.label}
      @value-changed=${(ev: CustomEvent) => { ev.stopPropagation(); this.config = { ...this.config, ...ev.detail.value };
        this.dispatchEvent(new CustomEvent('config-changed', { detail: { config: this.config }, bubbles: true, composed: true })); }}></ha-form>`;
  }
}
customElements.define('tesla-view-card-editor', TeslaViewCardEditor);
