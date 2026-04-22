# HOM3 – Copilot Instructions

## Project Overview

**HOM3** is a k9s-inspired terminal UI (TUI) for Home Assistant, written in TypeScript and running on Node.js. It is typically deployed on a Raspberry Pi as a always-on dashboard. The UI is rendered entirely in the terminal using the **blessed** library.

---

## Tech Stack

| Layer | Library | Notes |
|---|---|---|
| TUI rendering | `blessed` ^0.1.81 | Box/list widgets, tags-based color markup |
| HA connection | Raw WebSocket (`ws`) | Custom protocol over HA WebSocket API |
| Config loading | `dotenv` | `.env` file or `~/.config/hom3/config.json` |
| HTTP (unused currently) | `axios` | Available as a dependency |
| Language | TypeScript (strict) | Target ES2020, CommonJS output |
| Runtime | Node.js | Entry: `dist/index.js` |

---

## File Map & Responsibilities

```
src/
├── index.ts        Entry point. Loads config (CLI flags → env → .env → JSON file).
│                   Creates HassClient + App, calls app.start().
├── app.ts          App class. Owns AppState, all blessed widgets, key bindings,
│                   and the render loop. Orchestrates client events → state → render.
├── hass-client.ts  HassClient (EventEmitter). Manages the WebSocket connection,
│                   auth handshake, bootstrap (states/areas/devices), state-change
│                   subscriptions, and service calls.
├── renderer.ts     Pure functions that produce blessed tag strings for every
│                   on-screen region (header, table rows, detail panel, command bar,
│                   status bar, help overlay). No side effects.
├── widgets.ts      Factory functions that create and configure blessed widgets
│                   (screen, list, boxes, overlays). Called once in App constructor.
├── theme.ts        COLORS palette (cyberpunk/synthwave), DOMAIN_ICONS map,
│                   and pure formatters: stateColor(), domainIcon(),
│                   friendlyName(), formatState(), timeSince().
└── types.ts        All TypeScript types and constants:
                    HassConfig, HassEntity, HassArea, HassDevice,
                    HassStateChange, AppState, DeviceType,
                    DEVICE_TYPE_DOMAINS, DEVICE_TYPE_SHORTCUTS.
```

---

## Architecture Patterns

### Single Source of Truth — `AppState`
All UI state lives in `App.state: AppState`. Render functions read from it; they never mutate it. Only `App` methods mutate `state`, then call `renderAll()` or the targeted partial-render helpers.

### Renderer functions are pure
`renderer.ts` exports pure functions that accept state/data and return blessed tag strings. They have **no side effects** and do not import from `app.ts` or `widgets.ts`.

### Blessed tag markup
Blessed uses `{color-fg}…{/}` and `{bold}…{/}` inline tags. Always use the hex constants from `COLORS` rather than colour names. Example:
```typescript
`{${COLORS.cyan}-fg}Hello{/} {bold}World{/}`
```

### Responsive column widths
`renderer.ts` has a `computeCols(innerWidth)` helper that returns column widths based on terminal width. The functions `renderTableHeader` and `renderEntityRow` accept a `tableInnerWidth: number` parameter. In `App.renderTableView()`, compute the inner width before calling them:
```typescript
const tableInnerWidth = Math.floor((this.screen.width as number) * 0.70) - 4;
```
> **Known issue**: `app.ts` currently calls `renderTableHeader()` and `renderEntityRow()` without the width argument. This will be a TypeScript error in strict mode. Pass the computed `tableInnerWidth` to fix it.

### Widget layout (fixed positions)
| Widget | Position | Size |
|---|---|---|
| `header` | top 0 | height 3, full width |
| `table` | top 3, left 0 | width 70%, bottom 5 |
| `detail` | top 3, right 0 | width 30%, bottom 5 |
| `statusBar` | bottom 2 | height 1, full width |
| `commandBar` | bottom 0 | height 3, full width |
| `helpOverlay` | center | 64×36, hidden by default |
| `toast` | bottom 6, right 2 | 40×3, hidden by default |

---

## Data Flow

```
HassClient (WebSocket)
    │
    │  bootstrap()         → loads all states, areas, devices into client.entities / .areas / .devices
    │  'state_changed'     → emits event with HassStateChange
    ▼
App.bindClientEvents()
    │
    │  on 'state_changed'  → mutates state.entities[], calls applyFilter()
    │  on 'disconnected'   → sets state.connected = false, renderAll()
    ▼
App.applyFilter()          → runs filterEntities() → updates state.filteredEntities, renderAll()
    ▼
renderer.ts (pure)         → returns blessed tag strings
    ▼
blessed widgets            → .setContent() / .setItems()  → screen.render()
```

---

## How to Add a New Entity Domain / View

1. Add the new `DeviceType` string literal to the `DeviceType` union in `types.ts`.
2. Add an entry to `DEVICE_TYPE_DOMAINS` mapping the new type to its HA domain(s).
3. Add one or more shortcut entries to `DEVICE_TYPE_SHORTCUTS`.
4. Add an icon to `DOMAIN_ICONS` in `theme.ts`.
5. Add a colour mapping for the domain in `domainColorForEntity()` in `renderer.ts`.
6. Update `renderHelp()` in `renderer.ts` to list the new `:command`.
7. Update the README keybindings table.

---

## How to Add a New Key Binding

All key handling is in `App.bindKeys()` in `app.ts`.

- **Global keys** (active regardless of mode): use `screen.key([…], cb)`.
- **Normal-mode keys**: add a `case` to the `switch(key.name ?? _ch)` block inside the `screen.on('keypress')` handler. Guard against command-mode and filter-mode at the top of the handler.
- After any action that changes `state`, call the appropriate render method(s) and `screen.render()`.

---

## How to Add a New Service Call

Add a method to `HassClient` in `hass-client.ts` using the `request()` helper:
```typescript
async callMyService(entityId: string): Promise<void> {
  await this.request({
    type: 'call_service',
    domain: 'my_domain',
    service: 'my_service',
    service_data: { entity_id: entityId },
  });
}
```
Then call it from `App` and show a toast for feedback via `this.showToast(…)`.

---

## How to Add a New Rendered Field to the Detail Panel

Edit `renderDetail()` in `renderer.ts`. Add lines to the `lines` array using `keyW`/`valW` column widths and COLORS constants. No changes needed elsewhere.

---

## Configuration Loading (precedence order)

1. CLI flags: `--url <url> --token <token>`
2. Environment variables: `HASS_URL` / `HA_URL`, `HASS_TOKEN` / `HA_TOKEN`
3. `.env` file in the working directory
4. `~/.config/hom3/config.json` → `{ "url": "…", "token": "…" }`

---

## Development Commands

```bash
npm run dev      # ts-node src/index.ts  (requires HASS_URL + HASS_TOKEN)
npm run build    # tsc  → dist/
npm start        # node dist/index.js
```

---

## Conventions & Rules

- **TypeScript strict mode** is enabled. All code must type-check cleanly with no `any` unless explicitly unavoidable.
- **No `console.log`** in TUI mode — it corrupts blessed output. Use `showToast()` for user feedback or write to a log file.
- **Renderer functions** must remain pure (no I/O, no mutations, no imports from `app.ts`).
- **Color values** always come from `COLORS` in `theme.ts`, never hardcoded hex strings.
- **Widget factories** belong in `widgets.ts`. Never call `blessed.*()` directly inside `app.ts`.
- **Types and constants** (domain lists, shortcuts, interfaces) belong in `types.ts`.
- **Formatters** (state display, time, name resolution) belong in `theme.ts`.
- Follow existing section separator comment style: `// ─────…─ Section name`.

---

## Known Issues / TODOs

- `renderTableHeader()` and `renderEntityRow()` in `renderer.ts` require a `tableInnerWidth: number` argument, but `app.ts` calls them without it — causing a TypeScript compile error. Fix by computing the inner width in `App.renderTableView()`.
- Area mapping is best-effort only (uses `attributes.area_id`). Full accuracy requires fetching the entity registry (`config/entity_registry/list`) to map entity → device → area.
- `d` (describe) and `y` (copy entity_id) keys are listed in `renderHelp()` and `renderCommandBar()` but their `case` handlers are not yet implemented in `App.bindKeys()`.
- `l` (logs) key is listed in `renderCommandBar()` but not yet implemented.
- No reconnect / backoff logic when the WebSocket disconnects.
