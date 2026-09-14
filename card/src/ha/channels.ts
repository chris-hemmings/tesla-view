import type { ActionConfig, CardConfig, ChannelId, ChargingState, HassEntity, HomeAssistant } from '../types';

/**
 * Channels turn Home Assistant entities into vehicle state. Every channel can be mapped to any entity of any
 * integration (`entities:`), with optional custom on/enum states (`states:`) and service overrides (`actions:`).
 * Defaults follow the core Tesla Fleet integration.
 */
export const CHANNELS: ChannelId[] = [
  'frunk', 'trunk', 'charge_port', 'lock', 'door_fl', 'door_fr', 'door_rl', 'door_rr',
  'window_fl', 'window_fr', 'window_rl', 'window_rr', 'charge_cable', 'charging', 'headlights', 'drl', 'flash_lights',
];

/** Tesla Fleet entity-registry translation_key (+ domain) → channel. Driver side = left for LHD cars. */
const DISCOVERY: { key: string; domain: string; channel: ChannelId; rhdChannel?: ChannelId }[] = [
  { key: 'vehicle_state_ft', domain: 'cover', channel: 'frunk' },
  { key: 'vehicle_state_rt', domain: 'cover', channel: 'trunk' },
  { key: 'charge_state_charge_port_door_open', domain: 'cover', channel: 'charge_port' },
  { key: 'vehicle_state_locked', domain: 'lock', channel: 'lock' },
  { key: 'vehicle_state_df', domain: 'binary_sensor', channel: 'door_fl', rhdChannel: 'door_fr' },
  { key: 'vehicle_state_pf', domain: 'binary_sensor', channel: 'door_fr', rhdChannel: 'door_fl' },
  { key: 'vehicle_state_dr', domain: 'binary_sensor', channel: 'door_rl', rhdChannel: 'door_rr' },
  { key: 'vehicle_state_pr', domain: 'binary_sensor', channel: 'door_rr', rhdChannel: 'door_rl' },
  { key: 'vehicle_state_fd_window', domain: 'binary_sensor', channel: 'window_fl', rhdChannel: 'window_fr' },
  { key: 'vehicle_state_fp_window', domain: 'binary_sensor', channel: 'window_fr', rhdChannel: 'window_fl' },
  { key: 'vehicle_state_rd_window', domain: 'binary_sensor', channel: 'window_rl', rhdChannel: 'window_rr' },
  { key: 'vehicle_state_rp_window', domain: 'binary_sensor', channel: 'window_rr', rhdChannel: 'window_rl' },
  { key: 'charge_state_conn_charge_cable', domain: 'binary_sensor', channel: 'charge_cable' },
  { key: 'charge_state_charging_state', domain: 'sensor', channel: 'charging' },
  { key: 'flash_lights', domain: 'button', channel: 'flash_lights' },
];

interface RegistryEntry { entity_id: string; device_id?: string | null; translation_key?: string | null; platform?: string; disabled_by?: string | null }

/** Resolve the entity for every channel: explicit `entities:` first, then the device's entity registry. */
export async function resolveEntities(hass: HomeAssistant, config: CardConfig): Promise<Partial<Record<ChannelId, string>>> {
  const map: Partial<Record<ChannelId, string>> = {};
  if (config.device_id) {
    try {
      const reg = await hass.callWS<RegistryEntry[]>({ type: 'config/entity_registry/list' });
      for (const e of reg) {
        if (e.device_id !== config.device_id || e.disabled_by) continue;
        const domain = e.entity_id.split('.')[0];
        const d = DISCOVERY.find(x => x.key === e.translation_key && x.domain === domain);
        if (d) map[(config as any).rhd && d.rhdChannel ? d.rhdChannel : d.channel] = e.entity_id;
      }
    } catch (err) { console.warn('tesla-view-card: entity registry lookup failed', err); }
  }
  for (const [ch, id] of Object.entries(config.entities || {})) if (id) map[ch as ChannelId] = id;
  return map;
}

const has = (list: string[] | undefined, s: string) => !!list?.map(x => String(x).toLowerCase()).includes(s.toLowerCase());

/** boolean reading of an entity, by domain (cover: open/opening; lock: locked; else: on) or via `states.<channel>.on` */
export function readBool(entity: HassEntity | undefined, channel: ChannelId, config: CardConfig): boolean | undefined {
  if (!entity || entity.state === 'unavailable' || entity.state === 'unknown') return undefined;
  const custom = config.states?.[channel];
  if (custom?.on) return has(custom.on, entity.state);
  const domain = entity.entity_id.split('.')[0], s = entity.state.toLowerCase();
  if (domain === 'cover') return s === 'open' || s === 'opening';
  if (domain === 'lock') return s === 'locked' || s === 'locking';
  return s === 'on' || s === 'true' || s === '1' || s === 'open' || s === 'unlocked' && false;
}

export function readCharging(entity: HassEntity | undefined, config: CardConfig): ChargingState {
  if (!entity) return 'unknown';
  const s = entity.state.toLowerCase();
  const custom = config.states?.charging;
  const table: Record<string, string[]> = {
    charging: custom?.charging || ['charging', 'starting'],
    complete: custom?.complete || ['complete'],
    stopped: custom?.stopped || ['stopped', 'no_power', 'nopower'],
    disconnected: custom?.disconnected || ['disconnected', 'unavailable', 'unknown', 'off'],
  };
  for (const [k, v] of Object.entries(table)) if (has(v, s)) return k as ChargingState;
  if (entity.entity_id.startsWith('binary_sensor.') || entity.entity_id.startsWith('switch.')) return s === 'on' ? 'charging' : 'stopped';
  return 'unknown';
}

/** Default services for hotspot actions; `actions:` in the config overrides any of them (keys below). */
export function actionFor(key: string, config: CardConfig, entities: Partial<Record<ChannelId, string>>): ActionConfig | undefined {
  if (config.actions?.[key]) return config.actions[key];
  const tgt = (ch: ChannelId) => entities[ch] ? { entity_id: entities[ch] } : undefined;
  const defaults: Record<string, () => ActionConfig | undefined> = {
    frunk_open:        () => tgt('frunk') && { action: 'cover.open_cover', target: tgt('frunk') },
    trunk_open:        () => tgt('trunk') && { action: 'cover.open_cover', target: tgt('trunk') },
    trunk_close:       () => tgt('trunk') && { action: 'cover.close_cover', target: tgt('trunk') },
    charge_port_open:  () => tgt('charge_port') && { action: 'cover.open_cover', target: tgt('charge_port') },
    charge_port_close: () => tgt('charge_port') && { action: 'cover.close_cover', target: tgt('charge_port') },
    lock:              () => tgt('lock') && { action: 'lock.lock', target: tgt('lock') },
    unlock:            () => tgt('lock') && { action: 'lock.unlock', target: tgt('lock') },
    flash_lights:      () => tgt('flash_lights') && { action: 'button.press', target: tgt('flash_lights') },
  };
  return defaults[key]?.();
}

export async function runAction(hass: HomeAssistant, a: ActionConfig) {
  const [domain, service] = a.action.split('.');
  return hass.callService(domain, service, a.data || {}, a.target);
}
