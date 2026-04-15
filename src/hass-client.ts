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

  async connect(): Promise<void> {
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
            await this.bootstrap();
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

  private async bootstrap(): Promise<void> {
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
