import { COLORS, DOMAIN_ICONS, stateColor, domainIcon, friendlyName, formatState, timeSince } from '../src/theme';

// ─────────────────────────────────────────────────────────────────────────────
// stateColor
// ─────────────────────────────────────────────────────────────────────────────

describe('stateColor', () => {
  it('returns stateOn for "on"', () => {
    expect(stateColor('on')).toBe(COLORS.stateOn);
  });

  it('returns stateOn for all "active" states', () => {
    const activeStates = ['on', 'open', 'unlocked', 'home', 'playing', 'active', 'armed_away', 'armed_home', 'cleaning'];
    for (const s of activeStates) {
      expect(stateColor(s)).toBe(COLORS.stateOn);
    }
  });

  it('returns stateOff for "off"', () => {
    expect(stateColor('off')).toBe(COLORS.stateOff);
  });

  it('returns stateOff for all "inactive" states', () => {
    const offStates = ['off', 'closed', 'locked', 'not_home', 'paused', 'idle', 'disarmed', 'docked', 'standby', 'stopped'];
    for (const s of offStates) {
      expect(stateColor(s)).toBe(COLORS.stateOff);
    }
  });

  it('returns stateUnavail for "unavailable"', () => {
    expect(stateColor('unavailable')).toBe(COLORS.stateUnavail);
  });

  it('returns stateUnknown for "unknown"', () => {
    expect(stateColor('unknown')).toBe(COLORS.stateUnknown);
  });

  it('returns textPrimary for unrecognized states', () => {
    expect(stateColor('heat')).toBe(COLORS.textPrimary);
    expect(stateColor('cool')).toBe(COLORS.textPrimary);
    expect(stateColor('some_custom_state')).toBe(COLORS.textPrimary);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// domainIcon
// ─────────────────────────────────────────────────────────────────────────────

describe('domainIcon', () => {
  it('returns correct icon for known domains', () => {
    expect(domainIcon('light.living_room')).toBe(DOMAIN_ICONS['light']);
    expect(domainIcon('switch.kitchen')).toBe(DOMAIN_ICONS['switch']);
    expect(domainIcon('sensor.temperature')).toBe(DOMAIN_ICONS['sensor']);
    expect(domainIcon('climate.thermostat')).toBe(DOMAIN_ICONS['climate']);
    expect(domainIcon('lock.front_door')).toBe(DOMAIN_ICONS['lock']);
    expect(domainIcon('media_player.tv')).toBe(DOMAIN_ICONS['media_player']);
    expect(domainIcon('automation.morning')).toBe(DOMAIN_ICONS['automation']);
  });

  it('returns fallback "○" for unknown domain', () => {
    expect(domainIcon('unknown_domain.entity')).toBe('○');
    expect(domainIcon('custom.thing')).toBe('○');
  });

  it('correctly extracts domain prefix before the dot', () => {
    expect(domainIcon('sensor.my.nested.entity')).toBe(DOMAIN_ICONS['sensor']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// friendlyName
// ─────────────────────────────────────────────────────────────────────────────

describe('friendlyName', () => {
  it('returns friendly_name attribute when present', () => {
    const entity = { entity_id: 'light.x', attributes: { friendly_name: 'Living Room Light' } };
    expect(friendlyName(entity)).toBe('Living Room Light');
  });

  it('returns entity_id when friendly_name is absent', () => {
    const entity = { entity_id: 'light.living_room', attributes: {} };
    expect(friendlyName(entity)).toBe('light.living_room');
  });

  it('returns entity_id when friendly_name is undefined', () => {
    const entity = { entity_id: 'sensor.temp', attributes: { unit_of_measurement: '°C' } };
    expect(friendlyName(entity)).toBe('sensor.temp');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// formatState
// ─────────────────────────────────────────────────────────────────────────────

describe('formatState', () => {
  it('returns plain state for basic entities', () => {
    const entity = { entity_id: 'switch.fan', state: 'on', attributes: {} };
    expect(formatState(entity)).toBe('on');
  });

  it('appends brightness % for lights that are on with brightness', () => {
    const entity = { entity_id: 'light.bedroom', state: 'on', attributes: { brightness: 128 } };
    const result = formatState(entity);
    expect(result).toMatch(/on \(50%\)/);
  });

  it('returns "on" without brightness when brightness missing for light', () => {
    const entity = { entity_id: 'light.bedroom', state: 'on', attributes: {} };
    expect(formatState(entity)).toBe('on');
  });

  it('returns "off" for a light that is off', () => {
    const entity = { entity_id: 'light.bedroom', state: 'off', attributes: { brightness: 200 } };
    expect(formatState(entity)).toBe('off');
  });

  it('formats climate state with temperatures', () => {
    const entity = {
      entity_id: 'climate.thermostat', state: 'heat',
      attributes: { current_temperature: 20, temperature: 22 },
    };
    const result = formatState(entity);
    expect(result).toContain('heat');
    expect(result).toContain('20°');
    expect(result).toContain('22°');
  });

  it('formats climate state with missing target temperature', () => {
    const entity = {
      entity_id: 'climate.thermostat', state: 'heat',
      attributes: { current_temperature: 20 },
    };
    const result = formatState(entity);
    expect(result).toContain('heat');
    expect(result).toContain('20°');
    expect(result).toContain('?°');
  });

  it('appends unit of measurement for sensors', () => {
    const entity = {
      entity_id: 'sensor.temperature', state: '21.5',
      attributes: { unit_of_measurement: '°C' },
    };
    expect(formatState(entity)).toBe('21.5 °C');
  });

  it('returns plain state for sensor without unit', () => {
    const entity = { entity_id: 'sensor.boolean_sensor', state: 'on', attributes: {} };
    expect(formatState(entity)).toBe('on');
  });

  it('formats media player title when playing', () => {
    const entity = {
      entity_id: 'media_player.tv', state: 'playing',
      attributes: { media_title: 'My Favourite Song' },
    };
    const result = formatState(entity);
    expect(result).toContain('♫');
    expect(result).toContain('My Favourite Song');
  });

  it('returns "playing" for media player without title', () => {
    const entity = { entity_id: 'media_player.tv', state: 'playing', attributes: {} };
    expect(formatState(entity)).toBe('playing');
  });

  it('truncates long media title to 20 characters', () => {
    const entity = {
      entity_id: 'media_player.tv', state: 'playing',
      attributes: { media_title: 'A Very Very Very Long Title Here' },
    };
    const result = formatState(entity);
    expect(result.length).toBeLessThan(30);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// timeSince
// ─────────────────────────────────────────────────────────────────────────────

describe('timeSince', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2025-01-01T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns seconds for very recent dates', () => {
    const date = new Date('2025-01-01T11:59:45.000Z').toISOString();
    expect(timeSince(date)).toBe('15s');
  });

  it('returns minutes for dates 1-59 minutes ago', () => {
    const date = new Date('2025-01-01T11:55:00.000Z').toISOString();
    expect(timeSince(date)).toBe('5m');
  });

  it('returns hours for dates 1-23 hours ago', () => {
    const date = new Date('2025-01-01T09:00:00.000Z').toISOString();
    expect(timeSince(date)).toBe('3h');
  });

  it('returns days for dates 24+ hours ago', () => {
    const date = new Date('2024-12-30T12:00:00.000Z').toISOString();
    expect(timeSince(date)).toBe('2d');
  });

  it('returns 0s for the current moment', () => {
    const date = new Date('2025-01-01T12:00:00.000Z').toISOString();
    expect(timeSince(date)).toBe('0s');
  });

  it('returns 0s for a timestamp slightly in the future (clock skew)', () => {
    const date = new Date('2025-01-01T12:00:05.000Z').toISOString();
    expect(timeSince(date)).toBe('0s');
  });
});
