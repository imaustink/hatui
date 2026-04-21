import { HassEntity, HassArea, HassConfig, DeviceType, DEVICE_TYPE_DOMAINS, AppState, DEVICE_TYPE_SHORTCUTS } from './types';
import {
  COLORS,
  domainIcon,
  friendlyName,
  formatState,
  stateColor,
  timeSince,
} from './theme';

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

/** k9s-style shortcut badge: highlighted key + dim label. */
function badge(key: string, label: string): string {
  return (
    `{bold}{${COLORS.bgSelected}-bg}{${COLORS.cyan}-fg}${key}{/}` +
    `{${COLORS.textSecondary}-fg} ${label}{/}`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Logo / header art
// ─────────────────────────────────────────────────────────────────────────────

export const LOGO_ART = [
  '{bold}{#00e5ff-fg}██╗  ██╗ █████╗ ████████╗██╗   ██╗██╗{/}',
  '{bold}{#00e5ff-fg}██║  ██║██╔══██╗╚══██╔══╝██║   ██║██║{/}',
  '{bold}{#ff00ff-fg}███████║███████║   ██║   ██║   ██║██║{/}',
  '{bold}{#ff00ff-fg}██╔══██║██╔══██║   ██║   ██║   ██║██║{/}',
  '{bold}{#aa44ff-fg}██║  ██║██║  ██║   ██║   ╚██████╔╝██║{/}',
  '{bold}{#aa44ff-fg}╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝    ╚═════╝ ╚═╝{/}',
].join('\n');

// ─────────────────────────────────────────────────────────────────────────────
// Header render  (3-line k9s-style)
// ─────────────────────────────────────────────────────────────────────────────

/** Render the k9s-style numbered recent-area selector line. */
function renderRecentAreasLine(recentAreas: string[], activeArea: string): string {
  const sep = `{${COLORS.border}-fg}│{/}`;
  const label = `{${COLORS.textDim}-fg}areas{/} ${sep} `;

  if (recentAreas.length === 0) {
    return ` ${label}{${COLORS.textDim}-fg}No recent areas  —  use :<view> <area> or :<area> to filter{/}`;
  }

  const parts = recentAreas.slice(0, 5).map((area, i) => {
    const num = i + 1;
    const isActive = area.toLowerCase() === activeArea.toLowerCase();
    if (isActive) {
      return (
        `{bold}{${COLORS.cyan}-bg}{${COLORS.bgPanel}-fg}<${num}>{/}` +
        `{bold}{${COLORS.cyan}-fg} ${area}{/}`
      );
    }
    return (
      `{bold}{${COLORS.bgSelected}-bg}{${COLORS.cyan}-fg}<${num}>{/}` +
      `{${COLORS.textSecondary}-fg} ${area}{/}`
    );
  });

  return ` ${label}` + parts.join('  ');
}

export function renderHeader(state: AppState, width: number): string {
  const connIcon = state.connected
    ? `{${COLORS.green}-fg}◉ CONNECTED{/}`
    : `{${COLORS.red}-fg}◉ OFFLINE{/}`;

  const countLabel = `{${COLORS.textSecondary}-fg}${state.filteredEntities.length} entities{/}`;
  const time = new Date().toLocaleTimeString('en-US', { hour12: false });
  const timeLabel = `{${COLORS.textDim}-fg}${time}{/}`;
  const title = `{bold}{${COLORS.magenta}-fg} HA{/}{bold}{${COLORS.cyan}-fg}TUI{/}`;
  const sep = `{${COLORS.border}-fg}│{/}`;

  // Active home name indicator (k9s-style context badge)
  const activeHome = state.homes[state.activeHomeIndex];
  const homeLabel = activeHome
    ? `{${COLORS.bgSelected}-bg}{${COLORS.cyan}-fg} ${activeHome.name ?? new URL(activeHome.url).hostname} {/}`
    : '';

  // ── Line 1: title bar ───────────────────────────────────────────────────
  const homePart = homeLabel ? `  ${sep}  ${homeLabel}` : '';
  const line1 = ` ${title}  ${sep}  ${connIcon}${homePart}  ${sep}  ${countLabel}  ${sep}  ${timeLabel} `;

  if (width < 60) {
    return line1;
  }

  // ── Line 2: recent areas (k9s-style namespace selector) ───────────────────
  const line2 = renderRecentAreasLine(state.recentAreas, state.areaFilter);

  // ── Line 3: view shortcut badges ──────────────────────────────────────────
  const viewBadges = [
    badge(':all',     'All'),
    badge(':lights',  'Lights'),
    badge(':switches','Switches'),
    badge(':sensors', 'Sensors'),
    badge(':climate', 'Climate'),
    badge(':covers',  'Covers'),
    badge(':fans',    'Fans'),
    badge(':media',   'Media'),
    badge(':locks',   'Locks'),
  ];

  // ── Line 4: action shortcut badges ────────────────────────────────────────
  const actionBadges = [
    badge('<t>', 'Toggle'),
    badge('<d>', 'Describe'),
    badge('<n>', 'Rename'),
    badge('<a>', 'Area'),
    badge('<r>', 'Refresh'),
    badge('</>', 'Filter'),
    badge('<y>', 'Yank'),
    badge('<C>', 'Context'),
    badge('<?>', 'Help'),
    badge('<q>', 'Quit'),
  ];

  const gap = '  ';
  const line3 = ' ' + viewBadges.join(gap);

  // ── Line 4: dynamic device-specific control hints ─────────────────────────
  const selected = state.filteredEntities[state.selectedIndex] ?? null;
  const line4 = renderNormalHints(selected, width);

  return `${line1}\n${line2}\n${line3}\n${line4}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Entity table row
// ─────────────────────────────────────────────────────────────────────────────

const COL_ICON = 2;

// Compute column widths that fit within the table's inner pixel budget.
// innerWidth = floor(screenWidth * 0.70) − 4  (border + padding)
function computeCols(innerWidth: number): { name: number; state: number; area: number; age: number } {
  if (innerWidth >= 80) return { name: 30, state: 22, area: 16, age: 5 };
  if (innerWidth >= 65) return { name: 24, state: 16, area: 12, age: 4 };
  if (innerWidth >= 50) return { name: 20, state: 12, area:  0, age: 0 };
  if (innerWidth >= 36) return { name: 16, state:  8, area:  0, age: 0 };
  return { name: Math.max(8, innerWidth - 14), state: 6, area: 0, age: 0 };
}

export function renderTableHeader(tableInnerWidth: number): string {
  const cols = computeCols(tableInnerWidth);
  let row = ` ${pad('', COL_ICON)}  ${pad('NAME', cols.name)}  ${pad('STATE', cols.state)}`;
  if (cols.area > 0) row += `  ${pad('AREA', cols.area)}`;
  if (cols.age  > 0) row += `  ${pad('CHG',  cols.age)}`;
  return `{bold}{${COLORS.textDim}-fg}${row}{/}`;
}

export function renderEntityRow(
  entity: HassEntity,
  areaMap: Map<string, string>,
  selected: boolean,
  tableInnerWidth: number
): string {
  const cols = computeCols(tableInnerWidth);
  const icon     = domainIcon(entity.entity_id);
  const name     = truncate(friendlyName(entity), cols.name);
  const stateStr = truncate(formatState(entity), cols.state);
  const stateCol = stateColor(entity.state);
  const nameColor  = selected ? COLORS.cyan : COLORS.textPrimary;
  const iconColor  = domainColorForEntity(entity.entity_id);

  let row =
    ` {${iconColor}-fg}${pad(icon, COL_ICON)}{/}` +
    `  {${nameColor}-fg}${pad(name, cols.name)}{/}` +
    `  {${stateCol}-fg}${pad(stateStr, cols.state)}{/}`;

  if (cols.area > 0) {
    const area = truncate(areaMap.get(entity.entity_id) ?? '—', cols.area);
    row += `  {${COLORS.textSecondary}-fg}${pad(area, cols.area)}{/}`;
  }
  if (cols.age > 0) {
    row += `  {${COLORS.textDim}-fg}${pad(timeSince(entity.last_changed), cols.age)}{/}`;
  }
  return row;
}

function domainColorForEntity(entityId: string): string {
  const domain = entityId.split('.')[0];
  const domainColors: Record<string, string> = {
    light:              COLORS.yellow,
    switch:             COLORS.teal,
    sensor:             COLORS.blue,
    binary_sensor:      COLORS.purple,
    climate:            COLORS.orange,
    cover:              COLORS.cyan,
    fan:                COLORS.teal,
    media_player:       COLORS.magenta,
    automation:         COLORS.green,
    script:             COLORS.green,
    scene:              COLORS.purple,
    person:             COLORS.cyan,
    device_tracker:     COLORS.cyan,
    camera:             COLORS.yellow,
    lock:               COLORS.orange,
    vacuum:             COLORS.teal,
    alarm_control_panel:COLORS.red,
    weather:            COLORS.blue,
    button:             COLORS.teal,
    input_boolean:      COLORS.teal,
    number:             COLORS.blue,
    input_number:       COLORS.blue,
    select:             COLORS.purple,
    input_select:       COLORS.purple,
  };
  return domainColors[domain] ?? COLORS.textSecondary;
}

// ─────────────────────────────────────────────────────────────────────────────
// Detail panel render
// ─────────────────────────────────────────────────────────────────────────────

export function renderDetail(entity: HassEntity | null, panelInnerWidth = 30): string {
  if (!entity) {
    return `\n\n{center}{${COLORS.textDim}-fg}Select an entity{/}{/center}`;
  }

  const domain = entity.entity_id.split('.')[0];
  const icon = domainIcon(entity.entity_id);
  const iconColor = domainColorForEntity(entity.entity_id);
  const stateCol = stateColor(entity.state);

  // Fit label/value columns to the available panel width.
  const w      = Math.max(16, panelInnerWidth);
  const keyW   = Math.min(14, Math.max(6, Math.floor(w * 0.42)));
  const valW   = Math.max(6, w - keyW - 1);
  const hrLen  = Math.min(26, w);

  const lines: string[] = [
    `{bold}{${iconColor}-fg}${icon} ${truncate(friendlyName(entity), w - 2)}{/}`,
    `{${COLORS.border}-fg}${'─'.repeat(hrLen)}{/}`,
    `{${COLORS.textSecondary}-fg}${truncate('entity', keyW).padEnd(keyW)} {/}{${COLORS.textPrimary}-fg}${truncate(entity.entity_id, valW)}{/}`,
    `{${COLORS.textSecondary}-fg}${truncate('domain', keyW).padEnd(keyW)} {/}{${COLORS.cyan}-fg}${truncate(domain, valW)}{/}`,
    `{${COLORS.textSecondary}-fg}${truncate('state', keyW).padEnd(keyW)}  {/}{${stateCol}-fg}${truncate(formatState(entity), valW)}{/}`,
    `{${COLORS.textSecondary}-fg}${truncate('changed', keyW).padEnd(keyW)} {/}{${COLORS.textDim}-fg}${truncate(timeSince(entity.last_changed) + ' ago', valW)}{/}`,
    `{${COLORS.textSecondary}-fg}${truncate('updated', keyW).padEnd(keyW)} {/}{${COLORS.textDim}-fg}${truncate(timeSince(entity.last_updated) + ' ago', valW)}{/}`,
    '',
    `{bold}{${COLORS.textSecondary}-fg}ATTRIBUTES{/}`,
    `{${COLORS.border}-fg}${'─'.repeat(hrLen)}{/}`,
  ];

  const attrs = entity.attributes;
  const skip = new Set(['friendly_name', 'icon', 'entity_picture']);
  for (const [key, val] of Object.entries(attrs)) {
    if (skip.has(key)) continue;
    const valStr = typeof val === 'object' ? JSON.stringify(val) : String(val);
    lines.push(`{${COLORS.textSecondary}-fg}${truncate(key, keyW).padEnd(keyW)} {/}{${COLORS.textPrimary}-fg}${truncate(valStr, valW)}{/}`);
  }

  lines.push(...renderEntityControls(entity, hrLen));

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Domain-aware controls for the detail panel
// ─────────────────────────────────────────────────────────────────────────────

function renderEntityControls(entity: HassEntity, hrLen: number): string[] {
  const domain = entity.entity_id.split('.')[0];
  const lines: string[] = [];

  lines.push('');
  lines.push(`{bold}{${COLORS.textSecondary}-fg}CONTROLS{/}`);
  lines.push(`{${COLORS.border}-fg}${'─'.repeat(hrLen)}{/}`);

  const READ_ONLY = new Set([
    'sensor', 'binary_sensor', 'weather', 'sun', 'person',
    'device_tracker', 'zone', 'camera', 'update', 'calendar',
    'timer', 'counter', 'group',
  ]);

  if (READ_ONLY.has(domain)) {
    lines.push(`{${COLORS.textDim}-fg}Read-only — no controls{/}`);
    lines.push(`{${COLORS.yellow}-fg}[y]{/} {${COLORS.textSecondary}-fg}Copy entity_id{/}`);
    return lines;
  }

  switch (domain) {
    case 'light': {
      lines.push(`{${COLORS.green}-fg}[t]{/} {${COLORS.textSecondary}-fg}Toggle{/}`);
      const colorModes = entity.attributes['supported_color_modes'] as string[] | undefined;
      const brightness = entity.attributes['brightness'] as number | undefined;
      const hasBrightness =
        brightness !== undefined ||
        colorModes?.some((m) =>
          ['brightness', 'color_temp', 'hs', 'xy', 'rgb', 'rgbw', 'rgbww', 'white'].includes(m)
        );
      if (hasBrightness) {
        const pct = brightness !== undefined ? Math.round((brightness / 255) * 100) : '—';
        lines.push(`{${COLORS.yellow}-fg}[+/-]{/} {${COLORS.textSecondary}-fg}Brightness (${pct}%){/}`);
      }
      break;
    }

    case 'switch':
    case 'input_boolean':
      lines.push(`{${COLORS.green}-fg}[t]{/} {${COLORS.textSecondary}-fg}Toggle{/}`);
      break;

    case 'climate': {
      const temp = entity.attributes['temperature'] as number | undefined;
      const currentTemp = entity.attributes['current_temperature'] as number | undefined;
      const hvacModes = entity.attributes['hvac_modes'] as string[] | undefined;
      lines.push(`{${COLORS.yellow}-fg}[+/-]{/} {${COLORS.textSecondary}-fg}Set temp${temp !== undefined ? ` (now: ${temp}°)` : ''}{/}`);
      if (currentTemp !== undefined) {
        lines.push(`{${COLORS.textDim}-fg}      Current: ${currentTemp}°{/}`);
      }
      if (hvacModes && hvacModes.length > 1) {
        lines.push(`{${COLORS.cyan}-fg}[m]{/} {${COLORS.textSecondary}-fg}Mode: ${entity.state}{/}`);
        lines.push(`{${COLORS.textDim}-fg}      ${hvacModes.join(', ')}{/}`);
      }
      break;
    }

    case 'cover':
      lines.push(`{${COLORS.green}-fg}[o]{/} {${COLORS.textSecondary}-fg}Open${entity.state === 'open' ? ' ✓' : ''}{/}`);
      lines.push(`{${COLORS.red}-fg}[c]{/} {${COLORS.textSecondary}-fg}Close${entity.state === 'closed' ? ' ✓' : ''}{/}`);
      lines.push(`{${COLORS.yellow}-fg}[s]{/} {${COLORS.textSecondary}-fg}Stop{/}`);
      break;

    case 'fan': {
      lines.push(`{${COLORS.green}-fg}[t]{/} {${COLORS.textSecondary}-fg}Toggle{/}`);
      const pct = entity.attributes['percentage'] as number | undefined;
      if (pct !== undefined) {
        lines.push(`{${COLORS.yellow}-fg}[+/-]{/} {${COLORS.textSecondary}-fg}Speed (${pct}%){/}`);
      }
      break;
    }

    case 'media_player': {
      const isPlaying = entity.state === 'playing';
      lines.push(`{${COLORS.green}-fg}[t]{/} {${COLORS.textSecondary}-fg}${isPlaying ? 'Pause' : 'Play'}{/}`);
      lines.push(`{${COLORS.yellow}-fg}[+/-]{/} {${COLORS.textSecondary}-fg}Volume{/}`);
      lines.push(`{${COLORS.cyan}-fg}[[ / ]]{/} {${COLORS.textSecondary}-fg}Prev / Next track{/}`);
      break;
    }

    case 'lock':
      lines.push(`{${COLORS.green}-fg}[t]{/} {${COLORS.textSecondary}-fg}${entity.state === 'locked' ? 'Unlock' : 'Lock'}{/}`);
      break;

    case 'vacuum':
      if (entity.state === 'cleaning') {
        lines.push(`{${COLORS.yellow}-fg}[s]{/} {${COLORS.textSecondary}-fg}Stop{/}`);
      } else {
        lines.push(`{${COLORS.green}-fg}[s]{/} {${COLORS.textSecondary}-fg}Start{/}`);
      }
      lines.push(`{${COLORS.cyan}-fg}[h]{/} {${COLORS.textSecondary}-fg}Return to dock{/}`);
      break;

    case 'alarm_control_panel':
      lines.push(`{${COLORS.green}-fg}[0]{/} {${COLORS.textSecondary}-fg}Disarm${entity.state === 'disarmed' ? ' ✓' : ''}{/}`);
      lines.push(`{${COLORS.yellow}-fg}[1]{/} {${COLORS.textSecondary}-fg}Arm Away${entity.state === 'armed_away' ? ' ✓' : ''}{/}`);
      lines.push(`{${COLORS.orange}-fg}[2]{/} {${COLORS.textSecondary}-fg}Arm Home${entity.state === 'armed_home' ? ' ✓' : ''}{/}`);
      lines.push(`{${COLORS.purple}-fg}[3]{/} {${COLORS.textSecondary}-fg}Arm Night${entity.state === 'armed_night' ? ' ✓' : ''}{/}`);
      break;

    case 'scene':
    case 'script':
    case 'button':
    case 'input_button':
      lines.push(`{${COLORS.green}-fg}[t]{/} {${COLORS.textSecondary}-fg}Activate{/}`);
      break;

    case 'automation':
      lines.push(`{${COLORS.green}-fg}[t]{/} {${COLORS.textSecondary}-fg}Toggle{/}`);
      break;

    case 'number':
    case 'input_number': {
      const step = entity.attributes['step'] as number | undefined;
      const min = entity.attributes['min'] as number | undefined;
      const max = entity.attributes['max'] as number | undefined;
      lines.push(`{${COLORS.yellow}-fg}[+/-]{/} {${COLORS.textSecondary}-fg}Value: ${entity.state}${step !== undefined ? ` (step: ${step})` : ''}{/}`);
      if (min !== undefined && max !== undefined) {
        lines.push(`{${COLORS.textDim}-fg}      Range: ${min} – ${max}{/}`);
      }
      break;
    }

    case 'select':
    case 'input_select': {
      const options = entity.attributes['options'] as string[] | undefined;
      lines.push(`{${COLORS.yellow}-fg}[m]{/} {${COLORS.textSecondary}-fg}Option: ${entity.state}{/}`);
      if (options && options.length > 0) {
        const preview = options.slice(0, 4).join(', ') + (options.length > 4 ? '…' : '');
        lines.push(`{${COLORS.textDim}-fg}      ${preview}{/}`);
      }
      break;
    }

    default:
      lines.push(`{${COLORS.textDim}-fg}No controls{/}`);
      break;
  }

  lines.push(`{${COLORS.yellow}-fg}[y]{/} {${COLORS.textSecondary}-fg}Copy entity_id{/}`);
  return lines;
}

// ─────────────────────────────────────────────────────────────────────────────
// Command bar
// ─────────────────────────────────────────────────────────────────────────────

export function renderCommandBar(state: AppState, termWidth = 120): string {
  if (state.contextMode) {
    return (
      `{bold}{${COLORS.cyan}-fg}⌂ CONTEXTS{/}` +
      `  {${COLORS.textDim}-fg}↑↓/j/k navigate   ENTER switch   q/ESC cancel{/}`
    );
  }
  if (state.inputMode === 'rename') {
    return (
      `{bold}{${COLORS.magenta}-fg}Rename >{/} {${COLORS.textPrimary}-fg}${state.inputBuffer}{/}{${COLORS.magenta}-fg}█{/}` +
      `  {${COLORS.textDim}-fg}ENTER:confirm  ESC:cancel{/}`
    );
  }
  if (state.inputMode === 'area') {
    return (
      `{bold}{${COLORS.teal}-fg}Area >{/} {${COLORS.textPrimary}-fg}${state.inputBuffer}{/}{${COLORS.teal}-fg}█{/}` +
      `  {${COLORS.textDim}-fg}TAB:complete  ENTER:confirm  ESC:cancel  (empty=clear){/}`
    );
  }
  if (state.commandMode) {
    // Show ":view area" with the area portion highlighted differently
    const buf = state.commandBuffer;
    const spaceIdx = buf.indexOf(' ');
    if (spaceIdx !== -1) {
      const viewPart = buf.slice(0, spaceIdx);
      const areaPart = buf.slice(spaceIdx + 1);
      return (
        `{bold}{${COLORS.cyan}-fg}:{/}` +
        `{${COLORS.textPrimary}-fg}${viewPart}{/}` +
        ` {${COLORS.teal}-fg}${areaPart}{/}` +
        `{${COLORS.cyan}-fg}█{/}` +
        `  {${COLORS.textDim}-fg}TAB:complete  ENTER:apply  ESC:cancel{/}`
      );
    }
    return (
      `{bold}{${COLORS.cyan}-fg}:{/}{${COLORS.textPrimary}-fg}${buf}{/}{${COLORS.cyan}-fg}█{/}` +
      `  {${COLORS.textDim}-fg}TAB:complete  SPC:add area  ENTER:apply  ESC:cancel{/}`
    );
  }
  if (state.filterMode || state.filter) {
    return (
      `{${COLORS.yellow}-fg}/{/}{${COLORS.textPrimary}-fg}${state.filter}{/}{${COLORS.yellow}-fg}█{/}` +
      `  {${COLORS.textDim}-fg}TAB:complete  ESC:clear{/}`
    );
  }
  // Normal mode — hints are shown in the header; keep the bar empty.
  return '';
}

// ─────────────────────────────────────────────────────────────────────────────
// Normal-mode command bar: dynamic device hints
// ─────────────────────────────────────────────────────────────────────────────

const READ_ONLY_DOMAINS = new Set([
  'sensor', 'binary_sensor', 'weather', 'sun', 'person',
  'device_tracker', 'zone', 'camera', 'update', 'calendar',
  'timer', 'counter', 'group',
]);

function renderNormalHints(entity: HassEntity | null, _termWidth: number): string {
  const gap = '  ';
  const sep = `{${COLORS.border}-fg}│{/}`;

  // Universal trailing badges shown for every entity
  const universal = [
    badge('<d>', 'Describe'),
    badge('<n>', 'Rename'),
    badge('<a>', 'Area'),
    badge('</>', 'Filter'),
    badge('<C>', 'Context'),
    badge('<?>', 'Help'),
    badge('<q>', 'Quit'),
  ];

  if (!entity) {
    return [badge('<:>', 'Command'), ...universal].join(gap);
  }

  const domain = entity.entity_id.split('.')[0];
  const domainBadges: string[] = [];

  if (READ_ONLY_DOMAINS.has(domain)) {
    domainBadges.push(badge('<y>', 'Copy'));
  } else {
    switch (domain) {
      case 'light': {
        domainBadges.push(badge('<t>', 'Toggle'));
        const colorModes = entity.attributes['supported_color_modes'] as string[] | undefined;
        const brightness  = entity.attributes['brightness'] as number | undefined;
        const hasBrightness =
          brightness !== undefined ||
          colorModes?.some((m) =>
            ['brightness', 'color_temp', 'hs', 'xy', 'rgb', 'rgbw', 'rgbww', 'white'].includes(m)
          );
        if (hasBrightness) {
          const pct = brightness !== undefined ? `${Math.round((brightness / 255) * 100)}%` : '—%';
          domainBadges.push(badge('<+/->', `Brightness ${pct}`));
        }
        break;
      }

      case 'switch':
      case 'input_boolean':
        domainBadges.push(badge('<t>', 'Toggle'));
        break;

      case 'climate': {
        const temp = entity.attributes['temperature'] as number | undefined;
        const hvacModes = entity.attributes['hvac_modes'] as string[] | undefined;
        domainBadges.push(badge('<+/->', temp !== undefined ? `Temp (${temp}°)` : 'Temp'));
        if (hvacModes && hvacModes.length > 1) {
          domainBadges.push(badge('<m>', `Mode: ${entity.state}`));
        }
        break;
      }

      case 'cover':
        domainBadges.push(badge('<o>', 'Open'));
        domainBadges.push(badge('<c>', 'Close'));
        domainBadges.push(badge('<s>', 'Stop'));
        break;

      case 'fan': {
        domainBadges.push(badge('<t>', 'Toggle'));
        const pct = entity.attributes['percentage'] as number | undefined;
        if (pct !== undefined) {
          domainBadges.push(badge('<+/->', `Speed (${pct}%)`));
        }
        break;
      }

      case 'media_player': {
        const isPlaying = entity.state === 'playing';
        domainBadges.push(badge('<t>', isPlaying ? 'Pause' : 'Play'));
        domainBadges.push(badge('<+/->', 'Volume'));
        domainBadges.push(badge('<[/]>', 'Track'));
        break;
      }

      case 'lock':
        domainBadges.push(badge('<t>', entity.state === 'locked' ? 'Unlock' : 'Lock'));
        break;

      case 'vacuum':
        domainBadges.push(badge('<s>', entity.state === 'cleaning' ? 'Stop' : 'Start'));
        domainBadges.push(badge('<h>', 'Dock'));
        break;

      case 'alarm_control_panel':
        domainBadges.push(badge('<0>', 'Disarm'));
        domainBadges.push(badge('<1>', 'Away'));
        domainBadges.push(badge('<2>', 'Home'));
        domainBadges.push(badge('<3>', 'Night'));
        break;

      case 'scene':
      case 'script':
      case 'button':
      case 'input_button':
        domainBadges.push(badge('<t>', 'Activate'));
        break;

      case 'automation':
        domainBadges.push(badge('<t>', 'Toggle'));
        break;

      case 'number':
      case 'input_number': {
        const step = entity.attributes['step'] as number | undefined;
        domainBadges.push(badge('<+/->', step !== undefined ? `Value (step: ${step})` : 'Value'));
        break;
      }

      case 'select':
      case 'input_select':
        domainBadges.push(badge('<m>', `Option: ${entity.state}`));
        break;

      default:
        break;
    }
    domainBadges.push(badge('<y>', 'Copy'));
  }

  const allBadges = [...domainBadges, sep, ...universal];
  return ' ' + allBadges.join(gap);
}

// ─────────────────────────────────────────────────────────────────────────────
// Status bar
// ─────────────────────────────────────────────────────────────────────────────

export function renderStatusBar(state: AppState): string {
  // Always show connection errors, even before any entities load.
  if (state.error) {
    return `{${COLORS.red}-fg}⚠  ${state.error}{/}`;
  }

  const sel = state.filteredEntities[state.selectedIndex];
  if (!sel) return '';

  const domain = sel.entity_id.split('.')[0];
  const stateCol = stateColor(sel.state);

  return (
    `{${COLORS.textDim}-fg}${domain} {/}` +
    `{${COLORS.textSecondary}-fg}» {/}` +
    `{${COLORS.textPrimary}-fg}${friendlyName(sel)} {/}` +
    `{${COLORS.textDim}-fg}│ {/}` +
    `{${stateCol}-fg}${sel.state}{/}`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Context / home switcher — inline table view (k9s-style)
// ─────────────────────────────────────────────────────────────────────────────

function contextCols(innerWidth: number): { name: number; url: number } {
  const nameW = Math.min(28, Math.max(14, Math.floor(innerWidth * 0.30)));
  const urlW  = Math.max(16, innerWidth - nameW - 14);
  return { name: nameW, url: urlW };
}

export function renderContextTableHeader(tableInnerWidth: number): string {
  const cols = contextCols(tableInnerWidth);
  return (
    `{bold}{${COLORS.textDim}-fg}` +
    `   ${''.padEnd(2)}  ${pad('NAME', cols.name)}  ${pad('URL', cols.url)}  ${'STATUS'.padEnd(8)}` +
    `{/}`
  );
}

export function renderContextRow(
  home: HassConfig,
  isActive: boolean,
  isSelected: boolean,
  tableInnerWidth: number
): string {
  const cols = contextCols(tableInnerWidth);
  const hostname = (() => { try { return new URL(home.url).hostname; } catch { return home.url; } })();
  const name = home.name ?? hostname;
  const statusStr = isActive ? 'active' : '──────';

  const cursor    = isSelected ? `{${COLORS.cyan}-fg}❯{/}` : ` `;
  const dot       = isActive   ? `{${COLORS.green}-fg}●{/}` : `{${COLORS.textDim}-fg}○{/}`;
  const nameColor = isSelected ? COLORS.cyan  : COLORS.textPrimary;
  const urlColor  = isSelected ? COLORS.teal  : COLORS.textDim;
  const statColor = isActive   ? COLORS.green : COLORS.textDim;

  return (
    ` ${cursor} ${dot}` +
    `  {${nameColor}-fg}${pad(truncate(name, cols.name), cols.name)}{/}` +
    `  {${urlColor}-fg}${pad(truncate(home.url, cols.url), cols.url)}{/}` +
    `  {${statColor}-fg}${statusStr}{/}`
  );
}

export function renderContextDetail(
  home: HassConfig | null,
  isActive: boolean,
  panelInnerWidth = 30
): string {
  if (!home) {
    return `\n\n{center}{${COLORS.textDim}-fg}Select a home{/}{/center}`;
  }

  const hostname = (() => { try { return new URL(home.url).hostname; } catch { return home.url; } })();
  const name = home.name ?? hostname;
  const w    = Math.max(16, panelInnerWidth);
  const keyW = Math.min(10, Math.max(6, Math.floor(w * 0.38)));
  const valW = Math.max(6, w - keyW - 1);
  const hrLen = Math.min(26, w);

  const statusLine = isActive
    ? `{${COLORS.green}-fg}● active{/}`
    : `{${COLORS.textDim}-fg}○ inactive{/}`;

  const tokenMasked = home.token.length > 8
    ? home.token.slice(0, 4) + '…' + home.token.slice(-4)
    : '••••••••';

  return [
    `{bold}{${COLORS.cyan}-fg}⌂ ${truncate(name, w - 2)}{/}`,
    `{${COLORS.border}-fg}${'─'.repeat(hrLen)}{/}`,
    `{${COLORS.textSecondary}-fg}${'status'.padEnd(keyW)} {/}${statusLine}`,
    `{${COLORS.textSecondary}-fg}${'name'.padEnd(keyW)} {/}{${COLORS.textPrimary}-fg}${truncate(name, valW)}{/}`,
    `{${COLORS.textSecondary}-fg}${'host'.padEnd(keyW)} {/}{${COLORS.teal}-fg}${truncate(hostname, valW)}{/}`,
    `{${COLORS.textSecondary}-fg}${'url'.padEnd(keyW)} {/}{${COLORS.textDim}-fg}${truncate(home.url, valW)}{/}`,
    `{${COLORS.textSecondary}-fg}${'token'.padEnd(keyW)} {/}{${COLORS.textDim}-fg}${truncate(tokenMasked, valW)}{/}`,
    '',
    `{bold}{${COLORS.textSecondary}-fg}ACTIONS{/}`,
    `{${COLORS.border}-fg}${'─'.repeat(hrLen)}{/}`,
    `{${COLORS.green}-fg}[ENTER]{/} {${COLORS.textSecondary}-fg}Switch to this home{/}`,
    `{${COLORS.yellow}-fg}[ESC]{/}   {${COLORS.textSecondary}-fg}Cancel{/}`,
  ].join('\n');
}

export function renderContextStatusBar(home: HassConfig | null, isActive: boolean): string {
  if (!home) return '';
  const hostname = (() => { try { return new URL(home.url).hostname; } catch { return home.url; } })();
  const name = home.name ?? hostname;
  const statusColor = isActive ? COLORS.green : COLORS.textDim;
  const statusLabel = isActive ? 'active' : 'inactive';

  return (
    `{${COLORS.cyan}-fg}⌂{/} ` +
    `{${COLORS.textSecondary}-fg}context » {/}` +
    `{${COLORS.textPrimary}-fg}${name} {/}` +
    `{${COLORS.textDim}-fg}│ {/}` +
    `{${statusColor}-fg}${statusLabel}{/}`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Help content
// ─────────────────────────────────────────────────────────────────────────────

export function renderHelp(): string {
  const h = (s: string) => `{bold}{${COLORS.magenta}-fg}${s}{/}`;
  const k = (s: string) => `{bold}{${COLORS.cyan}-fg}${s}{/}`;
  const d = (s: string) => `{${COLORS.textSecondary}-fg}${s}{/}`;
  const dim = (s: string) => `{${COLORS.textDim}-fg}${s}{/}`;

  return [
    `{center}{bold}{${COLORS.magenta}-fg}  HATUI – Home Assistant TUI  {/}{/center}`,
    `{center}{${COLORS.textDim}-fg}k9s-inspired terminal UI{/}{/center}`,
    '',
    h('── NAVIGATION ──────────────────'),
    ` ${k('↑ / k')}      ${d('Move up')}`,
    ` ${k('↓ / j')}      ${d('Move down')}`,
    ` ${k('g / Home')}   ${d('Jump to top')}`,
    ` ${k('G / End')}    ${d('Jump to bottom')}`,
    ` ${k('PgUp/PgDn')}  ${d('Page up/down')}`,
    '',
    h('── VIEWS (:command) ────────────'),
    ` ${k(':all')}        ${d('All entities')}`,
    ` ${k(':lights')}     ${d('Lights')}`,
    ` ${k(':switches')}   ${d('Switches')}`,
    ` ${k(':sensors')}    ${d('Sensors')}`,
    ` ${k(':climate')}    ${d('Climate')}`,
    ` ${k(':covers')}     ${d('Covers')}`,
    ` ${k(':fans')}       ${d('Fans')}`,
    ` ${k(':media')}      ${d('Media players')}`,
    ` ${k(':automations')} ${d('Automations')}`,
    ` ${k(':locks')}      ${d('Locks')}`,
    ` ${k(':cameras')}    ${d('Cameras')}`,
    ` ${k(':vacuums')}    ${d('Vacuums')}`,
    '',
    h('── HOMES (:command) ────────────'),
    ` ${k(':homes')}      ${d('Open home switcher (also C, :home, :ctx)')}`,
    ` ${k(':homes Cabin')} ${d('Switch directly to home named "Cabin"')}`,
    '',
    h('── BULK POWER (:command) ────────'),
    ` ${k(':on')}         ${d('Turn on all in current view')}`,
    ` ${k(':off')}        ${d('Turn off all in current view')}`,
    ` ${k(':lights on')}  ${d('Turn on all lights')}`,
    ` ${k(':lights off')} ${d('Turn off all lights')}`,
    ` ${k(':switches on')} ${d('Turn on all switches')}`,
    ` ${k(':switches off')} ${d('Turn off all switches')}`,
    '',
    h('── ACTIONS ─────────────────────'),
    ` ${k('t')}          ${d('Toggle / Activate entity')}`,
    ` ${k('n')}          ${d('Rename device')}`,
    ` ${k('a')}          ${d('Assign area to device')}`,
    ` ${k('/')}          ${d('Filter entities (fuzzy)')}`,
    ` ${k('d')}          ${d('Describe / inspect entity')}`,
    ` ${k('r')}          ${d('Refresh states')}`,
    ` ${k('y')}          ${d('Copy entity_id to clipboard')}`,
    ` ${k('?')}          ${d('Toggle this help')}`,
    ` ${k('C')}          ${d('Home / context switcher  (also :homes)')}`,
    ` ${k('q / ctrl+c')} ${d('Quit')}`,
    '',
    h('── DEVICE CONTROLS ─────────────'),
    ` ${k('[+/-]')}       ${d('Light: brightness  ·  Climate: temp')}`,
    ` ${dim('          ')}  ${d('Fan: speed  ·  Media: volume  ·  Number: value')}`,
    ` ${k('[o/c/s]')}     ${d('Cover: Open / Close / Stop')}`,
    ` ${k('[s/h]')}       ${d('Vacuum: Start/Stop  /  Return to dock')}`,
    ` ${k('[m]')}         ${d('Climate: cycle HVAC mode  ·  Select: next option')}`,
    ` ${k('[[ / ]]')}     ${d('Media player: Prev / Next track')}`,
    ` ${k('[0]')}         ${d('Alarm: Disarm')}`,
    ` ${k('[1/2/3]')}     ${d('Alarm: Arm Away / Home / Night (alarm selected)')}`,
    '',
    '',
    dim('Press ? or ESC to close'),
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Entity filtering
// ─────────────────────────────────────────────────────────────────────────────

export function filterEntities(
  entities: HassEntity[],
  view: DeviceType,
  filter: string,
  areaMap: Map<string, string> = new Map(),
  areaFilter = ''
): HassEntity[] {
  let result = entities;

  if (view !== 'all') {
    const domains = DEVICE_TYPE_DOMAINS[view];
    result = result.filter((e) => domains.includes(e.entity_id.split('.')[0]));
  }

  if (filter) {
    const q = filter.toLowerCase();
    result = result.filter(
      (e) =>
        e.entity_id.toLowerCase().includes(q) ||
        friendlyName(e).toLowerCase().includes(q) ||
        e.state.toLowerCase().includes(q)
    );
  }

  if (areaFilter) {
    const a = areaFilter.toLowerCase();
    result = result.filter((e) =>
      (areaMap.get(e.entity_id) ?? '').toLowerCase().includes(a)
    );
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function pad(str: string, len: number): string {
  if (str.length >= len) return str.substring(0, len);
  return str + ' '.repeat(len - str.length);
}

function truncate(str: string, len: number): string {
  if (str.length <= len) return str;
  return str.substring(0, len - 1) + '…';
}

// ─────────────────────────────────────────────────────────────────────────────
// Autocomplete helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Compute command-mode suggestions (view shortcuts, then area/home names after a space). */
export function computeCommandSuggestions(
  buffer: string,
  areas: HassArea[] = [],
  homes: HassConfig[] = []
): string[] {
  const spaceIdx = buffer.indexOf(' ');

  if (spaceIdx !== -1) {
    const viewPart = buffer.slice(0, spaceIdx).toLowerCase();
    const queryPart = buffer.slice(spaceIdx + 1).toLowerCase();

    // :ctx / :home <name> — suggest home names.
    // Also matches partial prefixes like 'ho ', 'hom ', 'ctx' so they never fall through to area names.
    const HOME_PREFIXES = ['home', 'homes', 'ctx', 'context'];
    if (HOME_PREFIXES.some((p) => p.startsWith(viewPart) || viewPart.startsWith(p))) {
      const candidates = homes.map((h) => {
        if (h.name) return h.name;
        try { return new URL(h.url).hostname; } catch { return h.url; }
      });
      const filtered = queryPart
        ? candidates.filter((n) => n.toLowerCase().includes(queryPart))
        : candidates;
      return filtered.slice(0, 6).map((name) => `${viewPart} ${name}`);
    }

    // After a space: suggest area names scoped to what the user typed
    const candidates = areas.map((a) => a.name);
    const filtered = queryPart
      ? candidates.filter((a) => a.toLowerCase().includes(queryPart))
      : candidates;
    const sorted = filtered.sort((a, b) => {
      if (!queryPart) return a.localeCompare(b);
      const aStarts = a.toLowerCase().startsWith(queryPart) ? -1 : 1;
      const bStarts = b.toLowerCase().startsWith(queryPart) ? -1 : 1;
      return aStarts - bStarts || a.localeCompare(b);
    });
    return sorted.slice(0, 6).map((area) => `${buffer.slice(0, spaceIdx)} ${area}`);
  }

  // Before a space: suggest view shortcut names + context commands
  const CONTEXT_CMDS = new Set(['home', 'homes', 'ctx', 'context']);
  // If the buffer is already an exact context command, it's complete — no suggestions needed.
  if (CONTEXT_CMDS.has(buffer.toLowerCase())) return [];

  const candidates = Object.keys(DEVICE_TYPE_SHORTCUTS).concat(['homes', 'ctx', 'home', 'context', 'on', 'off', 'quit', 'exit']);
  if (!buffer) return candidates.slice(0, 6);
  const q = buffer.toLowerCase();
  const prefix = candidates.filter((c) => c.toLowerCase().startsWith(q));
  const contains = candidates.filter((c) => !c.toLowerCase().startsWith(q) && c.toLowerCase().includes(q));
  return [...prefix, ...contains].slice(0, 6);
}

/** Compute area suggestions for area-assignment input mode. */
export function computeAreaSuggestions(buffer: string, areas: HassArea[]): string[] {
  const candidates = areas.map((a) => a.name);
  if (!buffer) return candidates.slice(0, 8);
  const q = buffer.toLowerCase();
  const prefix = candidates.filter((a) => a.toLowerCase().startsWith(q));
  const contains = candidates.filter((a) => !a.toLowerCase().startsWith(q) && a.toLowerCase().includes(q));
  return [...prefix, ...contains].slice(0, 8);
}

/** Compute filter-mode suggestions (text-only — entity names and IDs). */
export function computeFilterSuggestions(
  query: string,
  entities: HassEntity[],
  _areaMap: Map<string, string>,
  _areas: HassArea[] = []
): string[] {
  if (!query) return [];

  // Simple text suggestions: friendly names and entity IDs
  const q = query.toLowerCase();
  const namePrefix: string[] = [];
  const nameContains: string[] = [];
  const idContains: string[] = [];
  const seen = new Set<string>();

  for (const entity of entities) {
    const name = friendlyName(entity);
    const id = entity.entity_id;
    if (seen.has(name)) continue;
    if (name.toLowerCase().startsWith(q)) {
      namePrefix.push(name);
      seen.add(name);
    } else if (name.toLowerCase().includes(q)) {
      nameContains.push(name);
      seen.add(name);
    } else if (id.toLowerCase().includes(q) && !seen.has(id)) {
      idContains.push(id);
      seen.add(id);
    }
  }
  return [...namePrefix, ...nameContains, ...idContains].slice(0, 6);
}

/** Render one autocomplete list item with the matched portion highlighted. */
export function renderAutocompleteItem(text: string, query: string): string {
  const spaceIdx = query.indexOf(' ');
  const isAreaQuery = spaceIdx !== -1;

  if (isAreaQuery) {
    // Format: "viewPart areaName" — show view part dimmed, highlight in area
    const areaQ = query.slice(spaceIdx + 1);
    const textSpaceIdx = text.indexOf(' ');
    const viewPart = textSpaceIdx !== -1 ? text.slice(0, textSpaceIdx + 1) : '';
    const areaName = textSpaceIdx !== -1 ? text.slice(textSpaceIdx + 1) : text;
    const dimPrefix = `{${COLORS.textDim}-fg}${viewPart}{/}`;
    if (!areaQ) {
      return `${dimPrefix}{${COLORS.textPrimary}-fg}${areaName}{/}`;
    }
    const idx = areaName.toLowerCase().indexOf(areaQ.toLowerCase());
    if (idx === -1) return `${dimPrefix}{${COLORS.textPrimary}-fg}${areaName}{/}`;
    const before = areaName.slice(0, idx);
    const match  = areaName.slice(idx, idx + areaQ.length);
    const after  = areaName.slice(idx + areaQ.length);
    return (
      `${dimPrefix}` +
      `{${COLORS.textSecondary}-fg}${before}{/}` +
      `{bold}{${COLORS.cyan}-fg}${match}{/}` +
      `{${COLORS.textPrimary}-fg}${after}{/}`
    );
  }

  // Plain text match — highlight within the name
  const matchQuery = query;
  const idx = text.toLowerCase().indexOf(matchQuery.toLowerCase());
  if (idx === -1) return `{${COLORS.textPrimary}-fg}${text}{/}`;
  const before = text.slice(0, idx);
  const match  = text.slice(idx, idx + matchQuery.length);
  const after  = text.slice(idx + matchQuery.length);
  return (
    `{${COLORS.textSecondary}-fg}${before}{/}` +
    `{bold}{${COLORS.cyan}-fg}${match}{/}` +
    `{${COLORS.textPrimary}-fg}${after}{/}`
  );
}
