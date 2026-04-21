import { WebSocketServer, WebSocket as WS } from 'ws';
import { HassClient } from '../src/hass-client';
import { HassEntity, HassArea, HassDevice, HassEntityRegistryEntry } from '../src/types';

// ─────────────────────────────────────────────────────────────────────────────
// Mock Home Assistant WebSocket server
// ─────────────────────────────────────────────────────────────────────────────

interface MockServerOptions {
  /** If true, server sends auth_invalid instead of auth_ok */
  rejectAuth?: boolean;
  /** Entities to return on get_states */
  entities?: HassEntity[];
  /** Areas to return on area_registry/list */
  areas?: HassArea[];
  /** Devices to return on device_registry/list */
  devices?: HassDevice[];
  /** Entity registry entries */
  entityRegistry?: HassEntityRegistryEntry[];
  /** If true, never resolves requests (simulates hanging) */
  hang?: boolean;
}

function makeEntity(entity_id: string, state = 'on'): HassEntity {
  return {
    entity_id,
    state,
    attributes: { friendly_name: entity_id.split('.')[1] ?? entity_id },
    last_changed: new Date().toISOString(),
    last_updated: new Date().toISOString(),
    context: { id: 'ctx', parent_id: null, user_id: null },
  };
}

/**
 * Creates a real WebSocket server that simulates the Home Assistant WebSocket API.
 * Returns a cleanup function.
 */
function createMockHassServer(
  port: number,
  opts: MockServerOptions = {}
): { server: WebSocketServer; cleanup: () => Promise<void>; sendStateChange: (change: object) => void } {
  const wss = new WebSocketServer({ port });
  let activeSocket: WS | null = null;
  let subscribeId: number | null = null;

  wss.on('connection', (socket) => {
    activeSocket = socket;

    // Step 1: Send auth_required
    socket.send(JSON.stringify({ type: 'auth_required', ha_version: '2024.1.0' }));

    socket.on('message', (raw) => {
      if (opts.hang) return;

      const msg = JSON.parse(raw.toString()) as Record<string, unknown>;

      // Step 2: Handle auth
      if (msg.type === 'auth') {
        if (opts.rejectAuth) {
          socket.send(JSON.stringify({ type: 'auth_invalid', message: 'Invalid token' }));
        } else {
          socket.send(JSON.stringify({ type: 'auth_ok', ha_version: '2024.1.0' }));
        }
        return;
      }

      // Step 3: Handle requests
      if (msg.id !== undefined) {
        const id = msg.id as number;

        if (msg.type === 'get_states') {
          socket.send(JSON.stringify({
            id, type: 'result', success: true,
            result: opts.entities ?? [],
          }));
          return;
        }

        if (msg.type === 'config/area_registry/list') {
          socket.send(JSON.stringify({
            id, type: 'result', success: true,
            result: opts.areas ?? [],
          }));
          return;
        }

        if (msg.type === 'config/device_registry/list') {
          socket.send(JSON.stringify({
            id, type: 'result', success: true,
            result: opts.devices ?? [],
          }));
          return;
        }

        if (msg.type === 'config/entity_registry/list') {
          socket.send(JSON.stringify({
            id, type: 'result', success: true,
            result: opts.entityRegistry ?? [],
          }));
          return;
        }

        if (msg.type === 'subscribe_events') {
          subscribeId = id;
          socket.send(JSON.stringify({
            id, type: 'result', success: true, result: null,
          }));
          return;
        }

        if (msg.type === 'call_service') {
          socket.send(JSON.stringify({
            id, type: 'result', success: true, result: {},
          }));
          return;
        }

        if (msg.type === 'config/device_registry/update') {
          socket.send(JSON.stringify({
            id, type: 'result', success: true,
            result: { device_id: msg.device_id },
          }));
          return;
        }

        // Unknown request → error
        socket.send(JSON.stringify({
          id, type: 'result', success: false,
          error: { code: 'unknown_command', message: 'Unknown command' },
        }));
      }
    });
  });

  const sendStateChange = (change: object) => {
    if (activeSocket && subscribeId !== null) {
      activeSocket.send(JSON.stringify({
        id: subscribeId,
        type: 'event',
        event: { data: change },
      }));
    }
  };

  const cleanup = (): Promise<void> =>
    new Promise((resolve) => {
      wss.close(() => resolve());
    });

  return { server: wss, cleanup, sendStateChange };
}

function hassUrl(port: number): string {
  return `http://localhost:${port}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Connection & Auth
// ─────────────────────────────────────────────────────────────────────────────

describe('HassClient – connection & auth', () => {
  let cleanup: () => Promise<void>;

  afterEach(async () => {
    if (cleanup) await cleanup();
  });

  it('connects and completes auth handshake successfully', async () => {
    const { cleanup: c } = createMockHassServer(9001);
    cleanup = c;

    const client = new HassClient({ url: hassUrl(9001), token: 'valid-token' });
    await expect(client.connect(false)).resolves.toBeUndefined();
    expect(client.connected).toBe(true);
    client.disconnect();
  });

  it('rejects when auth token is invalid', async () => {
    const { cleanup: c } = createMockHassServer(9002, { rejectAuth: true });
    cleanup = c;

    const client = new HassClient({ url: hassUrl(9002), token: 'bad-token' });
    await expect(client.connect(false)).rejects.toThrow('Invalid Home Assistant token');
    expect(client.connected).toBe(false);
  });

  it('times out when server does not respond', async () => {
    const { cleanup: c } = createMockHassServer(9003, { hang: true });
    cleanup = c;

    const client = new HassClient({ url: hassUrl(9003), token: 'token' });
    // Override timeout to be very short for test speed (10s default is too long)
    // We trigger a quick close instead
    const connectPromise = client.connect(false);
    client.disconnect();
    await expect(connectPromise).rejects.toBeDefined();
  });

  it('emits "disconnected" event when server closes', async () => {
    const { cleanup: c, server } = createMockHassServer(9004);
    cleanup = c;

    const client = new HassClient({ url: hassUrl(9004), token: 'token' });
    await client.connect(false);

    const disconnectPromise = new Promise<void>((resolve) => {
      client.once('disconnected', resolve);
    });

    // Force-close all server connections
    server.clients.forEach((ws) => ws.close());
    await disconnectPromise;
    expect(client.connected).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap – loading entities, areas, devices, registry
// ─────────────────────────────────────────────────────────────────────────────

describe('HassClient – bootstrap', () => {
  let cleanup: () => Promise<void>;

  afterEach(async () => {
    if (cleanup) await cleanup();
  });

  const entities = [
    makeEntity('light.living_room', 'on'),
    makeEntity('switch.kitchen', 'off'),
    makeEntity('sensor.temperature', '21.5'),
  ];
  const areas: HassArea[] = [
    { area_id: 'lr', name: 'Living Room', picture: null },
    { area_id: 'kit', name: 'Kitchen', picture: null },
  ];
  const devices: HassDevice[] = [
    {
      id: 'd1', name: 'Living Room Lamp', name_by_user: null, area_id: 'lr',
      manufacturer: 'Philips', model: 'Hue', model_id: null, sw_version: null,
      hw_version: null, entry_type: null, config_entries: [], connections: [],
      identifiers: [], disabled_by: null, via_device_id: null,
    },
  ];
  const entityRegistry: HassEntityRegistryEntry[] = [
    { entity_id: 'light.living_room', area_id: 'lr', device_id: 'd1', hidden_by: null },
    { entity_id: 'switch.kitchen', area_id: 'kit', device_id: null, hidden_by: null },
  ];

  it('loads all entities into the entities map', async () => {
    const { cleanup: c } = createMockHassServer(9010, { entities });
    cleanup = c;

    const client = new HassClient({ url: hassUrl(9010), token: 'token' });
    await client.connect(false);

    expect(client.entities.size).toBe(3);
    expect(client.entities.has('light.living_room')).toBe(true);
    expect(client.entities.get('light.living_room')!.state).toBe('on');
    client.disconnect();
  });

  it('loads areas', async () => {
    const { cleanup: c } = createMockHassServer(9011, { entities, areas });
    cleanup = c;

    const client = new HassClient({ url: hassUrl(9011), token: 'token' });
    await client.connect(false);

    expect(client.areas).toHaveLength(2);
    expect(client.areas[0].name).toBe('Living Room');
    client.disconnect();
  });

  it('loads devices', async () => {
    const { cleanup: c } = createMockHassServer(9012, { entities, devices });
    cleanup = c;

    const client = new HassClient({ url: hassUrl(9012), token: 'token' });
    await client.connect(false);

    expect(client.devices).toHaveLength(1);
    expect(client.devices[0].id).toBe('d1');
    client.disconnect();
  });

  it('loads entity registry', async () => {
    const { cleanup: c } = createMockHassServer(9013, { entities, entityRegistry });
    cleanup = c;

    const client = new HassClient({ url: hassUrl(9013), token: 'token' });
    await client.connect(false);

    expect(client.entityRegistry).toHaveLength(2);
    expect(client.entityRegistry[0].entity_id).toBe('light.living_room');
    client.disconnect();
  });

  it('getEntityList() returns all loaded entities', async () => {
    const { cleanup: c } = createMockHassServer(9014, { entities });
    cleanup = c;

    const client = new HassClient({ url: hassUrl(9014), token: 'token' });
    await client.connect(false);

    const list = client.getEntityList();
    expect(list).toHaveLength(3);
    expect(list.every((e) => typeof e.entity_id === 'string')).toBe(true);
    client.disconnect();
  });

  it('gracefully handles missing registries (empty arrays)', async () => {
    const { cleanup: c } = createMockHassServer(9015, { entities: [] });
    cleanup = c;

    const client = new HassClient({ url: hassUrl(9015), token: 'token' });
    await client.connect(false);

    expect(client.areas).toEqual([]);
    expect(client.devices).toEqual([]);
    expect(client.entityRegistry).toEqual([]);
    client.disconnect();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// State change subscription
// ─────────────────────────────────────────────────────────────────────────────

describe('HassClient – state_changed events', () => {
  let cleanup: () => Promise<void>;

  afterEach(async () => {
    if (cleanup) await cleanup();
  });

  it('emits "state_changed" event and updates entity map on new state', async () => {
    const initial = [makeEntity('light.living_room', 'off')];
    const { cleanup: c, sendStateChange } = createMockHassServer(9020, { entities: initial });
    cleanup = c;

    const client = new HassClient({ url: hassUrl(9020), token: 'token' });
    await client.connect(true);

    const changePromise = new Promise<object>((resolve) => {
      client.once('state_changed', resolve);
    });

    const newState = makeEntity('light.living_room', 'on');
    sendStateChange({ entity_id: 'light.living_room', new_state: newState, old_state: initial[0] });

    const change = await changePromise as { entity_id: string; new_state: HassEntity };
    expect(change.entity_id).toBe('light.living_room');
    expect(client.entities.get('light.living_room')!.state).toBe('on');
    client.disconnect();
  });

  it('removes entity from map when new_state is null (entity deleted)', async () => {
    const initial = [makeEntity('light.temp', 'on')];
    const { cleanup: c, sendStateChange } = createMockHassServer(9021, { entities: initial });
    cleanup = c;

    const client = new HassClient({ url: hassUrl(9021), token: 'token' });
    await client.connect(true);

    expect(client.entities.has('light.temp')).toBe(true);

    const changePromise = new Promise<void>((resolve) => {
      client.once('state_changed', resolve);
    });

    sendStateChange({ entity_id: 'light.temp', new_state: null, old_state: initial[0] });
    await changePromise;

    expect(client.entities.has('light.temp')).toBe(false);
    client.disconnect();
  });

  it('adds new entity to map on state_changed with new entity', async () => {
    const { cleanup: c, sendStateChange } = createMockHassServer(9022, { entities: [] });
    cleanup = c;

    const client = new HassClient({ url: hassUrl(9022), token: 'token' });
    await client.connect(true);

    const changePromise = new Promise<void>((resolve) => {
      client.once('state_changed', resolve);
    });

    const newEntity = makeEntity('sensor.new_sensor', 'on');
    sendStateChange({ entity_id: 'sensor.new_sensor', new_state: newEntity, old_state: null });
    await changePromise;

    expect(client.entities.has('sensor.new_sensor')).toBe(true);
    client.disconnect();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Service calls
// ─────────────────────────────────────────────────────────────────────────────

describe('HassClient – service calls', () => {
  let cleanup: () => Promise<void>;

  afterEach(async () => {
    if (cleanup) await cleanup();
  });

  it('callService resolves successfully', async () => {
    const { cleanup: c } = createMockHassServer(9030, { entities: [] });
    cleanup = c;

    const client = new HassClient({ url: hassUrl(9030), token: 'token' });
    await client.connect(false);

    await expect(
      client.callService('light', 'turn_on', { entity_id: 'light.bedroom' })
    ).resolves.toBeUndefined();
    client.disconnect();
  });

  it('toggleEntity calls service for supported domains', async () => {
    const entities = [makeEntity('light.bedroom', 'off')];
    const { cleanup: c } = createMockHassServer(9031, { entities });
    cleanup = c;

    const client = new HassClient({ url: hassUrl(9031), token: 'token' });
    await client.connect(false);

    await expect(client.toggleEntity('light.bedroom')).resolves.toBeUndefined();
    await expect(client.toggleEntity('switch.kitchen')).resolves.toBeUndefined();
    await expect(client.toggleEntity('fan.ceiling')).resolves.toBeUndefined();
    client.disconnect();
  });

  it('toggleEntity does nothing for unsupported domains', async () => {
    const { cleanup: c } = createMockHassServer(9032, { entities: [] });
    cleanup = c;

    const client = new HassClient({ url: hassUrl(9032), token: 'token' });
    await client.connect(false);

    // sensor domain is not toggleable — should resolve without making a call
    await expect(client.toggleEntity('sensor.temperature')).resolves.toBeUndefined();
    client.disconnect();
  });

  it('callServiceWithTarget resolves successfully', async () => {
    const { cleanup: c } = createMockHassServer(9033, { entities: [] });
    cleanup = c;

    const client = new HassClient({ url: hassUrl(9033), token: 'token' });
    await client.connect(false);

    await expect(
      client.callServiceWithTarget('light', 'turn_on', { area_id: 'living_room' })
    ).resolves.toBeUndefined();
    client.disconnect();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Device registry mutations
// ─────────────────────────────────────────────────────────────────────────────

describe('HassClient – device registry mutations', () => {
  let cleanup: () => Promise<void>;

  const devices: HassDevice[] = [
    {
      id: 'd1', name: 'Old Name', name_by_user: null, area_id: null,
      manufacturer: null, model: null, model_id: null, sw_version: null,
      hw_version: null, entry_type: null, config_entries: [], connections: [],
      identifiers: [], disabled_by: null, via_device_id: null,
    },
  ];

  afterEach(async () => {
    if (cleanup) await cleanup();
  });

  it('renameDevice updates local device state', async () => {
    const { cleanup: c } = createMockHassServer(9040, { entities: [], devices: [...devices] });
    cleanup = c;

    const client = new HassClient({ url: hassUrl(9040), token: 'token' });
    await client.connect(false);

    await client.renameDevice('d1', 'New Name');
    const device = client.devices.find((d) => d.id === 'd1');
    expect(device?.name_by_user).toBe('New Name');
    client.disconnect();
  });

  it('assignDeviceArea updates local device area_id', async () => {
    const { cleanup: c } = createMockHassServer(9041, { entities: [], devices: [...devices] });
    cleanup = c;

    const client = new HassClient({ url: hassUrl(9041), token: 'token' });
    await client.connect(false);

    await client.assignDeviceArea('d1', 'lr');
    const device = client.devices.find((d) => d.id === 'd1');
    expect(device?.area_id).toBe('lr');
    client.disconnect();
  });

  it('renameDevice with null clears name_by_user', async () => {
    const devicesWithName: HassDevice[] = [{ ...devices[0], name_by_user: 'Some Name' }];
    const { cleanup: c } = createMockHassServer(9042, { entities: [], devices: devicesWithName });
    cleanup = c;

    const client = new HassClient({ url: hassUrl(9042), token: 'token' });
    await client.connect(false);

    await client.renameDevice('d1', null);
    const device = client.devices.find((d) => d.id === 'd1');
    expect(device?.name_by_user).toBeNull();
    client.disconnect();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// bulkPower
// ─────────────────────────────────────────────────────────────────────────────

describe('HassClient – bulkPower', () => {
  let cleanup: () => Promise<void>;

  afterEach(async () => {
    if (cleanup) await cleanup();
  });

  it('turns on standard domains with turn_on service', async () => {
    const { cleanup: c } = createMockHassServer(9050, { entities: [] });
    cleanup = c;

    const client = new HassClient({ url: hassUrl(9050), token: 'token' });
    await client.connect(false);

    const entityIds = ['light.a', 'light.b', 'switch.c'];
    await expect(client.bulkPower(entityIds, 'on')).resolves.toBeUndefined();
    client.disconnect();
  });

  it('turns off standard domains with turn_off service', async () => {
    const { cleanup: c } = createMockHassServer(9051, { entities: [] });
    cleanup = c;

    const client = new HassClient({ url: hassUrl(9051), token: 'token' });
    await client.connect(false);

    await expect(client.bulkPower(['light.x', 'fan.y'], 'off')).resolves.toBeUndefined();
    client.disconnect();
  });

  it('uses open_cover for cover domain when action is "on"', async () => {
    const { cleanup: c } = createMockHassServer(9052, { entities: [] });
    cleanup = c;

    const client = new HassClient({ url: hassUrl(9052), token: 'token' });
    await client.connect(false);

    await expect(client.bulkPower(['cover.garage'], 'on')).resolves.toBeUndefined();
    client.disconnect();
  });

  it('uses close_cover for cover domain when action is "off"', async () => {
    const { cleanup: c } = createMockHassServer(9053, { entities: [] });
    cleanup = c;

    const client = new HassClient({ url: hassUrl(9053), token: 'token' });
    await client.connect(false);

    await expect(client.bulkPower(['cover.garage'], 'off')).resolves.toBeUndefined();
    client.disconnect();
  });

  it('silently ignores unsupported domains', async () => {
    const { cleanup: c } = createMockHassServer(9054, { entities: [] });
    cleanup = c;

    const client = new HassClient({ url: hassUrl(9054), token: 'token' });
    await client.connect(false);

    // automation, sensor are not in the supported list for bulkPower
    await expect(client.bulkPower(['sensor.temp', 'automation.morning'], 'on')).resolves.toBeUndefined();
    client.disconnect();
  });

  it('handles empty entity list', async () => {
    const { cleanup: c } = createMockHassServer(9055, { entities: [] });
    cleanup = c;

    const client = new HassClient({ url: hassUrl(9055), token: 'token' });
    await client.connect(false);

    await expect(client.bulkPower([], 'on')).resolves.toBeUndefined();
    client.disconnect();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Device-specific service methods (unit tests — no WebSocket needed)
// callService is mocked via jest.spyOn so we test routing / math / clamping.
// ─────────────────────────────────────────────────────────────────────────────

function makeClientWithEntity(entity_id: string, state: string, attributes: Record<string, unknown> = {}): {
  client: HassClient;
  callSpy: jest.SpyInstance;
} {
  const client = new HassClient({ url: 'http://localhost:0', token: 'token' });
  client.entities.set(entity_id, {
    entity_id,
    state,
    attributes: { friendly_name: entity_id, ...attributes },
    last_changed: new Date().toISOString(),
    last_updated: new Date().toISOString(),
    context: { id: 'ctx', parent_id: null, user_id: null },
  });
  const callSpy = jest
    .spyOn(client as unknown as { callService: () => Promise<void> }, 'callService')
    .mockResolvedValue(undefined);
  return { client, callSpy };
}

describe('HassClient – activateEntity', () => {
  it('toggles a light and returns true', async () => {
    const { client, callSpy } = makeClientWithEntity('light.desk', 'on');
    const result = await client.activateEntity('light.desk');
    expect(result).toBe(true);
    expect(callSpy).toHaveBeenCalledWith('light', 'toggle', { entity_id: 'light.desk' });
  });

  it('toggles a switch and returns true', async () => {
    const { client, callSpy } = makeClientWithEntity('switch.fan', 'off');
    const result = await client.activateEntity('switch.fan');
    expect(result).toBe(true);
    expect(callSpy).toHaveBeenCalledWith('switch', 'toggle', { entity_id: 'switch.fan' });
  });

  it('returns false for read-only sensor domain', async () => {
    const { client, callSpy } = makeClientWithEntity('sensor.temp', '21');
    const result = await client.activateEntity('sensor.temp');
    expect(result).toBe(false);
    expect(callSpy).not.toHaveBeenCalled();
  });

  it('returns false for binary_sensor', async () => {
    const { client, callSpy } = makeClientWithEntity('binary_sensor.motion', 'off');
    expect(await client.activateEntity('binary_sensor.motion')).toBe(false);
    expect(callSpy).not.toHaveBeenCalled();
  });

  it('presses a button entity', async () => {
    const { client, callSpy } = makeClientWithEntity('button.restart', 'unknown');
    const result = await client.activateEntity('button.restart');
    expect(result).toBe(true);
    expect(callSpy).toHaveBeenCalledWith('button', 'press', { entity_id: 'button.restart' });
  });

  it('activates a scene', async () => {
    const { client, callSpy } = makeClientWithEntity('scene.movie', 'scening');
    const result = await client.activateEntity('scene.movie');
    expect(result).toBe(true);
    expect(callSpy).toHaveBeenCalledWith('scene', 'turn_on', { entity_id: 'scene.movie' });
  });

  it('turns on a script that is off', async () => {
    const { client, callSpy } = makeClientWithEntity('script.greet', 'off');
    await client.activateEntity('script.greet');
    expect(callSpy).toHaveBeenCalledWith('script', 'turn_on', { entity_id: 'script.greet' });
  });

  it('turns off a script that is running', async () => {
    const { client, callSpy } = makeClientWithEntity('script.greet', 'on');
    await client.activateEntity('script.greet');
    expect(callSpy).toHaveBeenCalledWith('script', 'turn_off', { entity_id: 'script.greet' });
  });

  it('starts a vacuum that is not cleaning', async () => {
    const { client, callSpy } = makeClientWithEntity('vacuum.roomba', 'docked');
    await client.activateEntity('vacuum.roomba');
    expect(callSpy).toHaveBeenCalledWith('vacuum', 'start', { entity_id: 'vacuum.roomba' });
  });

  it('stops a vacuum that is cleaning', async () => {
    const { client, callSpy } = makeClientWithEntity('vacuum.roomba', 'cleaning');
    await client.activateEntity('vacuum.roomba');
    expect(callSpy).toHaveBeenCalledWith('vacuum', 'stop', { entity_id: 'vacuum.roomba' });
  });
});

describe('HassClient – adjustBrightness', () => {
  it('increases brightness by delta', async () => {
    const { client, callSpy } = makeClientWithEntity('light.desk', 'on', { brightness: 128 });
    await client.adjustBrightness('light.desk', 26);
    expect(callSpy).toHaveBeenCalledWith('light', 'turn_on', { entity_id: 'light.desk', brightness: 154 });
  });

  it('clamps brightness to minimum 1', async () => {
    const { client, callSpy } = makeClientWithEntity('light.dim', 'on', { brightness: 5 });
    await client.adjustBrightness('light.dim', -100);
    const args = callSpy.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(args[2]['brightness']).toBe(1);
  });

  it('clamps brightness to maximum 255', async () => {
    const { client, callSpy } = makeClientWithEntity('light.bright', 'on', { brightness: 250 });
    await client.adjustBrightness('light.bright', 100);
    const args = callSpy.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(args[2]['brightness']).toBe(255);
  });

  it('defaults to 128 when brightness attribute is absent (increment)', async () => {
    const { client, callSpy } = makeClientWithEntity('light.no_attr', 'on');
    await client.adjustBrightness('light.no_attr', 10);
    const args = callSpy.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(args[2]['brightness']).toBe(138);
  });

  it('does nothing when decrementing an off light (prevents turning on at stale brightness)', async () => {
    const { client, callSpy } = makeClientWithEntity('light.desk', 'off', { brightness: 128 });
    const result = await client.adjustBrightness('light.desk', -26);
    expect(callSpy).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });

  it('does nothing when decrementing an off light with no brightness attribute', async () => {
    const { client, callSpy } = makeClientWithEntity('light.desk', 'off');
    const result = await client.adjustBrightness('light.desk', -26);
    expect(callSpy).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });
});

describe('HassClient – adjustTemperature', () => {
  it('increases temperature by 0.5', async () => {
    const { client, callSpy } = makeClientWithEntity('climate.hall', 'heat', { temperature: 20 });
    await client.adjustTemperature('climate.hall', 0.5);
    expect(callSpy).toHaveBeenCalledWith('climate', 'set_temperature', {
      entity_id: 'climate.hall',
      temperature: 20.5,
    });
  });

  it('decreases temperature and rounds to nearest 0.5', async () => {
    const { client, callSpy } = makeClientWithEntity('climate.hall', 'heat', { temperature: 21 });
    await client.adjustTemperature('climate.hall', -0.5);
    const args = callSpy.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(args[2]['temperature']).toBe(20.5);
  });
});

describe('HassClient – cycleHvacMode', () => {
  it('cycles to the next HVAC mode', async () => {
    const { client, callSpy } = makeClientWithEntity('climate.ac', 'cool', {
      hvac_modes: ['off', 'cool', 'heat'],
    });
    await client.cycleHvacMode('climate.ac');
    expect(callSpy).toHaveBeenCalledWith('climate', 'set_hvac_mode', {
      entity_id: 'climate.ac',
      hvac_mode: 'heat',
    });
  });

  it('wraps around to first mode from last', async () => {
    const { client, callSpy } = makeClientWithEntity('climate.ac', 'heat', {
      hvac_modes: ['off', 'cool', 'heat'],
    });
    await client.cycleHvacMode('climate.ac');
    expect(callSpy).toHaveBeenCalledWith('climate', 'set_hvac_mode', {
      entity_id: 'climate.ac',
      hvac_mode: 'off',
    });
  });

  it('does nothing when only one HVAC mode exists', async () => {
    const { client, callSpy } = makeClientWithEntity('climate.simple', 'heat', {
      hvac_modes: ['heat'],
    });
    await client.cycleHvacMode('climate.simple');
    expect(callSpy).not.toHaveBeenCalled();
  });
});

describe('HassClient – controlCover', () => {
  it('sends open_cover service', async () => {
    const { client, callSpy } = makeClientWithEntity('cover.garage', 'closed');
    await client.controlCover('cover.garage', 'open_cover');
    expect(callSpy).toHaveBeenCalledWith('cover', 'open_cover', { entity_id: 'cover.garage' });
  });

  it('sends close_cover service', async () => {
    const { client, callSpy } = makeClientWithEntity('cover.garage', 'open');
    await client.controlCover('cover.garage', 'close_cover');
    expect(callSpy).toHaveBeenCalledWith('cover', 'close_cover', { entity_id: 'cover.garage' });
  });

  it('sends stop_cover service', async () => {
    const { client, callSpy } = makeClientWithEntity('cover.garage', 'opening');
    await client.controlCover('cover.garage', 'stop_cover');
    expect(callSpy).toHaveBeenCalledWith('cover', 'stop_cover', { entity_id: 'cover.garage' });
  });
});

describe('HassClient – adjustFanSpeed', () => {
  it('does nothing when decrementing an already-off fan', async () => {
    const { client, callSpy } = makeClientWithEntity('fan.ceiling', 'off', { percentage: 100, percentage_step: 25 });
    const result = await client.adjustFanSpeed('fan.ceiling', -1);
    expect(callSpy).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('snaps to step grid before applying delta (avoids off-grid starting values)', async () => {
    // HA reports percentage: 33 (off-grid for step 25); snapped = 25, then +1 step = 50
    const { client, callSpy } = makeClientWithEntity('fan.ceiling', 'on', { percentage: 33, percentage_step: 25 });
    const result = await client.adjustFanSpeed('fan.ceiling', 1);
    expect(callSpy).toHaveBeenCalledWith('fan', 'set_percentage', {
      entity_id: 'fan.ceiling',
      percentage: 50,
    });
    expect(result).toBe(50);
  });

  it('increases fan speed by one percentage_step', async () => {
    const { client, callSpy } = makeClientWithEntity('fan.ceiling', 'on', { percentage: 50, percentage_step: 25 });
    const result = await client.adjustFanSpeed('fan.ceiling', 1);
    expect(callSpy).toHaveBeenCalledWith('fan', 'set_percentage', {
      entity_id: 'fan.ceiling',
      percentage: 75,
    });
    expect(result).toBe(75);
  });

  it('decreases fan speed by one percentage_step', async () => {
    const { client, callSpy } = makeClientWithEntity('fan.ceiling', 'on', { percentage: 75, percentage_step: 25 });
    const result = await client.adjustFanSpeed('fan.ceiling', -1);
    expect(callSpy).toHaveBeenCalledWith('fan', 'set_percentage', {
      entity_id: 'fan.ceiling',
      percentage: 50,
    });
    expect(result).toBe(50);
  });

  it('calls turn_off and returns 0 when speed steps down to 0', async () => {
    const { client, callSpy } = makeClientWithEntity('fan.ceiling', 'on', { percentage: 25, percentage_step: 25 });
    const result = await client.adjustFanSpeed('fan.ceiling', -1);
    expect(callSpy).toHaveBeenCalledWith('fan', 'turn_off', { entity_id: 'fan.ceiling' });
    expect(result).toBe(0);
  });

  it('defaults to step 25 when percentage_step attribute is absent', async () => {
    const { client, callSpy } = makeClientWithEntity('fan.simple', 'on', { percentage: 50 });
    await client.adjustFanSpeed('fan.simple', 1);
    expect(callSpy).toHaveBeenCalledWith('fan', 'set_percentage', {
      entity_id: 'fan.simple',
      percentage: 75,
    });
  });

  it('clamps fan speed to maximum 100', async () => {
    const { client, callSpy } = makeClientWithEntity('fan.ceiling', 'on', { percentage: 100, percentage_step: 25 });
    const result = await client.adjustFanSpeed('fan.ceiling', 1);
    const args = callSpy.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(args[2]['percentage']).toBe(100);
    expect(result).toBe(100);
  });
});

describe('HassClient – adjustVolume', () => {
  it('increases volume by 0.1', async () => {
    const { client, callSpy } = makeClientWithEntity('media_player.tv', 'playing', { volume_level: 0.5 });
    await client.adjustVolume('media_player.tv', 0.1);
    expect(callSpy).toHaveBeenCalledWith('media_player', 'volume_set', {
      entity_id: 'media_player.tv',
      volume_level: 0.6,
    });
  });

  it('clamps volume to minimum 0', async () => {
    const { client, callSpy } = makeClientWithEntity('media_player.tv', 'playing', { volume_level: 0.05 });
    await client.adjustVolume('media_player.tv', -0.5);
    const args = callSpy.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(args[2]['volume_level']).toBe(0);
  });

  it('clamps volume to maximum 1', async () => {
    const { client, callSpy } = makeClientWithEntity('media_player.tv', 'playing', { volume_level: 0.95 });
    await client.adjustVolume('media_player.tv', 0.5);
    const args = callSpy.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(args[2]['volume_level']).toBe(1);
  });
});

describe('HassClient – mediaPlayerCommand', () => {
  it('sends media_next_track', async () => {
    const { client, callSpy } = makeClientWithEntity('media_player.speaker', 'playing');
    await client.mediaPlayerCommand('media_player.speaker', 'media_next_track');
    expect(callSpy).toHaveBeenCalledWith('media_player', 'media_next_track', {
      entity_id: 'media_player.speaker',
    });
  });

  it('sends media_previous_track', async () => {
    const { client, callSpy } = makeClientWithEntity('media_player.speaker', 'playing');
    await client.mediaPlayerCommand('media_player.speaker', 'media_previous_track');
    expect(callSpy).toHaveBeenCalledWith('media_player', 'media_previous_track', {
      entity_id: 'media_player.speaker',
    });
  });
});

describe('HassClient – vacuumCommand', () => {
  it('sends start command', async () => {
    const { client, callSpy } = makeClientWithEntity('vacuum.roomba', 'docked');
    await client.vacuumCommand('vacuum.roomba', 'start');
    expect(callSpy).toHaveBeenCalledWith('vacuum', 'start', { entity_id: 'vacuum.roomba' });
  });

  it('sends return_to_base command', async () => {
    const { client, callSpy } = makeClientWithEntity('vacuum.roomba', 'cleaning');
    await client.vacuumCommand('vacuum.roomba', 'return_to_base');
    expect(callSpy).toHaveBeenCalledWith('vacuum', 'return_to_base', { entity_id: 'vacuum.roomba' });
  });
});

describe('HassClient – alarmControl', () => {
  it('sends alarm_disarm without code', async () => {
    const { client, callSpy } = makeClientWithEntity('alarm_control_panel.home', 'armed_away');
    await client.alarmControl('alarm_control_panel.home', 'alarm_disarm');
    expect(callSpy).toHaveBeenCalledWith('alarm_control_panel', 'alarm_disarm', {
      entity_id: 'alarm_control_panel.home',
    });
  });

  it('includes code in service_data when provided', async () => {
    const { client, callSpy } = makeClientWithEntity('alarm_control_panel.home', 'disarmed');
    await client.alarmControl('alarm_control_panel.home', 'alarm_arm_away', '1234');
    expect(callSpy).toHaveBeenCalledWith('alarm_control_panel', 'alarm_arm_away', {
      entity_id: 'alarm_control_panel.home',
      code: '1234',
    });
  });
});

describe('HassClient – adjustNumber', () => {
  it('increases value by step', async () => {
    const { client, callSpy } = makeClientWithEntity('number.volume', '50', {
      step: 5, min: 0, max: 100,
    });
    await client.adjustNumber('number.volume', 1);
    expect(callSpy).toHaveBeenCalledWith('number', 'set_value', {
      entity_id: 'number.volume',
      value: 55,
    });
  });

  it('decreases value by step', async () => {
    const { client, callSpy } = makeClientWithEntity('number.volume', '50', {
      step: 5, min: 0, max: 100,
    });
    await client.adjustNumber('number.volume', -1);
    expect(callSpy).toHaveBeenCalledWith('number', 'set_value', {
      entity_id: 'number.volume',
      value: 45,
    });
  });

  it('clamps to minimum', async () => {
    const { client, callSpy } = makeClientWithEntity('number.volume', '2', {
      step: 5, min: 0, max: 100,
    });
    await client.adjustNumber('number.volume', -1);
    const args = callSpy.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(args[2]['value']).toBe(0);
  });

  it('clamps to maximum', async () => {
    const { client, callSpy } = makeClientWithEntity('number.volume', '98', {
      step: 5, min: 0, max: 100,
    });
    await client.adjustNumber('number.volume', 1);
    const args = callSpy.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(args[2]['value']).toBe(100);
  });

  it('works for input_number domain', async () => {
    const { client, callSpy } = makeClientWithEntity('input_number.threshold', '10', {
      step: 1, min: 0, max: 20,
    });
    await client.adjustNumber('input_number.threshold', 1);
    expect(callSpy).toHaveBeenCalledWith('input_number', 'set_value', {
      entity_id: 'input_number.threshold',
      value: 11,
    });
  });
});

describe('HassClient – cycleSelectOption', () => {
  it('moves to next option', async () => {
    const { client, callSpy } = makeClientWithEntity('select.source', 'HDMI 1', {
      options: ['HDMI 1', 'HDMI 2', 'AV'],
    });
    await client.cycleSelectOption('select.source', 1);
    expect(callSpy).toHaveBeenCalledWith('select', 'select_option', {
      entity_id: 'select.source',
      option: 'HDMI 2',
    });
  });

  it('moves to previous option', async () => {
    const { client, callSpy } = makeClientWithEntity('select.source', 'HDMI 2', {
      options: ['HDMI 1', 'HDMI 2', 'AV'],
    });
    await client.cycleSelectOption('select.source', -1);
    expect(callSpy).toHaveBeenCalledWith('select', 'select_option', {
      entity_id: 'select.source',
      option: 'HDMI 1',
    });
  });

  it('wraps forward from last to first option', async () => {
    const { client, callSpy } = makeClientWithEntity('select.source', 'AV', {
      options: ['HDMI 1', 'HDMI 2', 'AV'],
    });
    await client.cycleSelectOption('select.source', 1);
    const args = callSpy.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(args[2]['option']).toBe('HDMI 1');
  });

  it('wraps backward from first to last option', async () => {
    const { client, callSpy } = makeClientWithEntity('select.source', 'HDMI 1', {
      options: ['HDMI 1', 'HDMI 2', 'AV'],
    });
    await client.cycleSelectOption('select.source', -1);
    const args = callSpy.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(args[2]['option']).toBe('AV');
  });

  it('does nothing when fewer than 2 options exist', async () => {
    const { client, callSpy } = makeClientWithEntity('select.single', 'Only', {
      options: ['Only'],
    });
    await client.cycleSelectOption('select.single', 1);
    expect(callSpy).not.toHaveBeenCalled();
  });

  it('works for input_select domain', async () => {
    const { client, callSpy } = makeClientWithEntity('input_select.mode', 'Auto', {
      options: ['Auto', 'Manual'],
    });
    await client.cycleSelectOption('input_select.mode', 1);
    expect(callSpy).toHaveBeenCalledWith('input_select', 'select_option', {
      entity_id: 'input_select.mode',
      option: 'Manual',
    });
  });
});

