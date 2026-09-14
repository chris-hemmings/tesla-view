export interface HassEntity {
  entity_id: string;
  state: string;
  attributes: Record<string, any>;
  last_changed?: string;
  last_updated?: string;
}

/** The subset of the Home Assistant frontend `hass` object the card uses. */
export interface HomeAssistant {
  states: Record<string, HassEntity>;
  themes?: { darkMode?: boolean };
  language?: string;
  callService(domain: string, service: string, data?: Record<string, any>, target?: Record<string, any>): Promise<any>;
  callWS<T = any>(msg: Record<string, any>): Promise<T>;
}

export type ChannelId =
  | 'frunk' | 'trunk' | 'charge_port' | 'lock'
  | 'door_fl' | 'door_fr' | 'door_rl' | 'door_rr'
  | 'window_fl' | 'window_fr' | 'window_rl' | 'window_rr'
  | 'charge_cable' | 'charging' | 'headlights' | 'drl' | 'flash_lights';

export type ChargingState = 'charging' | 'complete' | 'stopped' | 'disconnected' | 'unknown';

export interface ActionConfig {
  action: string;                 // "domain.service"
  target?: Record<string, any>;
  data?: Record<string, any>;
}

export interface CardConfig {
  type: string;
  device_id?: string;
  model?: 'juniper' | 'standard';
  trim?: 'premium' | 'performance';
  paint?: string;
  wheels?: string;
  plate?: 'eu' | 'us';
  theme?: 'auto' | 'dark' | 'light';
  camera?: 'parked' | 'top_down' | 'free';
  aspect_ratio?: string;          // e.g. "16:9"
  height?: number;                // px, overrides aspect_ratio
  hotspots?: boolean;
  entities?: Partial<Record<ChannelId, string>>;
  states?: Partial<Record<ChannelId, Record<string, string[]>>>;
  actions?: Record<string, ActionConfig>;
}

export interface VehicleState {
  frunk: boolean; trunk: boolean; charge_port: boolean; lock: boolean | undefined;
  door_fl: boolean; door_fr: boolean; door_rl: boolean; door_rr: boolean;
  window_fl: boolean; window_fr: boolean; window_rl: boolean; window_rr: boolean;
  charge_cable: boolean; charging: ChargingState; headlights: boolean; drl: boolean;
}
