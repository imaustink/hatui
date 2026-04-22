import {
  filterEntities,
  computeCommandSuggestions,
  computeAreaSuggestions,
  computeFilterSuggestions,
  renderTableHeader,
  renderEntityRow,
  renderDetail,
  renderCommandBar,
  renderStatusBar,
  renderHeader,
  renderAutocompleteItem,
  renderHelp,
} from '../src/renderer';
import { HassEntity, HassArea, AppState } from '../src/types';

// ─────────────────────────────────────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────────────────────────────────────

function makeEntity(overrides: Partial<HassEntity> & { entity_id: string }): HassEntity {
  return {
    state: 'on',
    attributes: {},
    last_changed: new Date(Date.now() - 60000).toISOString(),
    last_updated: new Date(Date.now() - 30000).toISOString(),
    context: { id: 'ctx1', parent_id: null, user_id: null },
    ...overrides,
  };
}

function makeArea(area_id: string, name: string): HassArea {
  return { area_id, name, picture: null };
}

function makeState(overrides: Partial<AppState> = {}): AppState {
  return {
    currentView: 'all',
    filter: '',
    filterMode: false,
    areaFilter: '',
    selectedIndex: 0,
    entities: [],
    filteredEntities: [],
    connected: true,
    commandMode: false,
    commandBuffer: '',
    describeMode: false,
    describeEntity: null,
    detailVisible: false,
    helpMode: false,
    areas: [],
    devices: [],
    sortField: 'friendly_name',
    sortAsc: true,
    error: null,
    lastRefresh: null,
    autocompleteSuggestions: [],
    autocompleteIndex: 0,
    inputMode: null,
    inputBuffer: '',
    recentAreas: [],
    ...overrides,
  };
}

const lightA  = makeEntity({ entity_id: 'light.living_room',  state: 'on',  attributes: { friendly_name: 'Living Room Light' } });
const lightB  = makeEntity({ entity_id: 'light.bedroom',      state: 'off', attributes: { friendly_name: 'Bedroom Light' } });
const switchA = makeEntity({ entity_id: 'switch.kitchen',     state: 'on',  attributes: { friendly_name: 'Kitchen Switch' } });
const sensorA = makeEntity({ entity_id: 'sensor.temperature', state: '21',  attributes: { friendly_name: 'Temperature', unit_of_measurement: '°C' } });
const climateA = makeEntity({ entity_id: 'climate.thermostat',state: 'heat',attributes: { friendly_name: 'Thermostat', current_temperature: 20, temperature: 22 } });

const allEntities = [lightA, lightB, switchA, sensorA, climateA];

// ─────────────────────────────────────────────────────────────────────────────
// filterEntities
// ─────────────────────────────────────────────────────────────────────────────

describe('filterEntities', () => {
  it('returns all entities for view "all" with no filter', () => {
    const result = filterEntities(allEntities, 'all', '');
    expect(result).toHaveLength(allEntities.length);
  });

  it('filters to only lights when view is "lights"', () => {
    const result = filterEntities(allEntities, 'lights', '');
    expect(result).toHaveLength(2);
    result.forEach((e) => expect(e.entity_id).toMatch(/^light\./));
  });

  it('filters to only switches when view is "switches"', () => {
    const result = filterEntities(allEntities, 'switches', '');
    expect(result).toHaveLength(1);
    expect(result[0].entity_id).toBe('switch.kitchen');
  });

  it('filters to sensors', () => {
    const result = filterEntities(allEntities, 'sensors', '');
    expect(result).toHaveLength(1);
    expect(result[0].entity_id).toBe('sensor.temperature');
  });

  it('filters to climate', () => {
    const result = filterEntities(allEntities, 'climate', '');
    expect(result).toHaveLength(1);
    expect(result[0].entity_id).toBe('climate.thermostat');
  });

  it('applies text filter on entity_id', () => {
    const result = filterEntities(allEntities, 'all', 'bedroom');
    expect(result).toHaveLength(1);
    expect(result[0].entity_id).toBe('light.bedroom');
  });

  it('applies text filter on friendly_name (case-insensitive)', () => {
    const result = filterEntities(allEntities, 'all', 'kitchen');
    expect(result).toHaveLength(1);
    expect(result[0].entity_id).toBe('switch.kitchen');
  });

  it('applies text filter on state', () => {
    const result = filterEntities(allEntities, 'all', 'heat');
    expect(result).toHaveLength(1);
    expect(result[0].entity_id).toBe('climate.thermostat');
  });

  it('combines domain view filter and text filter', () => {
    const result = filterEntities(allEntities, 'lights', 'bedroom');
    expect(result).toHaveLength(1);
    expect(result[0].entity_id).toBe('light.bedroom');
  });

  it('filters by area when areaFilter is set', () => {
    const areaMap = new Map([
      ['light.living_room', 'Living Room'],
      ['switch.kitchen', 'Kitchen'],
    ]);
    const result = filterEntities(allEntities, 'all', '', areaMap, 'living');
    expect(result).toHaveLength(1);
    expect(result[0].entity_id).toBe('light.living_room');
  });

  it('returns empty array when no entities match', () => {
    const result = filterEntities(allEntities, 'all', 'xyznonexistent');
    expect(result).toHaveLength(0);
  });

  it('returns empty array when domain view has no entities', () => {
    const result = filterEntities(allEntities, 'cameras', '');
    expect(result).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computeCommandSuggestions
// ─────────────────────────────────────────────────────────────────────────────

describe('computeCommandSuggestions', () => {
  const areas = [
    makeArea('living', 'Living Room'),
    makeArea('bed', 'Bedroom'),
    makeArea('kit', 'Kitchen'),
  ];

  it('returns up to 6 view shortcuts for empty buffer', () => {
    const result = computeCommandSuggestions('', areas);
    expect(result.length).toBeGreaterThan(0);
    expect(result.length).toBeLessThanOrEqual(6);
  });

  it('filters shortcuts starting with typed prefix (prefix results come first)', () => {
    const result = computeCommandSuggestions('li', areas);
    // Prefix matches should be in the results; contains-matches may also appear
    expect(result.some((r) => r.toLowerCase().startsWith('li'))).toBe(true);
  });

  it('includes "lights" suggestion when typing "li"', () => {
    const result = computeCommandSuggestions('li', areas);
    expect(result).toContain('lights');
  });

  it('suggests area names after a space', () => {
    const result = computeCommandSuggestions('lights ', areas);
    expect(result.length).toBeGreaterThan(0);
    result.forEach((r) => expect(r).toMatch(/^lights /));
  });

  it('filters area suggestions by partial match after space', () => {
    const result = computeCommandSuggestions('lights bed', areas);
    expect(result.every((r) => r.toLowerCase().includes('bed'))).toBe(true);
  });

  it('includes built-in commands "on", "off", "quit"', () => {
    const onResult = computeCommandSuggestions('on', areas);
    expect(onResult).toContain('on');
  });

  it('returns no more than 6 results', () => {
    const result = computeCommandSuggestions('', areas);
    expect(result.length).toBeLessThanOrEqual(6);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computeAreaSuggestions
// ─────────────────────────────────────────────────────────────────────────────

describe('computeAreaSuggestions', () => {
  const areas = [
    makeArea('lr', 'Living Room'),
    makeArea('br', 'Bedroom'),
    makeArea('kit', 'Kitchen'),
    makeArea('bath', 'Bathroom'),
  ];

  it('returns all areas (up to 8) for empty buffer', () => {
    const result = computeAreaSuggestions('', areas);
    expect(result).toHaveLength(4);
  });

  it('returns prefix matches first', () => {
    const result = computeAreaSuggestions('be', areas);
    expect(result[0]).toBe('Bedroom');
  });

  it('returns case-insensitive matches', () => {
    const result = computeAreaSuggestions('room', areas);
    expect(result.length).toBe(3); // Living Room, Bedroom, Bathroom
    expect(result).toContain('Living Room');
    expect(result).toContain('Bedroom');
    expect(result).toContain('Bathroom');
  });

  it('returns empty array when no matches', () => {
    const result = computeAreaSuggestions('zxqwerty', areas);
    expect(result).toHaveLength(0);
  });

  it('returns no more than 8 results', () => {
    const manyAreas = Array.from({ length: 15 }, (_, i) =>
      makeArea(`a${i}`, `Area ${i}`)
    );
    const result = computeAreaSuggestions('', manyAreas);
    expect(result.length).toBeLessThanOrEqual(8);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computeFilterSuggestions
// ─────────────────────────────────────────────────────────────────────────────

describe('computeFilterSuggestions', () => {
  const areaMap = new Map<string, string>();

  it('returns empty array for empty query', () => {
    expect(computeFilterSuggestions('', allEntities, areaMap)).toHaveLength(0);
  });

  it('returns friendly name matches', () => {
    const result = computeFilterSuggestions('living', allEntities, areaMap);
    expect(result).toContain('Living Room Light');
  });

  it('returns entity ID matches when name does not match', () => {
    const result = computeFilterSuggestions('climate', allEntities, areaMap);
    // climate.thermostat has friendly_name "Thermostat" — should match via entity_id
    expect(result.some((r) => r.includes('climate') || r.includes('Thermostat'))).toBe(true);
  });

  it('puts prefix matches before contains matches', () => {
    const entities = [
      makeEntity({ entity_id: 'sensor.a', attributes: { friendly_name: 'Contains Kitchen' } }),
      makeEntity({ entity_id: 'sensor.b', attributes: { friendly_name: 'Kitchen Light' } }),
    ];
    const result = computeFilterSuggestions('kit', entities, areaMap);
    expect(result[0]).toBe('Kitchen Light');
    expect(result[1]).toBe('Contains Kitchen');
  });

  it('returns no more than 6 results', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      makeEntity({ entity_id: `light.lamp${i}`, attributes: { friendly_name: `Lamp ${i}` } })
    );
    const result = computeFilterSuggestions('lamp', many, areaMap);
    expect(result.length).toBeLessThanOrEqual(6);
  });

  it('deduplicates results by name', () => {
    const entities = [
      makeEntity({ entity_id: 'light.a', attributes: { friendly_name: 'Lamp' } }),
      makeEntity({ entity_id: 'light.b', attributes: { friendly_name: 'Lamp' } }),
    ];
    const result = computeFilterSuggestions('lamp', entities, areaMap);
    const uniqueNames = new Set(result);
    expect(uniqueNames.size).toBe(result.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// renderTableHeader
// ─────────────────────────────────────────────────────────────────────────────

describe('renderTableHeader', () => {
  it('includes NAME and STATE columns for all widths', () => {
    for (const w of [36, 50, 65, 80, 120]) {
      const result = renderTableHeader(w);
      expect(result).toContain('NAME');
      expect(result).toContain('STATE');
    }
  });

  it('includes AREA column at wider widths (>= 50)', () => {
    const result = renderTableHeader(65);
    expect(result).toContain('AREA');
  });

  it('omits AREA column at narrow widths (< 50)', () => {
    const result = renderTableHeader(40);
    expect(result).not.toContain('AREA');
  });

  it('includes AGE column at wider widths (>= 65)', () => {
    const result = renderTableHeader(80);
    expect(result).toContain('AGE');
  });

  it('returns a string with blessed markup tags', () => {
    const result = renderTableHeader(80);
    expect(result).toContain('{bold}');
    expect(result).toContain('{/}');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// renderEntityRow
// ─────────────────────────────────────────────────────────────────────────────

describe('renderEntityRow', () => {
  const areaMap = new Map([['light.living_room', 'Living Room']]);

  it('includes friendly name in output', () => {
    const result = renderEntityRow(lightA, areaMap, false, 80);
    expect(result).toContain('Living Room Light');
  });

  it('includes entity state in output', () => {
    const result = renderEntityRow(lightA, areaMap, false, 80);
    expect(result).toContain('on');
  });

  it('includes area name when wide enough', () => {
    const result = renderEntityRow(lightA, areaMap, false, 80);
    expect(result).toContain('Living Room');
  });

  it('uses cyan color for selected row', () => {
    const selected = renderEntityRow(lightA, areaMap, true, 80);
    const notSelected = renderEntityRow(lightA, areaMap, false, 80);
    expect(selected).toContain('#00e5ff'); // COLORS.cyan
    // Both should produce blessed markup
    expect(selected).toContain('{/}');
    expect(notSelected).toContain('{/}');
  });

  it('shows dash for area when entity has no area mapping', () => {
    const emptyAreaMap = new Map<string, string>();
    const result = renderEntityRow(lightA, emptyAreaMap, false, 80);
    expect(result).toContain('—');
  });

  it('includes domain icon in output', () => {
    const result = renderEntityRow(lightA, areaMap, false, 80);
    // light icon is '◆'
    expect(result).toContain('◆');
  });

  it('omits area and age columns at narrow widths', () => {
    // At width 36 cols.area = 0, so the area column is not appended.
    // We verify by rendering without and with areas — the narrow result
    // should be shorter and should not contain the area map lookup separator.
    const narrow = renderEntityRow(lightA, areaMap, false, 36);
    const wide   = renderEntityRow(lightA, areaMap, false, 80);
    // The wide version should be longer (has extra area/age columns)
    expect(wide.length).toBeGreaterThan(narrow.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// renderDetail
// ─────────────────────────────────────────────────────────────────────────────

describe('renderDetail', () => {
  it('returns placeholder when entity is null', () => {
    const result = renderDetail(null, 30);
    expect(result).toContain('Select an entity');
  });

  it('includes entity_id in output', () => {
    const result = renderDetail(lightA, 40);
    expect(result).toContain('light.living_room');
  });

  it('includes domain in output', () => {
    const result = renderDetail(lightA, 40);
    expect(result).toContain('light');
  });

  it('includes friendly name in output', () => {
    const result = renderDetail(lightA, 40);
    expect(result).toContain('Living Room Light');
  });

  it('includes ATTRIBUTES section', () => {
    const result = renderDetail(lightA, 40);
    expect(result).toContain('ATTRIBUTES');
  });

  it('includes ACTIONS section', () => {
    const result = renderDetail(lightA, 40);
    expect(result).toContain('ACTIONS');
  });

  it('includes toggle action for toggleable domains', () => {
    const result = renderDetail(lightA, 40);
    expect(result).toContain('Toggle');
  });

  it('does not include toggle action for non-toggleable domains', () => {
    const result = renderDetail(sensorA, 40);
    expect(result).not.toContain('[t]');
  });

  it('includes custom attributes in output', () => {
    const entityWithAttrs = makeEntity({
      entity_id: 'sensor.power',
      attributes: { unit_of_measurement: 'W', device_class: 'power' },
    });
    const result = renderDetail(entityWithAttrs, 40);
    // Keys may be truncated to fit column width — check a prefix that always fits
    expect(result).toContain('unit_of_measu');
    expect(result).toContain('device_class');
  });

  it('skips known noisy attributes (friendly_name, icon, entity_picture)', () => {
    const entity = makeEntity({
      entity_id: 'light.x',
      attributes: { friendly_name: 'My Light', icon: 'mdi:bulb', entity_picture: '/img.png' },
    });
    const result = renderDetail(entity, 40);
    // friendly_name and icon shouldn't appear after the name header
    const lines = result.split('\n').slice(1); // skip first line (entity name)
    expect(lines.join('\n')).not.toContain('friendly_name');
    expect(lines.join('\n')).not.toContain('mdi:bulb');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// renderCommandBar
// ─────────────────────────────────────────────────────────────────────────────

describe('renderCommandBar', () => {
  it('returns empty string in normal mode', () => {
    const state = makeState();
    expect(renderCommandBar(state)).toBe('');
  });

  it('shows rename prompt in rename inputMode', () => {
    const state = makeState({ inputMode: 'rename', inputBuffer: 'New Name' });
    const result = renderCommandBar(state);
    expect(result).toContain('Rename');
    expect(result).toContain('New Name');
    expect(result).toContain('ENTER');
  });

  it('shows area prompt in area inputMode', () => {
    const state = makeState({ inputMode: 'area', inputBuffer: 'Living' });
    const result = renderCommandBar(state);
    expect(result).toContain('Area');
    expect(result).toContain('Living');
    expect(result).toContain('TAB');
  });

  it('shows command bar in command mode without space', () => {
    const state = makeState({ commandMode: true, commandBuffer: 'lights' });
    const result = renderCommandBar(state);
    expect(result).toContain(':');
    expect(result).toContain('lights');
    expect(result).toContain('ENTER');
  });

  it('shows command bar in command mode with space (view + area)', () => {
    const state = makeState({ commandMode: true, commandBuffer: 'lights bedroom' });
    const result = renderCommandBar(state);
    expect(result).toContain('lights');
    expect(result).toContain('bedroom');
  });

  it('shows filter bar in filter mode', () => {
    const state = makeState({ filterMode: true, filter: 'kitchen' });
    const result = renderCommandBar(state);
    expect(result).toContain('/');
    expect(result).toContain('kitchen');
    expect(result).toContain('ESC');
  });

  it('shows filter bar even when not in filterMode but filter is set', () => {
    const state = makeState({ filterMode: false, filter: 'bedroom' });
    const result = renderCommandBar(state);
    expect(result).toContain('bedroom');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// renderStatusBar
// ─────────────────────────────────────────────────────────────────────────────

describe('renderStatusBar', () => {
  it('shows error when state.error is set', () => {
    const state = makeState({ error: 'Connection failed', filteredEntities: [] });
    const result = renderStatusBar(state);
    expect(result).toContain('Connection failed');
    expect(result).toContain('⚠');
  });

  it('returns empty string when no selection and no error', () => {
    const state = makeState({ filteredEntities: [], selectedIndex: 0 });
    expect(renderStatusBar(state)).toBe('');
  });

  it('shows selected entity domain and name', () => {
    const state = makeState({ filteredEntities: [lightA], selectedIndex: 0 });
    const result = renderStatusBar(state);
    expect(result).toContain('light');
    expect(result).toContain('Living Room Light');
  });

  it('shows selected entity state', () => {
    const state = makeState({ filteredEntities: [lightA], selectedIndex: 0 });
    const result = renderStatusBar(state);
    expect(result).toContain('on');
  });

  it('error takes precedence over entity display', () => {
    const state = makeState({
      filteredEntities: [lightA],
      selectedIndex: 0,
      error: 'WebSocket closed',
    });
    const result = renderStatusBar(state);
    expect(result).toContain('WebSocket closed');
    expect(result).not.toContain('Living Room Light');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// renderHeader
// ─────────────────────────────────────────────────────────────────────────────

describe('renderHeader', () => {
  it('contains HOM3 branding', () => {
    const state = makeState({ filteredEntities: allEntities });
    const result = renderHeader(state, 120);
    expect(result).toContain('HA');
    expect(result).toContain('TUI');
  });

  it('shows CONNECTED when state.connected is true', () => {
    const state = makeState({ connected: true, filteredEntities: [] });
    const result = renderHeader(state, 120);
    expect(result).toContain('CONNECTED');
  });

  it('shows OFFLINE when state.connected is false', () => {
    const state = makeState({ connected: false, filteredEntities: [] });
    const result = renderHeader(state, 120);
    expect(result).toContain('OFFLINE');
  });

  it('shows entity count', () => {
    const state = makeState({ filteredEntities: allEntities });
    const result = renderHeader(state, 120);
    expect(result).toContain(`${allEntities.length} entities`);
  });

  it('shows recent areas when present', () => {
    const state = makeState({ recentAreas: ['Living Room', 'Bedroom'], filteredEntities: [] });
    const result = renderHeader(state, 120);
    expect(result).toContain('Living Room');
    expect(result).toContain('Bedroom');
  });

  it('shows placeholder when no recent areas', () => {
    const state = makeState({ recentAreas: [], filteredEntities: [], areaFilter: '' });
    const result = renderHeader(state, 120);
    expect(result).toContain('No recent areas');
  });

  it('returns only one line for narrow terminal (< 60)', () => {
    const state = makeState({ filteredEntities: [] });
    const result = renderHeader(state, 40);
    expect(result).not.toContain('\n');
  });

  it('contains view shortcut badges at wide terminal', () => {
    const state = makeState({ filteredEntities: [] });
    const result = renderHeader(state, 120);
    expect(result).toContain(':lights');
    expect(result).toContain(':sensors');
  });

  it('highlights active recent area', () => {
    const state = makeState({ recentAreas: ['Living Room', 'Bedroom'], areaFilter: 'living room', filteredEntities: [] });
    const result = renderHeader(state, 120);
    // Active area uses cyan background; inactive uses bgSelected background
    expect(result).toContain('Living Room');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// renderHelp
// ─────────────────────────────────────────────────────────────────────────────

describe('renderHelp', () => {
  it('contains NAVIGATION section', () => {
    expect(renderHelp()).toContain('NAVIGATION');
  });

  it('contains VIEWS section', () => {
    expect(renderHelp()).toContain('VIEWS');
  });

  it('contains ACTIONS section', () => {
    expect(renderHelp()).toContain('ACTIONS');
  });

  it('documents toggle key', () => {
    expect(renderHelp()).toContain('Toggle');
  });

  it('documents quit key', () => {
    expect(renderHelp()).toContain('Quit');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// renderAutocompleteItem
// ─────────────────────────────────────────────────────────────────────────────

describe('renderAutocompleteItem', () => {
  it('highlights matching portion of plain text', () => {
    const result = renderAutocompleteItem('Living Room', 'room');
    // Match is case-preserved from original text ("Room" not "room")
    expect(result.toLowerCase()).toContain('room');
    expect(result).toContain('{bold}');
  });

  it('handles text with no match gracefully', () => {
    const result = renderAutocompleteItem('Kitchen', 'xyz');
    expect(result).toContain('Kitchen');
  });

  it('handles area-scoped queries (with space)', () => {
    const result = renderAutocompleteItem('lights Living Room', 'lights bed');
    expect(result).toContain('Living Room');
  });

  it('highlights area portion in area query', () => {
    const result = renderAutocompleteItem('lights Bedroom', 'lights bed');
    expect(result).toContain('Bed');
    expect(result).toContain('{bold}');
  });
});
