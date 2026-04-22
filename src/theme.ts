// HOM3 Color Palette - Cyberpunk/Synthwave inspired
export const COLORS = {
  // Primary palette
  bg:           '#0d0d1a',
  bgAlt:        '#12122b',
  bgPanel:      '#0a0a1f',
  bgHighlight:  '#1a1a3e',
  bgSelected:   '#1e1e4a',
  bgHeader:     '#0f0f2d',

  // Accents
  cyan:         '#00e5ff',
  cyanDim:      '#007a8c',
  magenta:      '#ff00ff',
  magentaDim:   '#880088',
  green:        '#00ff88',
  greenDim:     '#006634',
  yellow:       '#ffdd00',
  yellowDim:    '#887700',
  orange:       '#ff6600',
  red:          '#ff2255',
  redDim:       '#880022',
  blue:         '#4488ff',
  blueDim:      '#224488',
  purple:       '#aa44ff',
  purpleDim:    '#551188',
  teal:         '#00ffcc',
  tealDim:      '#008866',

  // Text
  textPrimary:  '#e0e0ff',
  textSecondary:'#8888bb',
  textDim:      '#44446a',
  textHeader:   '#ffffff',

  // Borders
  border:       '#2a2a5a',
  borderActive: '#00e5ff',
  borderFocus:  '#ff00ff',

  // States
  stateOn:      '#00ff88',
  stateOff:     '#44446a',
  stateUnknown: '#ffdd00',
  stateUnavail: '#ff2255',
} as const;

// Domain → icon mapping (unicode block chars + special chars)
export const DOMAIN_ICONS: Record<string, string> = {
  light:              '◆',
  switch:             '⏻',
  sensor:             '◉',
  binary_sensor:      '◎',
  climate:            '⊕',
  cover:              '▫',

  fan:                '✦',
  media_player:       '♫',
  automation:         '⚙',
  script:             '▶',
  scene:              '✦',
  person:             '◈',
  device_tracker:     '◈',
  camera:             '⊡',
  lock:               '⊠',
  vacuum:             '◌',
  alarm_control_panel:'⊗',
  weather:            '☁',
  button:             '▣',
  input_button:       '▣',
  number:             '#',
  input_number:       '#',
  select:             '≡',
  input_select:       '≡',
  input_boolean:      '⏻',
  input_text:         'T',
  input_datetime:     '⊙',
  sun:                '☀',
  zone:               '⬡',
  update:             '↑',
  calendar:           '▦',
  timer:              '⊘',
  counter:            '+',
  group:              '⊞',
};

// State → color mapping
export function stateColor(state: string): string {
  switch (state) {
    case 'on':
    case 'open':
    case 'unlocked':
    case 'home':
    case 'playing':
    case 'active':
    case 'armed_away':
    case 'armed_home':
    case 'cleaning':
      return COLORS.stateOn;

    case 'off':
    case 'closed':
    case 'locked':
    case 'not_home':
    case 'paused':
    case 'idle':
    case 'disarmed':
    case 'docked':
    case 'standby':
    case 'stopped':
      return COLORS.stateOff;

    case 'unavailable':
      return COLORS.stateUnavail;

    case 'unknown':
      return COLORS.stateUnknown;

    default:
      return COLORS.textPrimary;
  }
}

export function domainIcon(entityId: string): string {
  const domain = entityId.split('.')[0];
  return DOMAIN_ICONS[domain] ?? '○';
}

export function friendlyName(entity: { entity_id: string; attributes: Record<string, unknown> }): string {
  return (entity.attributes['friendly_name'] as string) ?? entity.entity_id;
}

// Format state for display
export function formatState(entity: { state: string; attributes: Record<string, unknown>; entity_id: string }): string {
  const domain = entity.entity_id.split('.')[0];
  const state = entity.state;

  if (domain === 'light' && state === 'on') {
    const brightness = entity.attributes['brightness'] as number | undefined;
    if (brightness !== undefined) {
      return `on (${Math.round((brightness / 255) * 100)}%)`;
    }
  }

  if (domain === 'climate') {
    const temp = entity.attributes['current_temperature'] as number | undefined;
    const target = entity.attributes['temperature'] as number | undefined;
    if (temp !== undefined) {
      return `${state} ${temp}°→${target ?? '?'}°`;
    }
  }

  if (domain === 'sensor' || domain === 'number') {
    const unit = entity.attributes['unit_of_measurement'] as string | undefined;
    return unit ? `${state} ${unit}` : state;
  }

  if (domain === 'media_player' && state === 'playing') {
    const title = entity.attributes['media_title'] as string | undefined;
    return title ? `♫ ${title.substring(0, 20)}` : 'playing';
  }

  return state;
}

// Duration since last change
export function timeSince(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const s = Math.max(0, Math.floor(diff / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}
