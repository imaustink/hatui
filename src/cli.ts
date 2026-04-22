import { HassClient } from './hass-client';
import { HassArea, HassDevice, DEVICE_TYPE_DOMAINS, DEVICE_TYPE_SHORTCUTS } from './types';
import { formatState, domainIcon, friendlyName, timeSince } from './theme';

// ─────────────────────────────────────────────────────────────────────────────
// ANSI escape helpers (no blessed in CLI mode)
// ─────────────────────────────────────────────────────────────────────────────

const A = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
  cyan:    '\x1b[96m',
  green:   '\x1b[92m',
  yellow:  '\x1b[93m',
  red:     '\x1b[91m',
  white:   '\x1b[97m',
  gray:    '\x1b[90m',
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Argument parsing
// ─────────────────────────────────────────────────────────────────────────────

export interface CliArgs {
  subcommand: string;
  resource?: string;
  target?: string;
  domain?: string;
  search?: string;
  area?: string;
  entity?: string;
  data?: string;
  output: 'table' | 'json' | 'wide';
}

/**
 * Parse CLI args (after --url / --token have already been stripped).
 * Returns null if there are no positional subcommands (→ TUI mode).
 */
export function parseCliArgs(args: string[]): CliArgs | null {
  const result: CliArgs = { subcommand: '', output: 'table' };
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === '--domain' || arg === '-d') && args[i + 1]) {
      result.domain = args[++i];
    } else if ((arg === '--search' || arg === '-s') && args[i + 1]) {
      result.search = args[++i];
    } else if ((arg === '--area' || arg === '-A') && args[i + 1]) {
      result.area = args[++i];
    } else if ((arg === '--entity' || arg === '-e') && args[i + 1]) {
      result.entity = args[++i];
    } else if (arg === '--data' && args[i + 1]) {
      result.data = args[++i];
    } else if ((arg === '-o' || arg === '--output') && args[i + 1]) {
      const fmt = args[++i];
      if (fmt === 'json' || fmt === 'table' || fmt === 'wide') result.output = fmt;
    } else if (!arg.startsWith('-')) {
      positional.push(arg);
    }
  }

  if (positional.length === 0) return null;

  result.subcommand = positional[0];
  result.resource    = positional[1];
  result.target      = positional[2];
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Formatting helpers
// ─────────────────────────────────────────────────────────────────────────────

function pad(s: string, n: number): string {
  if (s.length >= n) return s.slice(0, n - 1) + ' ';
  return s + ' '.repeat(n - s.length);
}

function trunc(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

/** Pad after truncating to exactly n chars. */
function pf(s: string, n: number): string {
  return pad(trunc(s, n), n);
}

function stateAnsi(state: string): string {
  switch (state) {
    case 'on': case 'open': case 'unlocked': case 'home':
    case 'playing': case 'active': case 'cleaning':
      return A.green;
    case 'off': case 'closed': case 'locked': case 'not_home':
    case 'idle': case 'docked': case 'standby': case 'stopped':
      return A.dim;
    case 'unavailable':
      return A.red;
    case 'unknown':
      return A.yellow;
    default:
      return A.white;
  }
}

function getAreaName(entityId: string, client: HassClient): string {
  const reg = client.entityRegistry.find(r => r.entity_id === entityId);
  let areaId: string | null = null;
  if (reg?.area_id) {
    areaId = reg.area_id;
  } else if (reg?.device_id) {
    const dev = client.devices.find(d => d.id === reg.device_id);
    areaId = dev?.area_id ?? null;
  }
  if (!areaId) return '';
  return client.areas.find(a => a.area_id === areaId)?.name ?? areaId;
}

// ─────────────────────────────────────────────────────────────────────────────
// Output renderers
// ─────────────────────────────────────────────────────────────────────────────

type ColWidths = { entityId: number; state: number; name: number; area: number; age: number };

function printEntitiesTable(
  entities: ReturnType<HassClient['getEntityList']>,
  client: HassClient,
  wide: boolean,
): void {
  const cols: ColWidths = wide
    ? { entityId: 52, state: 20, name: 40, area: 25, age: 8 }
    : { entityId: 42, state: 16, name: 32, area: 20, age: 8 };

  const total = cols.entityId + cols.state + cols.name + cols.area + cols.age;

  process.stdout.write(
    A.bold + A.cyan +
    pf('ENTITY ID', cols.entityId) +
    pf('STATE', cols.state) +
    pf('NAME', cols.name) +
    pf('AREA', cols.area) +
    pf('AGE', cols.age) +
    A.reset + '\n',
  );
  process.stdout.write(A.dim + '─'.repeat(total) + A.reset + '\n');

  for (const entity of entities) {
    const state  = formatState(entity);
    const color  = stateAnsi(entity.state);
    const area   = getAreaName(entity.entity_id, client);
    const age    = timeSince(entity.last_changed);
    const icon   = domainIcon(entity.entity_id);
    const name   = trunc(icon + ' ' + friendlyName(entity), cols.name - 1);

    process.stdout.write(
      A.dim + pf(entity.entity_id, cols.entityId) + A.reset +
      color  + pf(state, cols.state) + A.reset +
      pf(name, cols.name) +
      A.gray + pf(area, cols.area) + A.reset +
      A.gray + pf(age, cols.age) + A.reset + '\n',
    );
  }

  process.stdout.write(A.dim + `\n${entities.length} entities` + A.reset + '\n');
}

function printEntityDetail(
  entity: ReturnType<HassClient['getEntityList']>[number],
  client: HassClient,
): void {
  const area = getAreaName(entity.entity_id, client);
  console.log();
  console.log(A.bold + A.cyan + entity.entity_id + A.reset);
  console.log(A.dim + '─'.repeat(60) + A.reset);
  console.log(`  ${A.dim}Name:${A.reset}       ${friendlyName(entity)}`);
  console.log(`  ${A.dim}Domain:${A.reset}     ${entity.entity_id.split('.')[0]}`);
  console.log(`  ${A.dim}State:${A.reset}      ${stateAnsi(entity.state)}${formatState(entity)}${A.reset}`);
  console.log(`  ${A.dim}Area:${A.reset}       ${area || '—'}`);
  console.log(`  ${A.dim}Changed:${A.reset}    ${entity.last_changed} (${timeSince(entity.last_changed)} ago)`);
  console.log(`  ${A.dim}Updated:${A.reset}    ${entity.last_updated}`);

  const skipKeys = new Set(['friendly_name', 'icon', 'entity_picture', 'area_id']);
  const attrs = Object.entries(entity.attributes).filter(([k]) => !skipKeys.has(k));

  if (attrs.length > 0) {
    console.log();
    console.log(A.bold + A.dim + '  Attributes:' + A.reset);
    for (const [key, val] of attrs) {
      const valStr = Array.isArray(val) ? JSON.stringify(val) : String(val);
      console.log(`  ${A.dim}${pad(key + ':', 24)}${A.reset}${trunc(valStr, 60)}`);
    }
  }
  console.log();
}

function printAreas(areas: HassArea[]): void {
  process.stdout.write(A.bold + A.cyan + pad('AREA ID', 34) + pad('NAME', 30) + A.reset + '\n');
  process.stdout.write(A.dim + '─'.repeat(64) + A.reset + '\n');

  for (const area of [...areas].sort((a, b) => a.name.localeCompare(b.name))) {
    process.stdout.write(A.dim + pf(area.area_id, 34) + A.reset + pf(area.name, 30) + '\n');
  }

  process.stdout.write(A.dim + `\n${areas.length} areas` + A.reset + '\n');
}

function printDevices(devices: HassDevice[], areas: HassArea[]): void {
  const areaMap = new Map(areas.map(a => [a.area_id, a.name]));

  process.stdout.write(
    A.bold + A.cyan +
    pf('NAME', 34) + pf('MANUFACTURER', 22) + pf('MODEL', 24) + pf('AREA', 20) +
    A.reset + '\n',
  );
  process.stdout.write(A.dim + '─'.repeat(100) + A.reset + '\n');

  for (const dev of [...devices].sort((a, b) =>
    (a.name_by_user ?? a.name).localeCompare(b.name_by_user ?? b.name))
  ) {
    const name = dev.name_by_user ?? dev.name;
    const area = dev.area_id ? (areaMap.get(dev.area_id) ?? dev.area_id) : '—';
    process.stdout.write(
      pf(name, 34) +
      A.dim + pf(dev.manufacturer ?? '—', 22) + A.reset +
      A.dim + pf(dev.model ?? '—', 24) + A.reset +
      pf(area, 20) + '\n',
    );
  }

  process.stdout.write(A.dim + `\n${devices.length} devices` + A.reset + '\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Area resolution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve a user-supplied area name (case-insensitive, partial match) to an
 * area_id. Returns the area_id string, or null if nothing matches. If multiple
 * areas match, returns the closest (shortest name) match.
 */
function resolveArea(query: string, client: HassClient): { area_id: string; name: string } | null {
  const q = query.toLowerCase();
  const matches = client.areas.filter(a =>
    a.name.toLowerCase().includes(q) || a.area_id.toLowerCase().includes(q),
  );
  if (matches.length === 0) return null;
  // Prefer exact match first, then shortest (most specific)
  const exact = matches.find(a => a.name.toLowerCase() === q || a.area_id.toLowerCase() === q);
  if (exact) return exact;
  return matches.sort((a, b) => a.name.length - b.name.length)[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// Entity filtering
// ─────────────────────────────────────────────────────────────────────────────

function filterEntities(
  client: HassClient,
  opts: { domain?: string; search?: string; area?: string },
): ReturnType<HassClient['getEntityList']> {
  let entities = client.getEntityList();

  if (opts.domain) {
    const deviceType = DEVICE_TYPE_SHORTCUTS[opts.domain.toLowerCase()];
    if (deviceType && deviceType !== 'all') {
      const rawDomains = DEVICE_TYPE_DOMAINS[deviceType];
      entities = entities.filter(e => rawDomains.includes(e.entity_id.split('.')[0]));
    } else if (!deviceType) {
      // Treat as a raw HA domain (e.g. --domain light)
      entities = entities.filter(e => e.entity_id.startsWith(`${opts.domain}.`));
    }
  }

  if (opts.search) {
    const q = opts.search.toLowerCase();
    entities = entities.filter(e =>
      e.entity_id.toLowerCase().includes(q) ||
      friendlyName(e).toLowerCase().includes(q),
    );
  }

  if (opts.area) {
    const q = opts.area.toLowerCase();
    entities = entities.filter(e =>
      getAreaName(e.entity_id, client).toLowerCase().includes(q),
    );
  }

  return entities.sort((a, b) => a.entity_id.localeCompare(b.entity_id));
}

// ─────────────────────────────────────────────────────────────────────────────
// Main CLI runner
// ─────────────────────────────────────────────────────────────────────────────

export async function runCli(client: HassClient, args: CliArgs): Promise<void> {
  // Connect without subscribing to state changes (read-then-exit mode)
  await client.connect(false);

  try {
    switch (args.subcommand) {
      // ── get ──────────────────────────────────────────────────────────────
      case 'get': {
        const resource = args.resource?.toLowerCase();

        if (!resource) {
          console.error(`${A.red}error: specify a resource — entities | entity <id> | areas | devices${A.reset}`);
          process.exitCode = 1;
          return;
        }

        if (resource === 'entity') {
          if (!args.target) {
            console.error(`${A.red}error: usage: hom3 get entity <entity_id>${A.reset}`);
            process.exitCode = 1;
            return;
          }
          const entity = client.entities.get(args.target);
          if (!entity) {
            console.error(`${A.red}error: entity not found: ${args.target}${A.reset}`);
            process.exitCode = 1;
            return;
          }
          if (args.output === 'json') {
            console.log(JSON.stringify(entity, null, 2));
          } else {
            printEntityDetail(entity, client);
          }
          return;
        }

        if (resource === 'entities') {
          const entities = filterEntities(client, {
            domain: args.domain,
            search: args.search,
            area:   args.area,
          });
          if (args.output === 'json') {
            console.log(JSON.stringify(entities, null, 2));
          } else {
            printEntitiesTable(entities, client, args.output === 'wide');
          }
          return;
        }

        if (resource === 'areas') {
          if (args.output === 'json') {
            console.log(JSON.stringify(client.areas, null, 2));
          } else {
            printAreas(client.areas);
          }
          return;
        }

        if (resource === 'devices') {
          if (args.output === 'json') {
            console.log(JSON.stringify(client.devices, null, 2));
          } else {
            printDevices(client.devices, client.areas);
          }
          return;
        }

        console.error(`${A.red}error: unknown resource: ${resource}${A.reset}`);
        process.exitCode = 1;
        return;
      }

      // ── toggle ───────────────────────────────────────────────────────────
      case 'toggle': {
        if (args.area) {
          const area = resolveArea(args.area, client);
          if (!area) {
            console.error(`${A.red}error: area not found: ${args.area}${A.reset}`);
            process.exitCode = 1;
            return;
          }
          const domain = args.domain ?? 'light';
          await client.callServiceWithTarget(domain, 'toggle', { area_id: area.area_id });
          console.log(`${A.green}✔${A.reset}  toggled ${A.cyan}${domain}${A.reset} in area ${A.cyan}${area.name}${A.reset}`);
          return;
        }
        const entityId = args.resource;
        if (!entityId) {
          console.error(`${A.red}error: usage: hom3 toggle <entity_id>${A.reset}`);
          console.error(`       or:     hom3 toggle --area <name> [--domain <domain>]`);
          process.exitCode = 1;
          return;
        }
        await client.toggleEntity(entityId);
        console.log(`${A.green}✔${A.reset}  toggled ${A.cyan}${entityId}${A.reset}`);
        return;
      }

      // ── turn-on ──────────────────────────────────────────────────────────
      case 'turn-on': {
        if (args.area) {
          const area = resolveArea(args.area, client);
          if (!area) {
            console.error(`${A.red}error: area not found: ${args.area}${A.reset}`);
            process.exitCode = 1;
            return;
          }
          const domain = args.domain ?? 'light';
          await client.callServiceWithTarget(domain, 'turn_on', { area_id: area.area_id });
          console.log(`${A.green}✔${A.reset}  turned on ${A.cyan}${domain}${A.reset} in area ${A.cyan}${area.name}${A.reset}`);
          return;
        }
        const entityId = args.resource;
        if (!entityId) {
          console.error(`${A.red}error: usage: hom3 turn-on <entity_id>${A.reset}`);
          console.error(`       or:     hom3 turn-on --area <name> [--domain <domain>]`);
          process.exitCode = 1;
          return;
        }
        await client.callService(entityId.split('.')[0], 'turn_on', { entity_id: entityId });
        console.log(`${A.green}✔${A.reset}  turned on ${A.cyan}${entityId}${A.reset}`);
        return;
      }

      // ── turn-off ─────────────────────────────────────────────────────────
      case 'turn-off': {
        if (args.area) {
          const area = resolveArea(args.area, client);
          if (!area) {
            console.error(`${A.red}error: area not found: ${args.area}${A.reset}`);
            process.exitCode = 1;
            return;
          }
          const domain = args.domain ?? 'light';
          await client.callServiceWithTarget(domain, 'turn_off', { area_id: area.area_id });
          console.log(`${A.green}✔${A.reset}  turned off ${A.cyan}${domain}${A.reset} in area ${A.cyan}${area.name}${A.reset}`);
          return;
        }
        const entityId = args.resource;
        if (!entityId) {
          console.error(`${A.red}error: usage: hom3 turn-off <entity_id>${A.reset}`);
          console.error(`       or:     hom3 turn-off --area <name> [--domain <domain>]`);
          process.exitCode = 1;
          return;
        }
        await client.callService(entityId.split('.')[0], 'turn_off', { entity_id: entityId });
        console.log(`${A.green}✔${A.reset}  turned off ${A.cyan}${entityId}${A.reset}`);
        return;
      }

      // ── call ─────────────────────────────────────────────────────────────
      case 'call': {
        const domain  = args.resource;
        const service = args.target;
        if (!domain || !service) {
          console.error(
            `${A.red}error: usage: hom3 call <domain> <service> [--entity <id>] [--data <json>]${A.reset}`,
          );
          process.exitCode = 1;
          return;
        }
        const serviceData: Record<string, unknown> = {};
        if (args.entity) serviceData['entity_id'] = args.entity;
        if (args.data) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(args.data);
          } catch {
            console.error(`${A.red}error: --data must be valid JSON${A.reset}`);
            process.exitCode = 1;
            return;
          }
          if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
            Object.assign(serviceData, parsed);
          } else {
            console.error(`${A.red}error: --data must be a JSON object${A.reset}`);
            process.exitCode = 1;
            return;
          }
        }
        await client.callService(domain, service, serviceData);
        console.log(`${A.green}✔${A.reset}  called ${A.cyan}${domain}.${service}${A.reset}`);
        return;
      }

      // ── unknown ──────────────────────────────────────────────────────────
      default:
        console.error(`${A.red}error: unknown command: ${args.subcommand}${A.reset}`);
        console.error(`Run ${A.cyan}hom3 --help${A.reset} for usage.`);
        process.exitCode = 1;
    }
  } finally {
    client.disconnect();
  }
}
