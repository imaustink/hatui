import EventEmitter from 'events';
import { App } from '../src/app';
import * as widgetsModule from '../src/widgets';
import { HassClient } from '../src/hass-client';
import { HassEntity, HassConfig } from '../src/types';

// Blessed requires a real TTY – mock it entirely since app.ts only uses it for
// type annotations; all widget construction goes through widgets.ts.
jest.mock('blessed', () => ({}));

// Auto-mock the widget factories so we can inject EventEmitter-backed fakes.
jest.mock('../src/widgets');

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeWidget(): any {
  const w: any = new EventEmitter();
  w.setContent = jest.fn();
  w.setItems = jest.fn();
  w.select = jest.fn();
  w.setLabel = jest.fn();
  w.show = jest.fn();
  w.hide = jest.fn();
  w.setFront = jest.fn();
  w.width = 120;
  w.style = { border: {} };
  return w;
}

function makeEntity(entity_id: string): HassEntity {
  return {
    entity_id,
    state: 'on',
    attributes: { friendly_name: entity_id },
    last_changed: new Date().toISOString(),
    last_updated: new Date().toISOString(),
    context: { id: 'ctx', parent_id: null, user_id: null },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared test-app factory
// ─────────────────────────────────────────────────────────────────────────────

function makeApp(): { app: App; mockScreen: any; mockTable: any; mockClient: any } {
  const mockTable = makeWidget();

  const mockScreen = makeWidget();
  mockScreen.render = jest.fn();
  mockScreen.key = jest.fn();
  mockScreen.width = 120;
  mockScreen.height = 40;

  (widgetsModule.createScreen as jest.Mock).mockReturnValue(mockScreen);
  (widgetsModule.createTable as jest.Mock).mockReturnValue(mockTable);
  (widgetsModule.createHeader as jest.Mock).mockReturnValue(makeWidget());
  (widgetsModule.createDetailPanel as jest.Mock).mockReturnValue(makeWidget());
  (widgetsModule.createCommandBar as jest.Mock).mockReturnValue(makeWidget());
  (widgetsModule.createStatusBar as jest.Mock).mockReturnValue(makeWidget());
  (widgetsModule.createHelpOverlay as jest.Mock).mockReturnValue(makeWidget());
  (widgetsModule.createToast as jest.Mock).mockReturnValue(makeWidget());
  (widgetsModule.createAutocompleteBox as jest.Mock).mockReturnValue(makeWidget());

  const mockClient = Object.assign(new EventEmitter(), {
    connected: true,
    areas: [],
    devices: [],
    entityRegistry: [],
    getEntityList: jest.fn(() => []),
    disconnect: jest.fn(),
    activateEntity: jest.fn(() => Promise.resolve(true)),
  });

  const app = new App(mockClient as unknown as HassClient, [], 0);
  return { app, mockScreen, mockTable, mockClient };
}

// Emit a named-key keypress (e.g. 'enter', 'escape', 'backspace', 'up', 'down').
function press(mockScreen: any, name: string, ch = ''): void {
  mockScreen.emit('keypress', ch, { name, ctrl: false, meta: false });
}

// Emit a character keypress where blessed sets key.name = undefined (e.g. ':', '/').
function pressChar(mockScreen: any, ch: string): void {
  mockScreen.emit('keypress', ch, { name: undefined, ctrl: false, meta: false });
}

// ─────────────────────────────────────────────────────────────────────────────
// App – mouse click selection
// ─────────────────────────────────────────────────────────────────────────────

describe('App – mouse click selection', () => {
  let mockTable: any;
  let mockScreen: any;
  let mockClient: any;
  let app: App;

  beforeEach(() => {
    ({ app, mockScreen, mockTable, mockClient } = makeApp());
  });

  // ── Core fix: blessed fires "select item" (not "select") when a new row is clicked ──

  it('updates selectedIndex when a new row is clicked ("select item" event)', () => {
    const state = (app as any).state;
    state.filteredEntities = [
      makeEntity('light.one'),
      makeEntity('light.two'),
      makeEntity('light.three'),
    ];
    state.selectedIndex = 0;

    // Display index 3 = entity index 2  (row 0 is the header, rows 1-N are entities)
    mockTable.emit('select item', {}, 3);

    expect(state.selectedIndex).toBe(2);
  });

  it('does not snap back to the old position on the next arrow key press', () => {
    const entities = [
      makeEntity('light.one'),
      makeEntity('light.two'),
      makeEntity('light.three'),
    ];
    const state = (app as any).state;
    state.filteredEntities = entities;
    state.selectedIndex = 0;

    // Simulate clicking row 2 (display index 2 → entity index 1)
    mockTable.emit('select item', {}, 2);
    expect(state.selectedIndex).toBe(1);

    // Arrow down should advance from 1 → 2, not snap back to 0 → 1
    mockScreen.emit('keypress', null, { name: 'down', ctrl: false, meta: false });
    expect(state.selectedIndex).toBe(2);
  });

  // ── Boundary / guard cases ──

  it('does not update selectedIndex when the header row (index 0) fires the event', () => {
    const state = (app as any).state;
    state.filteredEntities = [makeEntity('light.one'), makeEntity('light.two')];
    state.selectedIndex = 1;

    mockTable.emit('select item', {}, 0);

    expect(state.selectedIndex).toBe(1); // unchanged
  });

  it('does not update selectedIndex when the event fires for the already-selected row', () => {
    const state = (app as any).state;
    state.filteredEntities = [makeEntity('light.one'), makeEntity('light.two')];
    state.selectedIndex = 1;

    // Display index 2 → entity index 1, which is already selected
    mockTable.emit('select item', {}, 2);

    expect(state.selectedIndex).toBe(1); // unchanged (no unnecessary re-render)
  });

  it('does not update selectedIndex when _settingSelection guard is active', () => {
    const state = (app as any).state;
    state.filteredEntities = [makeEntity('light.one'), makeEntity('light.two')];
    state.selectedIndex = 0;

    (app as any)._settingSelection = true;
    mockTable.emit('select item', {}, 2);
    (app as any)._settingSelection = false;

    expect(state.selectedIndex).toBe(0); // unchanged – guard blocked the update
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// App – command mode
// ─────────────────────────────────────────────────────────────────────────────

describe('App – command mode', () => {
  let app: App;
  let mockScreen: any;
  let mockClient: any;

  beforeEach(() => {
    ({ app, mockScreen, mockClient } = makeApp());
    // Seed some entities so filtering has something to work with
    const state = (app as any).state;
    state.entities = [
      makeEntity('light.living_room'),
      makeEntity('light.bedroom'),
      makeEntity('switch.fan'),
    ];
    state.filteredEntities = [...state.entities];
  });

  // ── Entering / exiting command mode ──

  it('enters command mode when ":" is typed in normal mode', () => {
    const state = (app as any).state;
    pressChar(mockScreen, ':');
    expect(state.commandMode).toBe(true);
    expect(state.commandBuffer).toBe('');
  });

  it('appends characters to commandBuffer while in command mode', () => {
    const state = (app as any).state;
    state.commandMode = true;
    pressChar(mockScreen, 'a');
    pressChar(mockScreen, 'l');
    pressChar(mockScreen, 'l');
    expect(state.commandBuffer).toBe('all');
  });

  it('removes the last character from commandBuffer on backspace', () => {
    const state = (app as any).state;
    state.commandMode = true;
    state.commandBuffer = 'lig';
    press(mockScreen, 'backspace');
    expect(state.commandBuffer).toBe('li');
  });

  it('exits command mode and clears commandBuffer on Escape', () => {
    const state = (app as any).state;
    state.commandMode = true;
    state.commandBuffer = 'lights';
    press(mockScreen, 'escape', '');
    expect(state.commandMode).toBe(false);
    expect(state.commandBuffer).toBe('');
  });

  // ── :all — view switch ──

  it(':all enter switches currentView to "all"', () => {
    const state = (app as any).state;
    state.commandMode = true;
    state.commandBuffer = 'all';
    state.currentView = 'lights';
    press(mockScreen, 'enter', '\r');
    expect(state.currentView).toBe('all');
    expect(state.commandMode).toBe(false);
  });

  it(':lights enter switches currentView to "lights"', () => {
    const state = (app as any).state;
    state.commandMode = true;
    state.commandBuffer = 'lights';
    press(mockScreen, 'enter', '\r');
    expect(state.currentView).toBe('lights');
    expect(state.commandMode).toBe(false);
  });

  it(':all enter leaves selectedIndex within the bounds of filteredEntities', () => {
    const state = (app as any).state;
    state.commandMode = true;
    state.commandBuffer = 'all';
    state.selectedIndex = 2;
    press(mockScreen, 'enter', '\r');
    expect(state.selectedIndex).toBeGreaterThanOrEqual(0);
    expect(state.selectedIndex).toBeLessThan(state.filteredEntities.length);
  });

  it(':all enter clears any existing areaFilter', () => {
    const state = (app as any).state;
    state.commandMode = true;
    state.commandBuffer = 'all';
    state.areaFilter = 'Kitchen';
    press(mockScreen, 'enter', '\r');
    expect(state.areaFilter).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// App – _suppressNextEnter: command mode Enter must not activate the entity
// ─────────────────────────────────────────────────────────────────────────────

describe('App – _suppressNextEnter (command Enter must not activate entity)', () => {
  let app: App;
  let mockScreen: any;
  let mockClient: any;

  beforeEach(() => {
    ({ app, mockScreen, mockClient } = makeApp());
    const state = (app as any).state;
    state.entities = [makeEntity('light.living_room'), makeEntity('light.bedroom')];
    state.filteredEntities = [...state.entities];
    state.selectedIndex = 0;
  });

  it('sets _suppressNextEnter after command mode processes Enter', () => {
    const state = (app as any).state;
    state.commandMode = true;
    state.commandBuffer = 'all';
    press(mockScreen, 'enter', '\r');
    // The flag should be raised immediately after command execution
    expect((app as any)._suppressNextEnter).toBe(true);
  });

  it('consuming the suppressed Enter clears the flag', () => {
    (app as any)._suppressNextEnter = true;
    press(mockScreen, 'enter', '\n');
    expect((app as any)._suppressNextEnter).toBe(false);
  });

  it('does not call activateEntity when the suppressed Enter fires', () => {
    (app as any)._suppressNextEnter = true;
    press(mockScreen, 'enter', '\n');
    expect(mockClient.activateEntity).not.toHaveBeenCalled();
  });

  it('calls activateEntity on the NEXT Enter after the suppressed one is consumed', () => {
    (app as any)._suppressNextEnter = true;
    // First Enter — suppressed
    press(mockScreen, 'enter', '\n');
    expect(mockClient.activateEntity).not.toHaveBeenCalled();
    // Second Enter — normal activation
    press(mockScreen, 'enter', '\n');
    expect(mockClient.activateEntity).toHaveBeenCalledWith('light.living_room');
  });

  it('does not activate an entity when :all\\r\\n is simulated (the full double-fire scenario)', () => {
    const state = (app as any).state;
    state.commandMode = true;
    state.commandBuffer = 'all';
    // Terminal fires \r first (command is executed here) …
    press(mockScreen, 'enter', '\r');
    // … then immediately fires \n (this must be suppressed)
    press(mockScreen, 'enter', '\n');
    expect(mockClient.activateEntity).not.toHaveBeenCalled();
  });

  it('_suppressNextEnter is not set when Escape exits command mode', () => {
    const state = (app as any).state;
    state.commandMode = true;
    state.commandBuffer = 'all';
    press(mockScreen, 'escape', '');
    expect((app as any)._suppressNextEnter).toBe(false);
  });

  it('_suppressNextEnter does not affect non-Enter keys', () => {
    (app as any)._suppressNextEnter = true;
    const state = (app as any).state;
    // Arrow down should still work normally; the flag is Enter-specific
    press(mockScreen, 'down', '');
    expect(state.selectedIndex).toBe(1);
    // Flag remains set (only consumed by Enter)
    expect((app as any)._suppressNextEnter).toBe(true);
  });
});
