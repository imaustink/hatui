import { HassEntity, HassArea, DeviceType, DEVICE_TYPE_DOMAINS, AppState, DEVICE_TYPE_SHORTCUTS } from './types';
import {
  COLORS,
  domainIcon,
  friendlyName,
  formatState,
  stateColor,
  timeSince,
} from './theme';

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

/** Render a k9s-style shortcut badge: highlighted key + dim label. */
function badge(key: string, label: string): string {
  return (
    `{bold}{${COLORS.bgSelected}-bg}{${COLORS.cyan}-fg}${key}{/}` +
    `{${COLORS.textSecondary}-fg} ${label}{/}`
  );
}

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

  // ── Line 1: title bar ──────────────────────────────────────────────────────
  const line1 = ` ${title}  ${sep}  ${connIcon}  ${sep}  ${countLabel}  ${sep}  ${timeLabel} `;

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
    badge('<?>', 'Help'),
    badge('<q>', 'Quit'),
  ];

  const gap = '  ';
  const line3 = ' ' + viewBadges.join(gap);
  const line4 = ' ' + actionBadges.join(gap);

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
  if (cols.age  > 0) row += `  ${pad('AGE',  cols.age)}`;
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

  lines.push('');
  lines.push(`{bold}{${COLORS.textSecondary}-fg}ACTIONS{/}`);
  lines.push(`{${COLORS.border}-fg}${'─'.repeat(26)}{/}`);

  const toggleable = ['light', 'switch', 'fan', 'cover', 'media_player', 'lock', 'automation', 'input_boolean'];
  if (toggleable.includes(domain)) {
    lines.push(`{${COLORS.green}-fg}[t]{/} Toggle`);
  }
  lines.push(`{${COLORS.cyan}-fg}[?]{/} Help`);

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Command bar
// ─────────────────────────────────────────────────────────────────────────────

export function renderCommandBar(state: AppState, termWidth = 120): string {
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
  // Normal mode — hints live in the header; keep the bar empty.
  return '';
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
    h('── BULK POWER (:command) ────────'),
    ` ${k(':on')}         ${d('Turn on all in current view')}`,
    ` ${k(':off')}        ${d('Turn off all in current view')}`,
    ` ${k(':lights on')}  ${d('Turn on all lights')}`,
    ` ${k(':lights off')} ${d('Turn off all lights')}`,
    ` ${k(':switches on')} ${d('Turn on all switches')}`,
    ` ${k(':switches off')} ${d('Turn off all switches')}`,
    '',
    h('── ACTIONS ─────────────────────'),
    ` ${k('t')}          ${d('Toggle entity')}`,
    ` ${k('n')}          ${d('Rename device')}`,
    ` ${k('a')}          ${d('Assign area to device')}`,
    ` ${k('/')}          ${d('Filter entities (fuzzy)')}`,
    ` ${k('d')}          ${d('Describe / inspect entity')}`,
    ` ${k('r')}          ${d('Refresh states')}`,
    ` ${k('?')}          ${d('Toggle this help')}`,

    ` ${k('q / ctrl+c')} ${d('Quit')}`,
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

/** Compute command-mode suggestions (view shortcuts, then area names after a space). */
export function computeCommandSuggestions(buffer: string, areas: HassArea[] = []): string[] {
  const spaceIdx = buffer.indexOf(' ');

  if (spaceIdx !== -1) {
    // After a space: suggest area names scoped to what the user typed
    const areaQ = buffer.slice(spaceIdx + 1).toLowerCase();
    const viewPart = buffer.slice(0, spaceIdx);
    const candidates = areas.map((a) => a.name);
    const filtered = areaQ
      ? candidates.filter((a) => a.toLowerCase().includes(areaQ))
      : candidates;
    const sorted = filtered.sort((a, b) => {
      if (!areaQ) return a.localeCompare(b);
      const aStarts = a.toLowerCase().startsWith(areaQ) ? -1 : 1;
      const bStarts = b.toLowerCase().startsWith(areaQ) ? -1 : 1;
      return aStarts - bStarts || a.localeCompare(b);
    });
    return sorted.slice(0, 6).map((area) => `${viewPart} ${area}`);
  }

  // Before a space: suggest view shortcut names
  const candidates = Object.keys(DEVICE_TYPE_SHORTCUTS).concat(['on', 'off', 'quit', 'exit']);
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
