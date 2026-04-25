// Sheets Tab Grouper — content script
// Injects group chips into the Google Sheets tab strip, persists groups
// in a hidden "__tab_groups__" sheet, and syncs across users.

const API = 'https://sheets.googleapis.com/v4/spreadsheets';
const CONFIG_SHEET = '__tab_groups__';
const SYNC_INTERVAL = 30_000; // ms
const STG = 'stg'; // CSS prefix

const GROUP_COLORS = [
  { name: 'Blue',   value: '#1a73e8' },
  { name: 'Red',    value: '#d93025' },
  { name: 'Green',  value: '#1e8e3e' },
  { name: 'Yellow', value: '#f9ab00' },
  { name: 'Purple', value: '#8430ce' },
  { name: 'Pink',   value: '#e52592' },
  { name: 'Cyan',   value: '#007b83' },
  { name: 'Orange', value: '#fa7b17' },
  { name: 'Grey',   value: '#5f6368' },
];

// ─── State ────────────────────────────────────────────────────────────────────

const state = {
  spreadsheetId: null,
  sheets: [],          // [{sheetId, title, hidden}]
  groups: [],          // [{id, name, color, collapsed, sheetIds:[number]}]
  tabMap: new Map(),   // sheetId (number) → <DOM element>
  lastSavedJSON: '',
};

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function init() {
  console.log('[STG] content script started');
  state.spreadsheetId = extractSpreadsheetId();
  if (!state.spreadsheetId) { console.warn('[STG] no spreadsheet ID in URL'); return; }

  // Attach context menu immediately so right-clicks work even before DOM is ready
  attachContextMenu();

  // Load sheet data first — don't block on finding the tab strip DOM
  try {
    await loadSheets();
    await loadGroups();
    console.log('[STG] sheets loaded:', state.sheets.map(s => s.title));
  } catch (err) {
    console.warn('[STG] API error:', err);
    return;
  }

  // Now wait for the tab strip DOM so we can render group chips
  await waitForTabStrip();
  const strip = getTabStrip();
  console.log('[STG] tab strip:', strip ? strip.className : 'NOT FOUND');
  if (!strip) debugTabStrip();

  setupStripDrop(strip);
  buildTabMap();
  console.log('[STG] tabMap:', [...state.tabMap.entries()].map(([id, el]) => `${id}→"${el.textContent?.trim()}"`));
  renderGroups();
  watchTabStrip();
  setInterval(syncFromRemote, SYNC_INTERVAL);
}

function debugTabStrip() {
  const bottom = window.innerHeight;
  const candidates = Array.from(document.querySelectorAll('*')).filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 100 && r.top > bottom - 120 && r.bottom <= bottom + 20 && el.className;
  });
  console.log('[STG] bottom-area elements:', candidates.map((el) => ({
    tag: el.tagName, cls: (el.className + '').slice(0, 120), id: el.id, children: el.children.length,
  })));
}

function extractSpreadsheetId() {
  const m = location.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

function waitForTabStrip(timeout = 15000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const poll = () => {
      if (getTabStrip() || Date.now() - start > timeout) resolve();
      else setTimeout(poll, 400);
    };
    poll();
  });
}

// ─── DOM Selectors ────────────────────────────────────────────────────────────

function getTabStrip() {
  return (
    document.querySelector('.docs-sheet-container-bar') ||
    document.querySelector('.docs-sheet-tab-strip') ||
    document.querySelector('#sheet-tab-strip') ||
    document.querySelector('[class*="sheet-tab-strip"]') ||
    // Fallback: find the common ancestor of all tab name spans
    (() => {
      const spans = Array.from(document.querySelectorAll('.docs-sheet-tab-name'));
      if (!spans.length) return null;
      let el = spans[0].parentElement;
      while (el && el !== document.body) {
        if (el.querySelectorAll('.docs-sheet-tab-name').length >= spans.length) return el;
        el = el.parentElement;
      }
      return null;
    })()
  );
}

function getTabElements() {
  const strip = getTabStrip();

  // Use the tab name spans and walk up to the container that holds the full tab
  // (name + dropdown button), stopping before the strip itself.
  const nameSpans = Array.from(document.querySelectorAll('.docs-sheet-tab-name'))
    .filter((el) => !el.closest(`.${STG}-group-chip`));

  if (nameSpans.length > 0) {
    return nameSpans.map((span) => {
      let el = span.parentElement;
      while (el && el !== strip) {
        const parent = el.parentElement;
        if (!parent || parent === strip) break;
        // Stop when the parent contains more than one tab-name (it owns multiple tabs)
        if (parent.querySelectorAll('.docs-sheet-tab-name').length > 1) break;
        el = parent;
      }
      return el ?? span;
    });
  }

  // Legacy class selectors (older Sheets versions)
  const bySelector = Array.from(
    document.querySelectorAll('.docs-sheet-tab, [class*="sheet-tab"]:not([class*="strip"]):not([class*="name"]):not([class*="stg"])')
  ).filter((el) => !el.classList.contains(`${STG}-group-chip`));

  if (bySelector.length > 0) return bySelector;

  // Last resort: text-match against sheet names inside the strip
  if (!strip || state.sheets.length === 0) return [];
  const names = new Set(state.sheets.filter((s) => s.title !== CONFIG_SHEET).map((s) => s.title));
  const found = new Map();
  const walker = document.createTreeWalker(strip, NodeFilter.SHOW_ELEMENT);
  let node = walker.nextNode();
  while (node) {
    if (node.classList.contains(`${STG}-group-chip`)) { node = walker.nextNode(); continue; }
    const text = node.textContent?.trim();
    if (text && names.has(text) && !found.has(text)) {
      let tabEl = node;
      while (tabEl.parentElement && tabEl.parentElement !== strip) tabEl = tabEl.parentElement;
      found.set(text, tabEl);
    }
    node = walker.nextNode();
  }
  return Array.from(found.values());
}

function getTabName(el) {
  const nameEl =
    el.querySelector('.docs-sheet-tab-name') ||
    el.querySelector('.docs-sheet-tab-caption') ||
    el.querySelector('[class*="tab-name"]') ||
    el.querySelector('[class*="tab-caption"]');
  return (nameEl || el).textContent.trim();
}

// ─── API Helpers ──────────────────────────────────────────────────────────────

function apiCall(url, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'SHEETS_API', url, method, body }, (res) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (res.error) return reject(new Error(res.error));
      if (!res.ok && res.status !== 200) return reject(new Error(`API error ${res.status}`));
      resolve(res.data);
    });
  });
}

// ─── Sheets Metadata ─────────────────────────────────────────────────────────

async function loadSheets() {
  const data = await apiCall(`${API}/${state.spreadsheetId}?fields=sheets.properties`);
  state.sheets = data.sheets.map((s) => ({
    sheetId: s.properties.sheetId,
    title: s.properties.title,
    hidden: !!s.properties.hidden,
  }));
}

async function ensureConfigSheet() {
  let cfg = state.sheets.find((s) => s.title === CONFIG_SHEET);
  if (cfg) return cfg.sheetId;

  const data = await apiCall(`${API}/${state.spreadsheetId}:batchUpdate`, 'POST', {
    requests: [{
      addSheet: {
        properties: {
          title: CONFIG_SHEET,
          hidden: true,
          gridProperties: { rowCount: 1, columnCount: 1 },
        },
      },
    }],
  });

  const newId = data.replies[0].addSheet.properties.sheetId;
  state.sheets.push({ sheetId: newId, title: CONFIG_SHEET, hidden: true });
  return newId;
}

// ─── Group Persistence ────────────────────────────────────────────────────────

async function loadGroups() {
  const hasCfg = state.sheets.find((s) => s.title === CONFIG_SHEET);
  if (!hasCfg) { state.groups = []; return; }

  try {
    const range = encodeURIComponent(`${CONFIG_SHEET}!A1`);
    const data = await apiCall(`${API}/${state.spreadsheetId}/values/${range}`);
    const raw = data.values?.[0]?.[0];
    state.groups = raw ? (JSON.parse(raw).groups ?? []) : [];
    state.lastSavedJSON = JSON.stringify(state.groups);
  } catch {
    state.groups = [];
  }
}

async function saveGroups() {
  const json = JSON.stringify(state.groups);
  if (json === state.lastSavedJSON) return;
  state.lastSavedJSON = json;

  await ensureConfigSheet();
  const range = encodeURIComponent(`${CONFIG_SHEET}!A1`);
  await apiCall(
    `${API}/${state.spreadsheetId}/values/${range}?valueInputOption=RAW`,
    'PUT',
    { range: `${CONFIG_SHEET}!A1`, majorDimension: 'ROWS', values: [[JSON.stringify({ version: 1, groups: state.groups })]] }
  );
}

async function syncFromRemote() {
  const prev = JSON.stringify(state.groups);
  await loadSheets();
  await loadGroups();
  if (JSON.stringify(state.groups) !== prev) {
    buildTabMap();
    renderGroups();
  }
}

// ─── Tab Map ──────────────────────────────────────────────────────────────────

function buildTabMap() {
  state.tabMap.clear();
  for (const el of getTabElements()) {
    const name = getTabName(el);
    const sheet = state.sheets.find((s) => s.title === name && s.title !== CONFIG_SHEET);
    if (sheet) {
      state.tabMap.set(sheet.sheetId, el);
      el.dataset.stgId = sheet.sheetId;
      setupTabDrag(el, sheet.sheetId);
    }
  }
}

// ─── Drag and Drop ────────────────────────────────────────────────────────────

function setupTabDrag(el, sheetId) {
  if (el.dataset.stgDrag) return; // avoid double-wiring on re-renders
  el.dataset.stgDrag = '1';
  el.setAttribute('draggable', 'true');

  el.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', String(sheetId));
    e.dataTransfer.effectAllowed = 'move';

    // Build a custom ghost — the native tab element text goes invisible when
    // Google's own drag system fires alongside the HTML5 drag API.
    const name = getTabName(el);
    const ghost = document.createElement('div');
    ghost.textContent = name;
    ghost.style.cssText =
      'position:fixed;top:0;left:-9999px;background:#fff;border:1px solid #dadce0;' +
      'border-radius:8px 8px 0 0;padding:0 14px;height:30px;line-height:30px;' +
      'font:500 13px "Google Sans",Roboto,Arial,sans-serif;' +
      'box-shadow:0 2px 8px rgba(0,0,0,0.18);white-space:nowrap;pointer-events:none;';
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 40, 15);
    requestAnimationFrame(() => ghost.remove());

    el.classList.add(`${STG}-dragging`);
    document.querySelectorAll(`.${STG}-group-chip`).forEach((c) =>
      c.classList.add(`${STG}-chip-droppable`)
    );
    console.log('[STG] dragstart sheetId:', sheetId);
  });

  el.addEventListener('dragend', () => {
    el.classList.remove(`${STG}-dragging`);
    document.querySelectorAll(`.${STG}-group-chip`).forEach((c) =>
      c.classList.remove(`${STG}-chip-droppable`, `${STG}-chip-drop`)
    );
    // Give Google's native reorder 200 ms to settle, then sync group membership
    // to match whatever position the tab landed in.
    setTimeout(reconcileGroupsWithDOMOrder, 200);
  });
}

function setupStripDrop(strip) {
  if (!strip || strip.dataset.stgStripDrop) return;
  strip.dataset.stgStripDrop = '1';

  // Dropping a tab onto the bare strip (not on any chip) removes it from its group
  strip.addEventListener('dragover', (e) => {
    if (e.target.closest(`.${STG}-group-chip`)) return;
    if (!e.dataTransfer.types.includes('text/plain')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  });

  strip.addEventListener('drop', (e) => {
    if (e.target.closest(`.${STG}-group-chip`)) return;
    e.preventDefault();
    const sheetId = Number(e.dataTransfer.getData('text/plain'));
    if (!sheetId || isNaN(sheetId)) return;
    console.log('[STG] drop on strip → remove from group, sheetId:', sheetId);
    removeFromGroup(sheetId);
  });
}

// Walk the strip in DOM order: each tab is assigned to the group whose chip
// most recently preceded it. Called after native Google drag settles so that
// dragging a tab into another group's territory auto-reassigns it.
function reconcileGroupsWithDOMOrder() {
  const strip = getTabStrip();
  if (!strip) return;

  const els = Array.from(strip.querySelectorAll(`[data-stg-id], .${STG}-group-chip`));
  let curGroupId = null;
  const newMap = new Map(); // sheetId → groupId | null

  for (const el of els) {
    if (el.classList.contains(`${STG}-group-chip`)) {
      curGroupId = el.dataset.groupId ?? null;
    } else if (el.dataset.stgId) {
      newMap.set(Number(el.dataset.stgId), curGroupId);
    }
  }

  if (newMap.size === 0) return;

  let changed = false;
  for (const [sheetId, newGroupId] of newMap) {
    const curGroup = state.groups.find((g) => g.sheetIds.includes(sheetId));
    if ((curGroup?.id ?? null) === newGroupId) continue;
    changed = true;
    if (curGroup) curGroup.sheetIds = curGroup.sheetIds.filter((id) => id !== sheetId);
    if (newGroupId) {
      const g = state.groups.find((g) => g.id === newGroupId);
      if (g && !g.sheetIds.includes(sheetId)) g.sheetIds.push(sheetId);
    }
  }

  if (changed) {
    console.log('[STG] group membership reconciled after native drag');
    pruneEmpty();
    renderGroups();
    saveGroups().catch(console.error);
  }
}

// ─── Rendering ────────────────────────────────────────────────────────────────

let isRendering = false;

function renderGroups() {
  if (isRendering) return;
  isRendering = true;
  try {
    // Remove previous injections
    document.querySelectorAll(`.${STG}-group-chip`).forEach((el) => el.remove());
    document.querySelectorAll('[data-stg-group]').forEach((el) => {
      delete el.dataset.stgGroup;
      el.style.removeProperty('--stg-color');
      el.classList.remove(`${STG}-in-group`, `${STG}-collapsed`);
    });

    buildTabMap();

    const tabEls = getTabElements();
    const seen = new Set();

    for (const el of tabEls) {
      const sheetId = Number(el.dataset.stgId);
      const group = state.groups.find((g) => g.sheetIds.includes(sheetId));
      if (!group) continue;

      el.dataset.stgGroup = group.id;
      el.style.setProperty('--stg-color', group.color);
      el.classList.add(`${STG}-in-group`);
      if (group.collapsed) el.classList.add(`${STG}-collapsed`);

      if (!seen.has(group.id)) {
        seen.add(group.id);
        el.parentNode.insertBefore(buildChip(group), el);
      }
    }
  } finally {
    // Allow the next animation frame to complete before clearing the flag,
    // so MutationObserver callbacks triggered by our DOM changes are ignored.
    requestAnimationFrame(() => { isRendering = false; });
  }
}

function buildChip(group) {
  const chip = document.createElement('div');
  chip.className = `${STG}-group-chip`;
  chip.dataset.groupId = group.id;
  chip.style.setProperty('--stg-color', group.color);

  const dot = document.createElement('span');
  dot.className = `${STG}-dot`;

  const label = document.createElement('span');
  label.className = `${STG}-label`;
  label.textContent = group.name;

  const arrow = document.createElement('span');
  arrow.className = `${STG}-arrow`;
  arrow.textContent = group.collapsed ? '▶' : '▾';

  chip.append(dot, label, arrow);

  chip.addEventListener('click', (e) => {
    if (e.target.closest(`.${STG}-label`)) return; // label click handled separately
    e.stopPropagation();
    toggleCollapse(group.id);
  });

  label.addEventListener('click', (e) => {
    e.stopPropagation();
    startInlineRename(chip, label, group);
  });

  chip.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showChipMenu(e, group);
  });

  // Drop zone: accept tabs dragged onto this chip
  chip.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes('text/plain')) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    chip.classList.add(`${STG}-chip-drop`);
  });

  chip.addEventListener('dragleave', (e) => {
    if (!chip.contains(e.relatedTarget)) chip.classList.remove(`${STG}-chip-drop`);
  });

  chip.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    chip.classList.remove(`${STG}-chip-drop`);
    const sheetId = Number(e.dataTransfer.getData('text/plain'));
    if (!sheetId || isNaN(sheetId)) return;
    if (group.sheetIds.includes(sheetId)) return; // already in this group
    console.log('[STG] drop onto chip → moveTab', sheetId, '→', group.name);
    moveTab(sheetId, group.id);
  });

  return chip;
}

function startInlineRename(chipEl, labelEl, group) {
  if (chipEl.querySelector(`.${STG}-chip-input`)) return; // already editing

  const inp = document.createElement('input');
  inp.className = `${STG}-chip-input`;
  inp.value = group.name;
  // Size the input to the current label width
  inp.style.width = Math.max(40, labelEl.offsetWidth + 4) + 'px';
  labelEl.replaceWith(inp);
  inp.focus();
  inp.select();

  let done = false;
  const commit = (save) => {
    if (done) return;
    done = true;
    if (save) {
      const val = inp.value.trim();
      if (val && val !== group.name) {
        group.name = val;
        saveGroups().catch(console.error);
      }
    }
    renderGroups();
  };

  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(true); return; }
    if (e.key === 'Escape') { e.preventDefault(); commit(false); return; }
    e.stopPropagation();
  });
  inp.addEventListener('blur', () => commit(true));
  inp.addEventListener('click', (e) => e.stopPropagation());
}

// ─── Context Menu ─────────────────────────────────────────────────────────────

// Last known right-click coordinates, used for the color picker
let lastCtxX = 0, lastCtxY = 0;

function attachContextMenu() {
  document.addEventListener('contextmenu', (e) => {
    lastCtxX = e.clientX;
    lastCtxY = e.clientY;
    if (e.target.closest(`.${STG}-group-chip`)) return; // chip handles itself

    const sheetId = resolveSheetId(e.target);
    if (sheetId === null) return;

    // Poll briefly for Google's menu to appear, then inject our items once
    let tries = 0;
    let done = false;
    const poll = () => {
      if (done) return;
      const menu = Array.from(document.querySelectorAll('.goog-menu')).find((m) => {
        const r = m.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      if (menu) {
        done = true;
        injectGroupMenuItems(menu, sheetId);
      } else if (++tries < 10) {
        setTimeout(poll, 30);
      }
    };
    setTimeout(poll, 50);
  }, true);

  document.addEventListener('click', dismissMenus);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') dismissMenus(); });
}

// Walk up from the clicked element, first checking data-stg-id (set by buildTabMap),
// then falling back to matching text content against known sheet names.
function resolveSheetId(target) {
  let el = target;
  while (el) {
    if (el.dataset?.stgId) return Number(el.dataset.stgId);
    el = el.parentElement;
  }
  el = target;
  for (let depth = 0; el && depth < 6; depth++, el = el.parentElement) {
    const text = el.textContent?.trim();
    if (text) {
      const sheet = state.sheets.find((s) => s.title === text && s.title !== CONFIG_SHEET);
      if (sheet) return sheet.sheetId;
    }
  }
  return null;
}

// Inject STG items at the top of Google's native tab context menu
function injectGroupMenuItems(menu, sheetId) {
  // Remove any items from a previous right-click first to prevent duplicates
  menu.querySelectorAll('.stg-injected').forEach((el) => el.remove());

  const group = state.groups.find((g) => g.sheetIds.includes(sheetId));
  const anchor = menu.firstElementChild; // insert before Google's existing items

  const items = [];

  if (group) {
    items.push(makeGoogItem(`Rename "${group.name}"`, () => promptRename(group)));
    items.push(makeGoogItem('Change color', () => showColorPicker(lastCtxX, lastCtxY, group)));
    items.push(makeGoogItem(group.collapsed ? 'Expand group' : 'Collapse group', () => toggleCollapse(group.id)));
    if (state.groups.length > 1) {
      for (const g of state.groups) {
        if (g.id === group.id) continue;
        items.push(makeGoogItem(`Move to "${g.name}"`, () => moveTab(sheetId, g.id)));
      }
    }
    items.push(makeGoogItem('Remove from group', () => removeFromGroup(sheetId)));
    items.push(makeGoogItem('Ungroup', () => ungroupAll(group.id)));
  } else {
    items.push(makeGoogItem('Add to new group', () => promptCreateGroup([sheetId])));
    for (const g of state.groups) {
      items.push(makeGoogItem(`Add to "${g.name}"`, () => moveTab(sheetId, g.id)));
    }
  }

  const sep = document.createElement('div');
  sep.className = 'goog-menuseparator stg-injected';
  sep.setAttribute('role', 'separator');
  items.push(sep);

  for (const item of items) {
    if (anchor) menu.insertBefore(item, anchor);
    else menu.appendChild(item);
  }
}

function makeGoogItem(label, onClick) {
  const item = document.createElement('div');
  item.className = 'goog-menuitem stg-injected';
  item.setAttribute('role', 'menuitem');

  const content = document.createElement('div');
  content.className = 'goog-menuitem-content';
  content.textContent = label;
  item.appendChild(content);

  item.addEventListener('mouseenter', () => item.classList.add('goog-menuitem-highlight'));
  item.addEventListener('mouseleave', () => item.classList.remove('goog-menuitem-highlight'));
  item.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    // Close Google's menu by triggering an outside click
    document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    requestAnimationFrame(() => onClick());
  });

  return item;
}

function showChipMenu(e, group) {
  dismissMenus();
  const menu = makeMenu(e.clientX, e.clientY);

  addItem(menu, 'Rename', () => {
    const chipEl = document.querySelector(`.${STG}-group-chip[data-group-id="${group.id}"]`);
    const labelEl = chipEl?.querySelector(`.${STG}-label`);
    if (chipEl && labelEl) startInlineRename(chipEl, labelEl, group);
    else promptRename(group);
  });

  // Inline color swatches — matches Chrome's chip context menu
  const colorRow = document.createElement('div');
  colorRow.className = `${STG}-menu-colors`;
  for (const c of GROUP_COLORS) {
    const sw = document.createElement('div');
    sw.className = `${STG}-swatch${group.color === c.value ? ` ${STG}-swatch-active` : ''}`;
    sw.style.background = c.value;
    sw.title = c.name;
    sw.addEventListener('click', () => { dismissMenus(); changeColor(group.id, c.value); });
    colorRow.appendChild(sw);
  }
  menu.appendChild(colorRow);

  addSep(menu);
  addItem(menu, group.collapsed ? 'Expand group' : 'Collapse group', () => toggleCollapse(group.id));
  addSep(menu);
  addItem(menu, 'Ungroup', () => ungroupAll(group.id));

  document.body.appendChild(menu);
}

// ─── Menu Builders ────────────────────────────────────────────────────────────

function makeMenu(x, y) {
  const menu = document.createElement('div');
  menu.className = `${STG}-menu`;
  menu.style.left = x + 'px';
  menu.style.top  = y + 'px';

  // Defer edge-correction until the menu is in the DOM
  requestAnimationFrame(() => {
    const r = menu.getBoundingClientRect();
    if (r.right  > window.innerWidth)  menu.style.left = (x - r.width)  + 'px';
    if (r.bottom > window.innerHeight) menu.style.top  = (y - r.height) + 'px';
  });

  return menu;
}

function addItem(menu, html, onClick, isHTML = false) {
  const item = document.createElement('div');
  item.className = `${STG}-menu-item`;
  if (isHTML) item.innerHTML = html; else item.textContent = html;
  if (onClick) item.addEventListener('click', () => { dismissMenus(); onClick(); });
  menu.appendChild(item);
  return item;
}

function addSep(menu) {
  const sep = document.createElement('div');
  sep.className = `${STG}-menu-sep`;
  menu.appendChild(sep);
}

function dotHtml(color) {
  return `<span style="color:${color}; font-size:10px;">●</span>`;
}

function dismissMenus(removeColorPicker = true) {
  document.querySelectorAll(`.${STG}-menu`).forEach((el) => el.remove());
  if (removeColorPicker) document.querySelectorAll(`.${STG}-color-picker`).forEach((el) => el.remove());
}


// ─── Color Picker ─────────────────────────────────────────────────────────────

function showColorPicker(x, y, group) {
  dismissMenus(false);
  document.querySelectorAll(`.${STG}-color-picker`).forEach((el) => el.remove());

  const picker = document.createElement('div');
  picker.className = `${STG}-color-picker`;
  picker.style.left = x + 'px';
  picker.style.top  = y + 'px';

  for (const c of GROUP_COLORS) {
    const sw = document.createElement('div');
    sw.className = `${STG}-swatch${group.color === c.value ? ` ${STG}-swatch-active` : ''}`;
    sw.style.background = c.value;
    sw.title = c.name;
    sw.addEventListener('click', () => { changeColor(group.id, c.value); picker.remove(); });
    picker.appendChild(sw);
  }

  document.body.appendChild(picker);
  requestAnimationFrame(() => {
    const r = picker.getBoundingClientRect();
    if (r.right  > window.innerWidth)  picker.style.left = (x - r.width)  + 'px';
    if (r.bottom > window.innerHeight) picker.style.top  = (y - r.height) + 'px';
  });
}

// ─── Modal ────────────────────────────────────────────────────────────────────

function showModal({ title, inputValue = '', inputPlaceholder = 'Group name', confirmLabel = 'Save', colorPick = null, onConfirm }) {
  const overlay = document.createElement('div');
  overlay.className = `${STG}-overlay`;

  const box = document.createElement('div');
  box.className = `${STG}-modal`;

  const h = document.createElement('h3');
  h.textContent = title;

  const inp = document.createElement('input');
  inp.className = `${STG}-input`;
  inp.type = 'text';
  inp.value = inputValue;
  inp.placeholder = inputPlaceholder;

  box.append(h, inp);

  // Optional inline color row for "create group"
  let selectedColor = colorPick ?? GROUP_COLORS[0].value;
  if (colorPick !== null) {
    const colorRow = document.createElement('div');
    colorRow.className = `${STG}-modal-colors`;
    for (const c of GROUP_COLORS) {
      const sw = document.createElement('div');
      sw.className = `${STG}-swatch${selectedColor === c.value ? ` ${STG}-swatch-active` : ''}`;
      sw.style.background = c.value;
      sw.title = c.name;
      sw.addEventListener('click', () => {
        selectedColor = c.value;
        colorRow.querySelectorAll(`.${STG}-swatch`).forEach((s) => s.classList.remove(`${STG}-swatch-active`));
        sw.classList.add(`${STG}-swatch-active`);
      });
      colorRow.appendChild(sw);
    }
    box.appendChild(colorRow);
  }

  const btns = document.createElement('div');
  btns.className = `${STG}-modal-btns`;

  const cancel = document.createElement('button');
  cancel.className = `${STG}-btn ${STG}-btn-ghost`;
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => overlay.remove());

  const confirm = document.createElement('button');
  confirm.className = `${STG}-btn ${STG}-btn-primary`;
  confirm.textContent = confirmLabel;
  confirm.addEventListener('click', () => {
    const val = inp.value.trim();
    if (!val) { inp.focus(); return; }
    overlay.remove();
    onConfirm(val, selectedColor);
  });

  btns.append(cancel, confirm);
  box.appendChild(btns);
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  inp.focus();
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirm.click();
    if (e.key === 'Escape') overlay.remove();
  });
}

// ─── Group Operations ─────────────────────────────────────────────────────────

function uid() {
  return 'g_' + Math.random().toString(36).slice(2, 10);
}

function nextColor() {
  const used = new Set(state.groups.map((g) => g.color));
  return (GROUP_COLORS.find((c) => !used.has(c.value)) ?? GROUP_COLORS[0]).value;
}

function promptCreateGroup(sheetIds) {
  showModal({
    title: 'New group',
    inputPlaceholder: 'Group name',
    confirmLabel: 'Create',
    colorPick: nextColor(),
    onConfirm(name, color) {
      state.groups.push({ id: uid(), name, color, collapsed: false, sheetIds });
      renderGroups();
      saveGroups().catch(console.error);
    },
  });
}

function promptRename(group) {
  showModal({
    title: 'Rename group',
    inputValue: group.name,
    confirmLabel: 'Rename',
    onConfirm(name) {
      group.name = name;
      renderGroups();
      saveGroups().catch(console.error);
    },
  });
}

function changeColor(groupId, color) {
  const group = state.groups.find((g) => g.id === groupId);
  if (!group) return;
  group.color = color;
  renderGroups();
  saveGroups().catch(console.error);
}

function moveTab(sheetId, targetGroupId) {
  // Remove from whatever group it's currently in
  for (const g of state.groups) g.sheetIds = g.sheetIds.filter((id) => id !== sheetId);
  const target = state.groups.find((g) => g.id === targetGroupId);
  if (target) target.sheetIds.push(sheetId);
  pruneEmpty();
  renderGroups();
  saveGroups().catch(console.error);
}

function removeFromGroup(sheetId) {
  for (const g of state.groups) g.sheetIds = g.sheetIds.filter((id) => id !== sheetId);
  pruneEmpty();
  renderGroups();
  saveGroups().catch(console.error);
}

function toggleCollapse(groupId) {
  const group = state.groups.find((g) => g.id === groupId);
  if (!group) return;
  group.collapsed = !group.collapsed;
  renderGroups();
  saveGroups().catch(console.error);
}

function ungroupAll(groupId) {
  state.groups = state.groups.filter((g) => g.id !== groupId);
  renderGroups();
  saveGroups().catch(console.error);
}

function pruneEmpty() {
  state.groups = state.groups.filter((g) => g.sheetIds.length > 0);
}

// ─── MutationObserver ─────────────────────────────────────────────────────────

function watchTabStrip() {
  const strip = getTabStrip();
  if (!strip) return;

  let debounceTimer = null;

  const observer = new MutationObserver(() => {
    if (isRendering) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (!isRendering) renderGroups();
    }, 300);
  });

  observer.observe(strip, { childList: true, subtree: true });
}

// ─── Go ───────────────────────────────────────────────────────────────────────

init().catch(console.error);
