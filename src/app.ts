import blessed from 'blessed';
import { HassClient } from './hass-client';
import {
  AppState,
  DeviceType,
  DEVICE_TYPE_DOMAINS,
  DEVICE_TYPE_SHORTCUTS,
  HassEntity,
} from './types';
import {
  createScreen,
  createHeader,
  createTable,
  createDetailPanel,
  createCommandBar,
  createStatusBar,
  createHelpOverlay,
  createToast,
  createAutocompleteBox,
} from './widgets';
import {
  renderHeader,
  renderCommandBar,
  renderDetail,
  renderEntityRow,
  renderTableHeader,
  renderStatusBar,
  renderHelp,
  filterEntities,
  computeCommandSuggestions,
  computeFilterSuggestions,
  computeAreaSuggestions,
  renderAutocompleteItem,
} from './renderer';
import { COLORS } from './theme';

export class App {
  private screen: blessed.Widgets.Screen;
  private header: blessed.Widgets.BoxElement;
  private table: blessed.Widgets.ListElement;
  private detail: blessed.Widgets.BoxElement;
  private commandBar: blessed.Widgets.BoxElement;
  private statusBar: blessed.Widgets.BoxElement;
  private helpOverlay: blessed.Widgets.BoxElement;
  private toast: blessed.Widgets.BoxElement;
  private autocompleteBox: blessed.Widgets.ListElement;

  private state: AppState;
  private areaMap: Map<string, string> = new Map(); // entity_id → area name
  private registryMap: Map<string, import('./types').HassEntityRegistryEntry> = new Map();
  private refreshTimer: NodeJS.Timeout | null = null;
  private headerTimer: NodeJS.Timeout | null = null;

  constructor(private client: HassClient) {
    this.state = {
      currentView: 'all',
      filter: '',
      filterMode: false,
      areaFilter: '',
      selectedIndex: 0,
      entities: [],
      filteredEntities: [],
      connected: false,
      commandMode: false,
      commandBuffer: '',
      describeMode: false,
      describeEntity: null,
      detailVisible: false,
      helpMode: false,
      areas: [],
      devices: [],
      sortField: 'friendly_name',
      sortAsc: true,
      error: null,
      lastRefresh: null,
      autocompleteSuggestions: [],
      autocompleteIndex: 0,
      inputMode: null,
      inputBuffer: '',
      recentAreas: [],
    };

    this.screen = createScreen();
    this.header = createHeader(this.screen);
    this.table = createTable(this.screen);
    this.detail = createDetailPanel(this.screen);
    this.commandBar = createCommandBar(this.screen);
    this.statusBar = createStatusBar(this.screen);
    this.helpOverlay = createHelpOverlay(this.screen);
    this.toast = createToast(this.screen);
    this.autocompleteBox = createAutocompleteBox(this.screen);

    this.bindKeys();
    this.bindClientEvents();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Startup
  // ─────────────────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    this.renderSplash();
    this.screen.render();

    try {
      await this.client.connect();
    } catch (err) {
      this.state.error = `Connection failed: ${(err as Error).message}`;
      this.renderAll();
      return;
    }

    this.state.connected = true;
    this.state.areas = this.client.areas;
    this.state.devices = this.client.devices;
    this.buildAreaMap();
    this.refreshEntities();

    // Refresh header clock every second
    this.headerTimer = setInterval(() => {
      this.renderHeaderBar();
      this.screen.render();
    }, 1000);
  }

  private renderSplash(): void {
    this.header.setContent(
      `{center}{bold}{${COLORS.cyan}-fg} HATUI{/} {${COLORS.magenta}-fg}─ Home Assistant TUI{/} {${COLORS.textDim}-fg}Connecting…{/}{/center}`
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Area map: entity_id → area name
  // ─────────────────────────────────────────────────────────────────────────

  private buildAreaMap(): void {
    const areaById = new Map(this.client.areas.map((a) => [a.area_id, a.name]));

    // device_id → area_id from device registry
    const deviceAreaMap = new Map(
      this.client.devices
        .filter((d) => d.area_id)
        .map((d) => [d.id, d.area_id as string])
    );

    // entity registry provides direct area_id and device_id per entity
    for (const entry of this.client.entityRegistry) {
      // Direct area assignment on the entity takes precedence
      if (entry.area_id && areaById.has(entry.area_id)) {
        this.areaMap.set(entry.entity_id, areaById.get(entry.area_id)!);
        continue;
      }
      // Fall back to the device's area
      if (entry.device_id) {
        const deviceAreaId = deviceAreaMap.get(entry.device_id);
        if (deviceAreaId && areaById.has(deviceAreaId)) {
          this.areaMap.set(entry.entity_id, areaById.get(deviceAreaId)!);
        }
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // State refresh
  // ─────────────────────────────────────────────────────────────────────────

  private refreshEntities(): void {
    this.registryMap = new Map(
      this.client.entityRegistry.map((e) => [e.entity_id, e])
    );

    this.state.entities = this.client.getEntityList()
      .filter((entity) => {
        const reg = this.registryMap.get(entity.entity_id);
        if (!reg) return true; // not in registry → include
        if (reg.hidden_by !== null) return false; // hidden by default → exclude
        if (reg.device_id === null) return false; // non-device entity → exclude
        return true;
      })
      .sort((a, b) => {
        const nameA = (a.attributes['friendly_name'] as string) ?? a.entity_id;
        const nameB = (b.attributes['friendly_name'] as string) ?? b.entity_id;
        return nameA.localeCompare(nameB);
      });
    this.state.lastRefresh = new Date();
    this.applyFilter();
  }

  private applyFilter(): void {
    const prev = this.state.filteredEntities[this.state.selectedIndex]?.entity_id;
    const filtered = filterEntities(
      this.state.entities,
      this.state.currentView,
      this.state.filter,
      this.areaMap,
      this.state.areaFilter
    );

    // Sort by area name (no-area entities last), then alphabetically within each area.
    this.state.filteredEntities = [...filtered].sort((a, b) => {
      const areaA = this.areaMap.get(a.entity_id) ?? '\uffff';
      const areaB = this.areaMap.get(b.entity_id) ?? '\uffff';
      const areaCmp = areaA.localeCompare(areaB);
      if (areaCmp !== 0) return areaCmp;
      const nameA = (a.attributes['friendly_name'] as string) ?? a.entity_id;
      const nameB = (b.attributes['friendly_name'] as string) ?? b.entity_id;
      return nameA.localeCompare(nameB);
    });

    // Restore selection
    if (prev) {
      const idx = this.state.filteredEntities.findIndex((e) => e.entity_id === prev);
      this.state.selectedIndex = idx >= 0 ? idx : 0;
    } else {
      this.state.selectedIndex = 0;
    }

    this.renderAll();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Rendering
  // ─────────────────────────────────────────────────────────────────────────

  private renderAll(): void {
    this.renderHeaderBar();
    this.renderTableView();
    this.renderDetailView();
    this.renderCommandBarView();
    this.renderStatusBarView();
    this.screen.render();
  }

  private renderHeaderBar(): void {
    this.state.connected = this.client.connected;
    const w = (this.screen.width as number) ?? 120;
    this.header.setContent(renderHeader(this.state, w));
  }

  private renderTableView(): void {
    const screenWidth = (this.screen.width as number) ?? 120;
    const detailVisible = this.state.detailVisible;
    this.table.width = detailVisible ? '70%' : '100%';
    const tableInnerWidth = detailVisible
      ? Math.floor(screenWidth * 0.7) - 4
      : screenWidth - 4;

    // k9s-style label: view(area) e.g. "lights(kitchen)"
    const viewLabel = this.state.areaFilter
      ? `${this.state.currentView}(${this.state.areaFilter})`
      : this.state.currentView;
    this.table.setLabel(` {bold}{${COLORS.cyan}-fg}${viewLabel}{/} `);
    const items: string[] = [renderTableHeader(tableInnerWidth)];

    let selectedDisplayIdx = 1;

    for (let i = 0; i < this.state.filteredEntities.length; i++) {
      const entity = this.state.filteredEntities[i];

      if (i === this.state.selectedIndex) {
        selectedDisplayIdx = items.length;
      }

      const selected = i === this.state.selectedIndex;
      items.push(renderEntityRow(entity, this.areaMap, selected, tableInnerWidth));
    }

    if (this.state.filteredEntities.length === 0) {
      items.push('');
      items.push(`{center}{${COLORS.textDim}-fg}No entities found{/}{/center}`);
    }

    this.table.setItems(items as unknown as string[]);
    const targetIdx = Math.min(selectedDisplayIdx, items.length - 1);
    this.table.select(targetIdx);
  }

  private renderDetailView(): void {
    if (!this.state.detailVisible) {
      this.detail.hide();
      return;
    }
    this.detail.show();
    const screenWidth = (this.screen.width as number) ?? 120;
    const panelInnerWidth = Math.floor(screenWidth * 0.3) - 4;
    const sel = this.state.filteredEntities[this.state.selectedIndex] ?? null;
    this.detail.setContent(renderDetail(sel, panelInnerWidth));
    this.detail.setLabel(
      ` {bold}{${COLORS.purple}-fg}  DESCRIBE{/} `
    );
  }

  private renderCommandBarView(): void {
    const screenWidth = (this.screen.width as number) ?? 120;
    this.commandBar.setContent(renderCommandBar(this.state, screenWidth));
  }

  private renderStatusBarView(): void {
    this.statusBar.setContent(renderStatusBar(this.state));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Toast notification
  // ─────────────────────────────────────────────────────────────────────────

  private showToast(msg: string, isError = false): void {
    const color = isError ? COLORS.red : COLORS.green;
    this.toast.style.border = { fg: color };
    this.toast.style.fg = color;
    this.toast.setContent(`{center}${msg}{/center}`);
    this.toast.show();
    this.screen.render();
    setTimeout(() => {
      this.toast.hide();
      this.screen.render();
    }, 2500);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Command execution
  // ─────────────────────────────────────────────────────────────────────────

  private executeCommand(cmd: string): void {
    const trimmed = cmd.trim();

    if (!trimmed) return;

    const lower = trimmed.toLowerCase();
    if (lower === 'q' || lower === 'quit' || lower === 'exit') {
      this.quit();
      return;
    }

    // Standalone :on / :off — act on current filtered view
    if (lower === 'on' || lower === 'off') {
      this.executeBulkPower(lower as 'on' | 'off', this.state.filteredEntities);
      return;
    }

    // Parse "view area" (or "view on/off") — e.g., ":lights Kitchen" or ":lights on"
    const spaceIdx = trimmed.indexOf(' ');
    const viewToken = (spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)).toLowerCase();
    const areaToken = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1).trim();
    const areaLower = areaToken.toLowerCase();

    const view = DEVICE_TYPE_SHORTCUTS[viewToken] as DeviceType | undefined;

    // :lights on / :switches off — bulk power within a specific device type
    if (view && (areaLower === 'on' || areaLower === 'off')) {
      const domains = DEVICE_TYPE_DOMAINS[view];
      const targets = this.state.entities.filter((e) =>
        domains.includes(e.entity_id.split('.')[0])
      );
      this.executeBulkPower(areaLower as 'on' | 'off', targets);
      return;
    }

    if (view) {
      this.state.currentView = view;
      this.state.areaFilter = areaToken;
      if (areaToken) this.addRecentArea(areaToken);
      this.state.filter = '';
      this.state.selectedIndex = 0;
      this.applyFilter();
      const label = areaToken ? `${view} · ${areaToken}` : view;
      this.showToast(`View: ${label}`);
      return;
    }

    // If it's not a known view shortcut, treat the whole string as an area filter
    // so that typing just ":Kitchen" scopes all entities to that area.
    const areaExists = this.state.areas.some(
      (a) => a.name.toLowerCase() === lower
    );
    if (areaExists) {
      this.state.currentView = 'all';
      this.state.areaFilter = trimmed;
      this.addRecentArea(trimmed);
      this.state.filter = '';
      this.state.selectedIndex = 0;
      this.applyFilter();
      this.showToast(`Area: ${trimmed}`);
      return;
    }

    this.state.error = `Unknown command: ${trimmed}`;
    this.renderAll();
    setTimeout(() => {
      this.state.error = null;
      this.renderAll();
    }, 3000);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Bulk power (all on / all off)
  // ─────────────────────────────────────────────────────────────────────────

  private executeBulkPower(action: 'on' | 'off', entities: HassEntity[]): void {
    const BULK_DOMAINS = ['light', 'switch', 'fan', 'cover', 'input_boolean'];
    const targets = entities
      .map((e) => e.entity_id)
      .filter((id) => BULK_DOMAINS.includes(id.split('.')[0]));

    if (targets.length === 0) {
      this.showToast('No controllable entities in current view', true);
      return;
    }

    this.client.bulkPower(targets, action).then(() => {
      this.showToast(`Turned ${action}: ${targets.length} entit${targets.length === 1 ? 'y' : 'ies'}`);
    }).catch((e: Error) => {
      this.showToast(`Error: ${e.message}`, true);
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Key bindings
  // ─────────────────────────────────────────────────────────────────────────

  private bindKeys(): void {
    const screen = this.screen;

    // Global quit
    screen.key(['C-c'], () => this.quit());

    screen.on('keypress', (_ch: string, key: blessed.Widgets.Events.IKeyEventArg) => {
      if (this.state.helpMode) {
        this.state.helpMode = false;
        this.helpOverlay.hide();
        this.renderAll();
        return;
      }
      // ── Rename / Area input mode ──────────────────────────────────────────────
      if (this.state.inputMode) {
        if (key.name === 'tab' && this.state.inputMode === 'area') {
          this.acceptAutocomplete();
          return;
        } else if (key.name === 'up' && this.state.inputMode === 'area') {
          this.navigateAutocomplete(-1);
          return;
        } else if (key.name === 'down' && this.state.inputMode === 'area') {
          this.navigateAutocomplete(1);
          return;
        } else if (key.name === 'escape') {
          this.state.inputMode = null;
          this.state.inputBuffer = '';
          this.hideAutocomplete();
          this.renderCommandBarView();
          screen.render();
          return;
        } else if (key.name === 'backspace') {
          this.state.inputBuffer = this.state.inputBuffer.slice(0, -1);
          if (this.state.inputMode === 'area') this.updateAutocomplete();
          this.renderCommandBarView();
          screen.render();
          return;
        } else if (key.name === 'enter') {
          void this.commitInput();
          return;
        } else if (_ch && !key.ctrl && !key.meta && key.name !== 'escape') {
          this.state.inputBuffer += _ch;
          if (this.state.inputMode === 'area') this.updateAutocomplete();
          this.renderCommandBarView();
          screen.render();
          return;
        }
        return;
      }
      // ── Command mode ────────────────────────────────────────────────────
      if (this.state.commandMode) {
        if (key.name === 'tab') {
          this.acceptAutocomplete();
          return;
        } else if (key.name === 'up') {
          this.navigateAutocomplete(-1);
          return;
        } else if (key.name === 'down') {
          this.navigateAutocomplete(1);
          return;
        } else if (key.name === 'enter') {
          const cmd = this.state.commandBuffer;
          this.state.commandMode = false;
          this.state.commandBuffer = '';
          this.hideAutocomplete();
          this.renderCommandBarView();
          screen.render();
          this.executeCommand(cmd);
        } else if (key.name === 'escape') {
          this.state.commandMode = false;
          this.state.commandBuffer = '';
          this.hideAutocomplete();
          this.renderCommandBarView();
          screen.render();
        } else if (key.name === 'backspace') {
          this.state.commandBuffer = this.state.commandBuffer.slice(0, -1);
          this.updateAutocomplete();
          this.renderCommandBarView();
          screen.render();
        } else if (_ch && !key.ctrl && !key.meta && key.name !== 'escape') {
          this.state.commandBuffer += _ch;
          this.updateAutocomplete();
          this.renderCommandBarView();
          screen.render();
        }
        return;
      }

      // ── Filter mode (/) ─────────────────────────────────────────────────
      if (this.state.filterMode) {
        if (key.name === 'tab') {
          this.acceptAutocomplete();
          return;
        } else if (key.name === 'up') {
          this.navigateAutocomplete(-1);
          return;
        } else if (key.name === 'down') {
          this.navigateAutocomplete(1);
          return;
        } else if (key.name === 'escape') {
          this.state.filter = '';
          this.state.filterMode = false;
          this.hideAutocomplete();
          this.applyFilter();
          return;
        } else if (key.name === 'backspace') {
          this.state.filter = this.state.filter.slice(0, -1);
          this.updateAutocomplete();
          this.applyFilter();
          return;
        } else if (key.name === 'enter') {
          this.state.filterMode = false;
          this.hideAutocomplete();
          this.renderCommandBarView();
          screen.render();
          return;
        } else if (_ch && !key.ctrl && !key.meta) {
          this.state.filter += _ch;
          this.updateAutocomplete();
          this.applyFilter();
          return;
        }
        return;
      }

      const { filteredEntities, selectedIndex } = this.state;
      const count = filteredEntities.length;

      switch (key.name ?? _ch) {
        // ── Navigation ──
        case 'up':
        case 'k':
          this.state.selectedIndex = Math.max(0, selectedIndex - 1);
          this.renderTableView();
          this.renderDetailView();
          this.renderStatusBarView();
          screen.render();
          break;

        case 'down':
        case 'j':
          this.state.selectedIndex = Math.min(count - 1, selectedIndex + 1);
          this.renderTableView();
          this.renderDetailView();
          this.renderStatusBarView();
          screen.render();
          break;

        case 'g':
        case 'home':
          this.state.selectedIndex = 0;
          this.renderTableView();
          this.renderDetailView();
          this.renderStatusBarView();
          screen.render();
          break;

        case 'G':
        case 'end':
          this.state.selectedIndex = Math.max(0, count - 1);
          this.renderTableView();
          this.renderDetailView();
          this.renderStatusBarView();
          screen.render();
          break;

        case 'pageup':
          this.state.selectedIndex = Math.max(0, selectedIndex - 20);
          this.renderTableView();
          this.renderDetailView();
          this.renderStatusBarView();
          screen.render();
          break;

        case 'pagedown':
          this.state.selectedIndex = Math.min(count - 1, selectedIndex + 20);
          this.renderTableView();
          this.renderDetailView();
          this.renderStatusBarView();
          screen.render();
          break;

        // ── Command mode ──
        case ':':
          this.state.commandMode = true;
          this.state.commandBuffer = '';
          this.updateAutocomplete();
          this.renderCommandBarView();
          screen.render();
          break;

        // ── Filter ──
        case '/':
          this.state.filterMode = true;
          this.state.filter = '';
          this.updateAutocomplete();
          this.renderCommandBarView();
          screen.render();
          break;

        // ── Toggle ──
        case 'enter':
        case 't': {
          const entity = filteredEntities[selectedIndex];
          if (entity) {
            this.client.toggleEntity(entity.entity_id).then(() => {
              this.showToast(`Toggled: ${entity.entity_id}`);
            }).catch((e: Error) => {
              this.showToast(`Error: ${e.message}`, true);
            });
          }
          break;
        }

        // ── Refresh ──
        case 'r':
          this.refreshEntities();
          this.showToast('Refreshed');
          break;

        // ── Help ──
        case '?':
          this.state.helpMode = true;
          this.helpOverlay.setContent(renderHelp());
          this.helpOverlay.show();
          this.helpOverlay.focus();
          screen.render();
          break;

        // ── Describe panel toggle ──
        case 'd':
          this.state.detailVisible = !this.state.detailVisible;
          this.renderTableView();
          this.renderDetailView();
          screen.render();
          break;

        // ── Rename device ──
        case 'n': {
          const entity = filteredEntities[selectedIndex];
          if (!entity) break;
          const deviceId = this.getDeviceIdForEntity(entity.entity_id);
          if (!deviceId) {
            this.showToast('No device linked to this entity', true);
            break;
          }
          const device = this.state.devices.find((d) => d.id === deviceId);
          this.state.inputMode = 'rename';
          this.state.inputBuffer = device?.name_by_user ?? device?.name ?? '';
          this.renderCommandBarView();
          screen.render();
          break;
        }

        // ── Assign area to device ──
        case 'a': {
          const entity = filteredEntities[selectedIndex];
          if (!entity) break;
          const deviceId = this.getDeviceIdForEntity(entity.entity_id);
          if (!deviceId) {
            this.showToast('No device linked to this entity', true);
            break;
          }
          this.state.inputMode = 'area';
          this.state.inputBuffer = this.areaMap.get(entity.entity_id) ?? '';
          this.updateAutocomplete();
          this.renderCommandBarView();
          screen.render();
          break;
        }

        // ── Recent area selector (1–5) ──
        case '1':
        case '2':
        case '3':
        case '4':
        case '5': {
          const num = parseInt(_ch ?? (key.name as string), 10);
          const area = this.state.recentAreas[num - 1];
          if (!area) break;
          if (this.state.areaFilter.toLowerCase() === area.toLowerCase()) {
            // Toggle off — clear area filter
            this.state.areaFilter = '';
          } else {
            this.state.areaFilter = area;
          }
          this.state.selectedIndex = 0;
          this.applyFilter();
          break;
        }

        // ── Quit ──
        case 'q':
          this.quit();
          break;
      }
    });

    // Mouse selection in table
    this.table.on('select', (_item: blessed.Widgets.BoxElement, idx: number) => {
      // idx 0 is the header row
      if (idx > 0) {
        this.state.selectedIndex = idx - 1;
        this.renderDetailView();
        this.renderStatusBarView();
        this.screen.render();
      }
    });

    // Mouse wheel scroll – sync detail panel with list's internal selection
    this.table.on('mouse', (data: blessed.Widgets.Events.IMouseEventArg) => {
      if ((data.action as string) === 'wheelup' || (data.action as string) === 'wheeldown') {
        setImmediate(() => {
          const sel = (this.table as unknown as { selected: number }).selected;
          if (sel !== undefined) {
            const newIndex = Math.max(0, sel - 1); // row 0 is the header
            if (
              newIndex !== this.state.selectedIndex &&
              newIndex < this.state.filteredEntities.length
            ) {
              this.state.selectedIndex = newIndex;
              this.renderDetailView();
              this.renderStatusBarView();
              this.screen.render();
            }
          }
        });
      }
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Autocomplete
  // ─────────────────────────────────────────────────────────────────────────

  private updateAutocomplete(): void {
    let suggestions: string[] = [];

    if (this.state.commandMode) {
      suggestions = computeCommandSuggestions(this.state.commandBuffer, this.state.areas);
    } else if (this.state.filterMode) {
      suggestions = computeFilterSuggestions(
        this.state.filter,
        this.state.entities,
        this.areaMap,
        this.state.areas
      );
    } else if (this.state.inputMode === 'area') {
      suggestions = computeAreaSuggestions(this.state.inputBuffer, this.state.areas);
    }

    this.state.autocompleteSuggestions = suggestions;
    this.state.autocompleteIndex = 0;

    if (suggestions.length === 0) {
      this.hideAutocomplete();
      return;
    }

    const query = this.state.commandMode ? this.state.commandBuffer : this.state.filter;
    const items = suggestions.map((s) => renderAutocompleteItem(s, query));
    this.autocompleteBox.setItems(items as unknown as string[]);
    this.autocompleteBox.select(0);

    const newHeight = Math.min(suggestions.length + 2, 8); // 2 for border
    (this.autocompleteBox as blessed.Widgets.ListElement & { height: number }).height = newHeight;

    this.autocompleteBox.show();
    this.autocompleteBox.setFront();
    this.screen.render();
  }

  private hideAutocomplete(): void {
    this.state.autocompleteSuggestions = [];
    this.state.autocompleteIndex = 0;
    this.autocompleteBox.hide();
  }

  private navigateAutocomplete(delta: -1 | 1): void {
    const count = this.state.autocompleteSuggestions.length;
    if (count === 0) return;
    this.state.autocompleteIndex = Math.max(
      0,
      Math.min(count - 1, this.state.autocompleteIndex + delta)
    );
    this.autocompleteBox.select(this.state.autocompleteIndex);
    this.screen.render();
  }

  private acceptAutocomplete(): void {
    const suggestions = this.state.autocompleteSuggestions;
    if (suggestions.length === 0) return;
    const accepted = suggestions[this.state.autocompleteIndex];
    if (this.state.commandMode) {
      this.state.commandBuffer = accepted;
    } else if (this.state.filterMode) {
      this.state.filter = accepted;
      this.applyFilter();
    }
    this.hideAutocomplete();
    this.renderCommandBarView();
    this.screen.render();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Device helpers
  // ─────────────────────────────────────────────────────────────────────────

  private getDeviceIdForEntity(entityId: string): string | null {
    const entry = this.client.entityRegistry.find((r) => r.entity_id === entityId);
    return entry?.device_id ?? null;
  }

  private async commitInput(): Promise<void> {
    const mode = this.state.inputMode;
    const buffer = this.state.inputBuffer.trim();
    this.state.inputMode = null;
    this.state.inputBuffer = '';
    this.hideAutocomplete();
    this.renderCommandBarView();
    this.screen.render();

    if (!mode) return;

    const entity = this.state.filteredEntities[this.state.selectedIndex];
    if (!entity) return;

    const deviceId = this.getDeviceIdForEntity(entity.entity_id);
    if (!deviceId) {
      this.showToast('No device linked to this entity', true);
      return;
    }

    try {
      if (mode === 'rename') {
        await this.client.renameDevice(deviceId, buffer || null);
        this.state.devices = this.client.devices;
        this.showToast(`Renamed: ${buffer || '(cleared)'}`);
      } else if (mode === 'area') {
        if (buffer === '') {
          await this.client.assignDeviceArea(deviceId, null);
          this.state.devices = this.client.devices;
          this.buildAreaMap();
          this.applyFilter();
          this.showToast('Area cleared');
        } else {
          const area = this.state.areas.find(
            (a) => a.name.toLowerCase() === buffer.toLowerCase()
          );
          if (!area) {
            this.showToast(`Area not found: ${buffer}`, true);
            return;
          }
          await this.client.assignDeviceArea(deviceId, area.area_id);
          this.state.devices = this.client.devices;
          this.buildAreaMap();
          this.applyFilter();
          this.showToast(`Area set: ${area.name}`);
        }
      }
    } catch (e) {
      this.showToast(`Error: ${(e as Error).message}`, true);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Recent area tracking
  // ─────────────────────────────────────────────────────────────────────────

  private addRecentArea(area: string): void {
    if (!area) return;
    this.state.recentAreas = this.state.recentAreas.filter(
      (a) => a.toLowerCase() !== area.toLowerCase()
    );
    this.state.recentAreas.unshift(area);
    this.state.recentAreas = this.state.recentAreas.slice(0, 5);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Client events
  // ─────────────────────────────────────────────────────────────────────────

  private bindClientEvents(): void {
    this.client.on('state_changed', (change: { entity_id: string; new_state: HassEntity | null }) => {
      // Update entity in local state list
      if (change.new_state) {
        const reg = this.registryMap.get(change.entity_id);
        const allowed = !reg || (reg.hidden_by === null && reg.device_id !== null);
        const idx = this.state.entities.findIndex((e) => e.entity_id === change.entity_id);
        if (allowed) {
          if (idx >= 0) {
            this.state.entities[idx] = change.new_state;
          } else {
            this.state.entities.push(change.new_state);
          }
        } else if (idx >= 0) {
          // entity became hidden/non-device — remove it
          this.state.entities.splice(idx, 1);
        }
      } else {
        this.state.entities = this.state.entities.filter((e) => e.entity_id !== change.entity_id);
      }
      this.applyFilter();
    });

    this.client.on('disconnected', () => {
      this.state.connected = false;
      this.state.error = 'Disconnected from Home Assistant';
      this.renderAll();
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Quit
  // ─────────────────────────────────────────────────────────────────────────

  private quit(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    if (this.headerTimer) clearInterval(this.headerTimer);
    this.client.disconnect();
    this.screen.destroy();
    process.exit(0);
  }
}
