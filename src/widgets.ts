import blessed from 'blessed';
import { COLORS } from './theme';

// ─────────────────────────────────────────────────────────────────────────────
// Shared style factories
// ─────────────────────────────────────────────────────────────────────────────

export function panelStyle(focused = false): blessed.Widgets.BoxOptions['style'] {
  return {
    bg: COLORS.bgPanel,
    fg: COLORS.textPrimary,
    border: { fg: focused ? COLORS.borderActive : COLORS.border },
    scrollbar: { bg: COLORS.cyan, fg: COLORS.bgPanel },
  };
}

export function headerStyle(): blessed.Widgets.BoxOptions['style'] {
  return {
    bg: COLORS.bgHeader,
    fg: COLORS.textHeader,
    bold: true,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Screen
// ─────────────────────────────────────────────────────────────────────────────

export function createScreen(): blessed.Widgets.Screen {
  return blessed.screen({
    smartCSR: true,
    fullUnicode: true,
    title: 'HATUI – Home Assistant TUI',
    dockBorders: true,
    forceUnicode: true,
    cursor: {
      artificial: true,
      shape: 'line',
      blink: true,
      color: COLORS.cyan,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Header bar
// ─────────────────────────────────────────────────────────────────────────────

export function createHeader(screen: blessed.Widgets.Screen): blessed.Widgets.BoxElement {
  const box = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: '100%',
    height: 4,
    tags: true,
    style: {
      bg: COLORS.bgHeader,
      fg: COLORS.textHeader,
    },
  });
  return box;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main table / list
// ─────────────────────────────────────────────────────────────────────────────

export function createTable(screen: blessed.Widgets.Screen): blessed.Widgets.ListElement {
  const list = blessed.list({
    parent: screen,
    top: 4,
    left: 0,
    width: '70%',
    bottom: 2,
    keys: true,
    mouse: true,
    scrollable: true,
    scrollbar: {
      ch: '│',
      track: { ch: ' ' },
      style: { fg: COLORS.cyan, bg: COLORS.bgPanel },
    },
    tags: true,
    border: { type: 'line' },
    style: {
      bg: COLORS.bgPanel,
      fg: COLORS.textPrimary,
      border: { fg: COLORS.border },
      selected: { bg: COLORS.bgSelected, fg: COLORS.cyan, bold: true },
      scrollbar: { bg: COLORS.cyan },
    },
    padding: { left: 1, right: 1 },
  } as blessed.Widgets.ListOptions<blessed.Widgets.ListElementStyle>);
  return list;
}

// ─────────────────────────────────────────────────────────────────────────────
// Detail panel
// ─────────────────────────────────────────────────────────────────────────────

export function createDetailPanel(screen: blessed.Widgets.Screen): blessed.Widgets.BoxElement {
  return blessed.box({
    parent: screen,
    top: 4,
    right: 0,
    width: '30%',
    bottom: 2,
    tags: true,
    scrollable: true,
    alwaysScroll: true,
    keys: true,
    mouse: true,
    border: { type: 'line' },
    scrollbar: {
      ch: '│',
      style: { fg: COLORS.magenta },
    },
    style: {
      bg: COLORS.bgPanel,
      fg: COLORS.textPrimary,
      border: { fg: COLORS.border },
    },
    padding: { left: 1, right: 1, top: 0, bottom: 0 },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Command / filter bar
// ─────────────────────────────────────────────────────────────────────────────

export function createStatusBar(screen: blessed.Widgets.Screen): blessed.Widgets.BoxElement {
  return blessed.box({
    parent: screen,
    bottom: 1,
    left: 0,
    width: '100%',
    height: 1,
    tags: true,
    style: {
      bg: COLORS.bgAlt,
      fg: COLORS.textSecondary,
    },
    padding: { left: 1, right: 1 },
  });
}

export function createCommandBar(screen: blessed.Widgets.Screen): blessed.Widgets.BoxElement {
  return blessed.box({
    parent: screen,
    bottom: 0,
    left: 0,
    width: '100%',
    height: 1,
    tags: true,
    style: {
      bg: COLORS.bgPanel,
      fg: COLORS.cyan,
    },
    padding: { left: 1, right: 1 },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Help overlay
// ─────────────────────────────────────────────────────────────────────────────

export function createHelpOverlay(screen: blessed.Widgets.Screen): blessed.Widgets.BoxElement {
  const overlay = blessed.box({
    parent: screen,
    top: 'center',
    left: 'center',
    width: Math.min(64, (screen.width as number) - 4),
    height: Math.min(36, (screen.height as number) - 4),
    tags: true,
    scrollable: true,
    keys: true,
    mouse: true,
    border: { type: 'line' },
    hidden: true,
    style: {
      bg: COLORS.bgPanel,
      fg: COLORS.textPrimary,
      border: { fg: COLORS.magenta },
    },
    padding: { left: 2, right: 2, top: 1, bottom: 1 },
  });
  return overlay;
}

// ─────────────────────────────────────────────────────────────────────────────
// Notification toast
// ─────────────────────────────────────────────────────────────────────────────

export function createToast(screen: blessed.Widgets.Screen): blessed.Widgets.BoxElement {
  return blessed.box({
    parent: screen,
    bottom: 6,
    right: 2,
    width: 40,
    height: 3,
    tags: true,
    hidden: true,
    border: { type: 'line' },
    style: {
      bg: COLORS.bgPanel,
      fg: COLORS.green,
      border: { fg: COLORS.green },
    },
    padding: { left: 1, right: 1 },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Autocomplete popup
// ─────────────────────────────────────────────────────────────────────────────

export function createAutocompleteBox(screen: blessed.Widgets.Screen): blessed.Widgets.ListElement {
  return blessed.list({
    parent: screen,
    bottom: 3,
    left: 2,
    width: 52,
    height: 8,
    hidden: true,
    tags: true,
    border: { type: 'line' },
    style: {
      bg: COLORS.bgPanel,
      fg: COLORS.textPrimary,
      border: { fg: COLORS.cyan },
      selected: { bg: COLORS.bgSelected, fg: COLORS.cyan, bold: true },
      item: { fg: COLORS.textPrimary },
    },
    padding: { left: 1, right: 1 },
  } as blessed.Widgets.ListOptions<blessed.Widgets.ListElementStyle>);
}
