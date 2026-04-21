import WebSocket from 'ws';
import { HassEntity, HassConfig, HassArea, HassDevice, HassStateChange, HassEntityRegistryEntry } from './types';
import { EventEmitter } from 'events';

interface HassMessage {
  type: string;
  id?: number;
  [key: string]: unknown;
}

export class HassClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private msgId = 1;
  private pendingRequests = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private subscribeId: number | null = null;
  public entities: Map<string, HassEntity> = new Map();
  public areas: HassArea[] = [];
  public devices: HassDevice[] = [];
  public entityRegistry: HassEntityRegistryEntry[] = [];
  public connected = false;

  constructor(private config: HassConfig) {
    super();
  }

  private nextId(): number {
    return this.msgId++;
  }

  private send(msg: HassMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private request<T>(msg: Omit<HassMessage, 'id'>): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = this.nextId();
      this.pendingRequests.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
      });
      this.send({ ...(msg as HassMessage), id });
    });
  }

  async connect(subscribe = true): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = this.config.url
        .replace(/^http/, 'ws')
        .replace(/\/$/, '') + '/api/websocket';

      this.ws = new WebSocket(wsUrl, {
        rejectUnauthorized: false,
      });

      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
        this.ws?.close();
      }, 10000);

      this.ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      this.ws.on('message', async (raw) => {
        let msg: HassMessage;
        try {
          msg = JSON.parse(raw.toString()) as HassMessage;
        } catch {
          return;
        }

        if (msg.type === 'auth_required') {
          this.send({ type: 'auth', access_token: this.config.token });
          return;
        }

        if (msg.type === 'auth_ok') {
          clearTimeout(timeout);
          this.connected = true;
          try {
            await this.bootstrap(subscribe);
            resolve();
          } catch (e) {
            reject(e as Error);
          }
          return;
        }

        if (msg.type === 'auth_invalid') {
          clearTimeout(timeout);
          reject(new Error('Invalid Home Assistant token'));
          return;
        }

        if (msg.type === 'result') {
          const id = msg.id as number;
          const handler = this.pendingRequests.get(id);
          if (handler) {
            this.pendingRequests.delete(id);
            if (msg.success as boolean) {
              handler.resolve(msg.result);
            } else {
              handler.reject(new Error(JSON.stringify(msg.error)));
            }
          }
          return;
        }

        if (msg.type === 'event' && msg.id === this.subscribeId) {
          const event = msg.event as { data: HassStateChange };
          const stateChange = event.data;
          if (stateChange.new_state) {
            this.entities.set(stateChange.entity_id, stateChange.new_state);
          } else {
            this.entities.delete(stateChange.entity_id);
          }
          this.emit('state_changed', stateChange);
        }
      });

      this.ws.on('close', () => {
        this.connected = false;
        this.emit('disconnected');
      });
    });
  }

  private async bootstrap(subscribe = true): Promise<void> {
    // Load all states
    const states = await this.request<HassEntity[]>({ type: 'get_states' });
    for (const entity of states) {
      this.entities.set(entity.entity_id, entity);
    }

    // Load areas
    try {
      this.areas = await this.request<HassArea[]>({
        type: 'config/area_registry/list',
      });
    } catch {
      this.areas = [];
    }

    // Load devices
    try {
      this.devices = await this.request<HassDevice[]>({
        type: 'config/device_registry/list',
      });
    } catch {
      this.devices = [];
    }

    // Load entity registry (entity → area / device mapping)
    try {
      this.entityRegistry = await this.request<HassEntityRegistryEntry[]>({
        type: 'config/entity_registry/list',
      });
    } catch {
      this.entityRegistry = [];
    }

    if (!subscribe) return;

    // Subscribe to state changes
    this.subscribeId = this.nextId();
    this.send({
      id: this.subscribeId,
      type: 'subscribe_events',
      event_type: 'state_changed',
    });
  }

  async callService(domain: string, service: string, serviceData: Record<string, unknown> = {}): Promise<void> {
    await this.request({
      type: 'call_service',
      domain,
      service,
      service_data: serviceData,
    });
  }

  async callServiceWithTarget(
    domain: string,
    service: string,
    target: { area_id?: string | string[]; device_id?: string | string[]; entity_id?: string | string[] },
    serviceData: Record<string, unknown> = {},
  ): Promise<void> {
    await this.request({
      type: 'call_service',
      domain,
      service,
      target,
      service_data: serviceData,
    });
  }

  async toggleEntity(entityId: string): Promise<void> {
    const domain = entityId.split('.')[0];
    const supportedToggle = ['light', 'switch', 'fan', 'cover', 'media_player', 'lock', 'automation', 'input_boolean'];
    if (supportedToggle.includes(domain)) {
      await this.callService(domain, 'toggle', { entity_id: entityId });
    }
  }

  async renameDevice(deviceId: string, nameByUser: string | null): Promise<void> {
    await this.request({
      type: 'config/device_registry/update',
      device_id: deviceId,
      name_by_user: nameByUser,
    });
    const idx = this.devices.findIndex((d) => d.id === deviceId);
    if (idx >= 0) {
      this.devices[idx] = { ...this.devices[idx], name_by_user: nameByUser };
    }
  }

  async assignDeviceArea(deviceId: string, areaId: string | null): Promise<void> {
    await this.request({
      type: 'config/device_registry/update',
      device_id: deviceId,
      area_id: areaId,
    });
    const idx = this.devices.findIndex((d) => d.id === deviceId);
    if (idx >= 0) {
      this.devices[idx] = { ...this.devices[idx], area_id: areaId };
    }
  }

  getEntityList(): HassEntity[] {
    return Array.from(this.entities.values());
  }

  /**
   * Activate an entity in a domain-aware manner (smart toggle/activate).
   * Returns true if an action was dispatched, false if the domain is read-only.
   */
  async activateEntity(entityId: string): Promise<boolean> {
    const domain = entityId.split('.')[0];
    const toggleDomains = ['light', 'switch', 'fan', 'cover', 'media_player', 'lock', 'automation', 'input_boolean'];
    if (toggleDomains.includes(domain)) {
      await this.callService(domain, 'toggle', { entity_id: entityId });
      return true;
    }
    if (domain === 'button' || domain === 'input_button') {
      await this.callService(domain, 'press', { entity_id: entityId });
      return true;
    }
    if (domain === 'scene') {
      await this.callService('scene', 'turn_on', { entity_id: entityId });
      return true;
    }
    if (domain === 'script') {
      const entity = this.entities.get(entityId);
      const service = entity?.state === 'on' ? 'turn_off' : 'turn_on';
      await this.callService('script', service, { entity_id: entityId });
      return true;
    }
    if (domain === 'vacuum') {
      const entity = this.entities.get(entityId);
      const cmd = entity?.state === 'cleaning' ? 'stop' : 'start';
      await this.callService('vacuum', cmd, { entity_id: entityId });
      return true;
    }
    return false;
  }

  async adjustBrightness(entityId: string, delta: number): Promise<boolean> {
    const entity = this.entities.get(entityId);
    // If the light is off, ignore a decrease request — don't turn it on at a stale brightness.
    if (delta < 0 && entity?.state !== 'on') return false;
    const current = (entity?.attributes['brightness'] as number | undefined) ?? 128;
    const newBrightness = Math.max(1, Math.min(255, Math.round(current + delta)));
    await this.callService('light', 'turn_on', { entity_id: entityId, brightness: newBrightness });
    return true;
  }

  async adjustTemperature(entityId: string, delta: number): Promise<void> {
    const entity = this.entities.get(entityId);
    const current = (entity?.attributes['temperature'] as number | undefined) ?? 20;
    const newTemp = Math.round((current + delta) * 2) / 2; // round to nearest 0.5
    await this.callService('climate', 'set_temperature', { entity_id: entityId, temperature: newTemp });
  }

  async cycleHvacMode(entityId: string): Promise<void> {
    const entity = this.entities.get(entityId);
    if (!entity) return;
    const modes = (entity.attributes['hvac_modes'] as string[] | undefined) ?? [];
    if (modes.length < 2) return;
    const currentIdx = modes.indexOf(entity.state);
    const nextMode = modes[(currentIdx + 1) % modes.length];
    await this.callService('climate', 'set_hvac_mode', { entity_id: entityId, hvac_mode: nextMode });
  }

  async controlCover(entityId: string, action: 'open_cover' | 'close_cover' | 'stop_cover'): Promise<void> {
    await this.callService('cover', action, { entity_id: entityId });
  }

  async adjustFanSpeed(entityId: string, direction: 1 | -1): Promise<number | null> {
    const entity = this.entities.get(entityId);
    // If the fan is already off, ignore a decrease request.
    if (direction === -1 && entity?.state !== 'on') return null;
    const current = (entity?.attributes['percentage'] as number | undefined) ?? 0;
    const step = (entity?.attributes['percentage_step'] as number | undefined) ?? 25;
    // Snap current to the nearest step multiple so arithmetic always lands on a valid grid position.
    const snapped = Math.round(current / step) * step;
    const newPct = Math.max(0, Math.min(100, snapped + direction * step));
    if (newPct === 0) {
      await this.callService('fan', 'turn_off', { entity_id: entityId });
    } else {
      await this.callService('fan', 'set_percentage', { entity_id: entityId, percentage: newPct });
    }
    return newPct;
  }

  async adjustVolume(entityId: string, delta: number): Promise<void> {
    const entity = this.entities.get(entityId);
    const current = (entity?.attributes['volume_level'] as number | undefined) ?? 0.5;
    const newVol = Math.max(0, Math.min(1, parseFloat((current + delta).toFixed(2))));
    await this.callService('media_player', 'volume_set', { entity_id: entityId, volume_level: newVol });
  }

  async mediaPlayerCommand(entityId: string, command: 'media_next_track' | 'media_previous_track'): Promise<void> {
    await this.callService('media_player', command, { entity_id: entityId });
  }

  async vacuumCommand(entityId: string, command: 'start' | 'stop' | 'return_to_base'): Promise<void> {
    await this.callService('vacuum', command, { entity_id: entityId });
  }

  async alarmControl(entityId: string, action: string, code?: string): Promise<void> {
    const serviceData: Record<string, unknown> = { entity_id: entityId };
    if (code) serviceData['code'] = code;
    await this.callService('alarm_control_panel', action, serviceData);
  }

  async adjustNumber(entityId: string, direction: 1 | -1): Promise<void> {
    const entity = this.entities.get(entityId);
    if (!entity) return;
    const domain = entityId.split('.')[0];
    const current = parseFloat(entity.state) || 0;
    const step = (entity.attributes['step'] as number | undefined) ?? 1;
    const min = (entity.attributes['min'] as number | undefined) ?? Number.NEGATIVE_INFINITY;
    const max = (entity.attributes['max'] as number | undefined) ?? Number.POSITIVE_INFINITY;
    const newVal = Math.max(min, Math.min(max, parseFloat((current + direction * step).toFixed(6))));
    await this.callService(domain, 'set_value', { entity_id: entityId, value: newVal });
  }

  async cycleSelectOption(entityId: string, direction: 1 | -1): Promise<void> {
    const entity = this.entities.get(entityId);
    if (!entity) return;
    const domain = entityId.split('.')[0];
    const options = (entity.attributes['options'] as string[] | undefined) ?? [];
    if (options.length < 2) return;
    const currentIdx = options.indexOf(entity.state);
    const nextIdx = (currentIdx + direction + options.length) % options.length;
    await this.callService(domain, 'select_option', { entity_id: entityId, option: options[nextIdx] });
  }

  /**
   * Turn on or off a list of entities, grouped by domain.
   * Supports: light, switch, fan, input_boolean (turn_on/turn_off)
   *           cover (open_cover/close_cover)
   */
  async bulkPower(entityIds: string[], action: 'on' | 'off'): Promise<void> {
    // Domains that use standard turn_on / turn_off services
    const standardDomains = ['light', 'switch', 'fan', 'input_boolean'];

    const byDomain = new Map<string, string[]>();
    for (const id of entityIds) {
      const domain = id.split('.')[0];
      if (!byDomain.has(domain)) byDomain.set(domain, []);
      byDomain.get(domain)!.push(id);
    }

    const calls: Promise<void>[] = [];
    for (const [domain, ids] of byDomain) {
      if (standardDomains.includes(domain)) {
        calls.push(this.callService(domain, action === 'on' ? 'turn_on' : 'turn_off', { entity_id: ids }));
      } else if (domain === 'cover') {
        calls.push(this.callService('cover', action === 'on' ? 'open_cover' : 'close_cover', { entity_id: ids }));
      }
    }

    await Promise.all(calls);
  }

  disconnect(): void {
    this.ws?.close();
  }
}
