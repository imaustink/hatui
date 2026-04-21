#!/usr/bin/env node
import * as path from 'path';
import * as fs from 'fs';
import { HassClient } from './hass-client';
import { App } from './app';
import { HassConfig, HassConfigFile } from './types';
import { parseCliArgs, runCli } from './cli';

// ─────────────────────────────────────────────────────────────────────────────
// Load config: CLI flags → env vars → ~/.config/hatui/config.json
// ─────────────────────────────────────────────────────────────────────────────

const CONFIG_PATH = path.resolve(process.env['HOME'] ?? '~', '.config', 'hatui', 'config.json');

function normalizeUrl(raw: string): string {
  let u = raw.trim();
  if (!u.startsWith('http')) u = `http://${u}`;
  return u.replace(/\/$/, '');
}

/** Loads all homes from the config file. Returns an empty array when the file is absent or malformed. */
function loadAllHomes(): HassConfig[] {
  if (!fs.existsSync(CONFIG_PATH)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) as HassConfigFile;
    // Multi-home format: { homes: [...] }
    if (Array.isArray(raw.homes) && raw.homes.length > 0) {
      return raw.homes
        .filter((h) => h.url && h.token)
        .map((h) => ({ name: h.name, url: normalizeUrl(h.url), token: h.token }));
    }
    // Legacy single-home format: { url, token }
    if (raw.url && raw.token) {
      return [{ url: normalizeUrl(raw.url), token: raw.token }];
    }
    return [];
  } catch {
    console.error(`  ✖ Failed to parse config file: ${CONFIG_PATH}`);
    return [];
  }
}

interface ConfigResult {
  /** The active HassConfig to connect with. */
  config: HassConfig;
  /** All homes available for context switching. */
  homes: HassConfig[];
  /** Index into `homes` for the active home, or -1 if the active config came from CLI/env. */
  activeHomeIndex: number;
}

function getConfigData(): ConfigResult {
  const args = process.argv.slice(2);
  let cliUrl   = '';
  let cliToken = '';
  let cliName  = '';

  // 1. CLI flags
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url'   && args[i + 1]) cliUrl   = args[++i];
    if (args[i] === '--token' && args[i + 1]) cliToken = args[++i];
    if (args[i] === '--name'  && args[i + 1]) cliName  = args[++i];
  }

  // 2. Environment variables
  const envUrl   = process.env['HASS_URL']   ?? process.env['HA_URL']   ?? '';
  const envToken = process.env['HASS_TOKEN'] ?? process.env['HA_TOKEN'] ?? '';
  const envName  = process.env['HASS_NAME']  ?? process.env['HA_NAME']  ?? '';

  const homes = loadAllHomes();

  // 3. Resolve active config: CLI > env > first home in config file
  let url = cliUrl || envUrl;
  let token = cliToken || envToken;

  if (!url && homes.length > 0) url = homes[0].url;
  if (!token && homes.length > 0) token = homes[0].token;

  if (!url) {
    console.error('\n  ✖ Missing HASS_URL\n');
    printUsage();
    process.exit(1);
  }

  if (!token) {
    console.error('\n  ✖ Missing HASS_TOKEN\n');
    printUsage();
    process.exit(1);
  }

  url = normalizeUrl(url);

  // Determine which homes entry is active (for highlighting in the switcher)
  const activeHomeIndex = homes.findIndex((h) => h.url === url);

  const config: HassConfig = { url, token };
  // Name precedence: CLI flag > env var > config file entry
  const resolvedName = cliName || envName || (activeHomeIndex >= 0 ? homes[activeHomeIndex].name : undefined);
  if (resolvedName) config.name = resolvedName;

  return { config, homes, activeHomeIndex };
}

function printUsage(): void {
  console.log(`
  ${'\x1b[96m'}HATUI${'\x1b[0m'} – k9s-inspired Home Assistant TUI

  ${'\x1b[2m'}Usage (interactive TUI):${'\x1b[0m'}
    hatui [--url <url>] [--token <token>] [--name <name>]

  ${'\x1b[2m'}Usage (one-off commands):${'\x1b[0m'}
    hatui get entities  [--domain <type>] [--search <text>] [--area <name>] [-o table|wide|json]
    hatui get entity    <entity_id>       [-o table|json]
    hatui get areas     [-o table|json]
    hatui get devices   [-o table|json]
    hatui toggle        <entity_id>
    hatui toggle        --area <name> [--domain <domain>]
    hatui turn-on       <entity_id>
    hatui turn-on       --area <name> [--domain <domain>]
    hatui turn-off      <entity_id>
    hatui turn-off      --area <name> [--domain <domain>]
    hatui call          <domain> <service> [--entity <id>] [--data <json>]

  ${'\x1b[2m'}Area examples:${'\x1b[0m'}
    hatui turn-off --area "Living Room"           # turn off all lights
    hatui turn-off --area kitchen --domain switch  # turn off switches
    hatui turn-on  --area bedroom                 # partial name match

  ${'\x1b[2m'}Domain shortcuts for --domain:${'\x1b[0m'}
    lights, switches, sensors, bs (binary_sensors), climate, covers,
    fans, media (media_players), auto (automations), locks, cameras …

  ${'\x1b[2m'}Configuration (in order of precedence):${'\x1b[0m'}
    1. CLI flags:   --url http://homeassistant.local:8123 --token <token> --name "Home"
    2. Environment: HASS_URL=...  HASS_TOKEN=...  HASS_NAME=...
    3. Config file: ~/.config/hatui/config.json

  ${'\'\x1b[2m\''}Config file format (single home):\'\x1b[0m\'}
    {
      "url": "http://homeassistant.local:8123",
      "token": "your_long_lived_access_token"
    }

  ${'\x1b[2m'}Config file format (multiple homes):\'\x1b[0m\'}
    {
      "homes": [
        { "name": "Home",  "url": "http://homeassistant.local:8123", "token": "..." },
        { "name": "Cabin", "url": "http://192.168.1.100:8123",      "token": "..." }
      ]
    }
    Use C or :homes in the TUI to open the home switcher and switch between homes.

  ${'\x1b[2m'}Get a token from:${'\x1b[0m'}
    Home Assistant → Profile → Long-Lived Access Tokens
`);
}

async function main(): Promise<void> {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  const { config, homes, activeHomeIndex } = getConfigData();
  const client = new HassClient(config);

  // Strip connection flags from argv to get the remaining subcommands
  const rawArgs = process.argv.slice(2);
  const stripped: string[] = [];
  for (let i = 0; i < rawArgs.length; i++) {
    if ((rawArgs[i] === '--url' || rawArgs[i] === '--token') && rawArgs[i + 1]) {
      i++; // skip value
    } else {
      stripped.push(rawArgs[i]);
    }
  }

  const cliArgs = parseCliArgs(stripped);

  if (cliArgs) {
    // Non-interactive one-off command (kubectl-style)
    await runCli(client, cliArgs);
  } else {
    // Interactive TUI mode
    const app = new App(client, homes, activeHomeIndex);
    await app.start();
  }
}

main().catch((err) => {
  console.error('\n  ✖ Fatal error:', (err as Error).message);
  process.exit(1);
});
