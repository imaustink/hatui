export interface HassConfig {
  /** Display name shown in the context switcher. Falls back to the URL hostname when omitted. */
  name?: string;
  url: string;
  token: string;
}

/**
 * Shape of ~/.config/hom3/config.json.
 * Supports both single-home (legacy) and multi-home formats.
 */
export interface HassConfigFile {
  /** Multi-home: array of home configurations. */
  homes?: Array<{ name?: string; url: string; token: string }>;
  /** Legacy single-home: url at the top level. */
  url?: string;
  /** Legacy single-home: token at the top level. */
  token?: string;
}

export interface HassEntity {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
  last_updated: string;
  context: {
    id: string;
    parent_id: string | null;
    user_id: string | null;
  };
}

export interface HassArea {
  area_id: string;
  name: string;
  picture: string | null;
}

export interface HassDevice {
  id: string;
  name: string;
  name_by_user: string | null;
  area_id: string | null;
  manufacturer: string | null;
  model: string | null;
  model_id: string | null;
  sw_version: string | null;
  hw_version: string | null;
  entry_type: string | null;
  config_entries: string[];
  connections: [string, string][];
  identifiers: [string, string][];
  disabled_by: string | null;
  via_device_id: string | null;
}

export interface HassEntityRegistryEntry {
  entity_id: string;
  area_id: string | null;
  device_id: string | null;
  hidden_by: string | null;
}

export interface HassStateChange {
  entity_id: string;
  new_state: HassEntity | null;
  old_state: HassEntity | null;
}

export type DeviceType =
  | 'all'
  | 'lights'
  | 'switches'
  | 'sensors'
  | 'binary_sensors'
  | 'climate'
  | 'covers'
  | 'fans'
  | 'media_players'
  | 'automations'
  | 'scripts'
  | 'scenes'
  | 'persons'
  | 'cameras'
  | 'locks'
  | 'vacuums'
  | 'alarms'
  | 'weather'
  | 'buttons'
  | 'numbers'
  | 'selects'
  | 'inputs';

export const DEVICE_TYPE_DOMAINS: Record<DeviceType, string[]> = {
  all: [],
  lights: ['light'],
  switches: ['switch'],
  sensors: ['sensor'],
  binary_sensors: ['binary_sensor'],
  climate: ['climate'],
  covers: ['cover'],
  fans: ['fan'],
  media_players: ['media_player'],
  automations: ['automation'],
  scripts: ['script'],
  scenes: ['scene'],
  persons: ['person', 'device_tracker'],
  cameras: ['camera'],
  locks: ['lock'],
  vacuums: ['vacuum'],
  alarms: ['alarm_control_panel'],
  weather: ['weather'],
  buttons: ['button', 'input_button'],
  numbers: ['number', 'input_number'],
  selects: ['select', 'input_select'],
  inputs: ['input_boolean', 'input_text', 'input_datetime'],
};

export const DEVICE_TYPE_SHORTCUTS: Record<string, DeviceType> = {
  all: 'all',
  lights: 'lights',
  light: 'lights',
  switches: 'switches',
  switch: 'switches',
  sensors: 'sensors',
  sensor: 'sensors',
  binary_sensors: 'binary_sensors',
  bs: 'binary_sensors',
  climate: 'climate',
  covers: 'covers',
  cover: 'covers',
  fans: 'fans',
  fan: 'fans',
  media_players: 'media_players',
  media: 'media_players',
  mp: 'media_players',
  automations: 'automations',
  auto: 'automations',
  automation: 'automations',
  scripts: 'scripts',
  script: 'scripts',
  scenes: 'scenes',
  scene: 'scenes',
  persons: 'persons',
  person: 'persons',
  cameras: 'cameras',
  camera: 'cameras',
  locks: 'locks',
  lock: 'locks',
  vacuums: 'vacuums',
  vacuum: 'vacuums',
  alarms: 'alarms',
  alarm: 'alarms',
  weather: 'weather',
  buttons: 'buttons',
  button: 'buttons',
  numbers: 'numbers',
  number: 'numbers',
  selects: 'selects',
  select: 'selects',
  inputs: 'inputs',
  input: 'inputs',
};

export interface AppState {
  currentView: DeviceType;
  filter: string;
  filterMode: boolean;
  areaFilter: string;
  selectedIndex: number;
  entities: HassEntity[];
  filteredEntities: HassEntity[];
  connected: boolean;
  commandMode: boolean;
  commandBuffer: string;
  describeMode: boolean;
  describeEntity: HassEntity | null;
  detailVisible: boolean;
  helpMode: boolean;
  areas: HassArea[];
  devices: HassDevice[];
  sortField: keyof HassEntity | 'friendly_name';
  sortAsc: boolean;
  error: string | null;
  lastRefresh: Date | null;
  // ── autocomplete ──────────────────────────────────────────────────────
  autocompleteSuggestions: string[];
  autocompleteIndex: number;
  // ── inline input (rename / area) ──────────────────────────────────────
  inputMode: 'rename' | 'area' | null;
  inputBuffer: string;
  // ── recent areas (k9s-style selector) ─────────────────────────────────
  recentAreas: string[];
  // ── context / home switcher ───────────────────────────────────────────
  contextMode: boolean;
  homes: HassConfig[];
  activeHomeIndex: number;
  contextSelectedIndex: number;
}
