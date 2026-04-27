// Sheets Tab Grouper — content script
// Applies group color-underlines to sheet tabs and handles navigation
// requests from the side panel. All group management lives in sidepanel.js.

const API = 'https://sheets.googleapis.com/v4/spreadsheets';
const CONFIG_SHEET = '__tab_groups__';
const STG = 'stg';

// ── State ──────────────────────────────────────────────────────────────────────

const state = {
  spreadsheetId: null,
  sheets: [],         // [{sheetId, title}]
  groups: [],         // [{id, name, color, sheetIds:[]}]
  tabMap: new Map(),  // sheetId → DOM element
};

// ── Bootstrap ──────────────────────────────────────────────────────────────────

async function init() {
  state.spreadsheetId = extractSpreadsheetId();
  if (!state.spreadsheetId) return;

  try {
    await loadSheets();
    await loadGroups();
  } catch (err) {
    console.warn('[STG] init API error:', err);
    return;
  }

  await waitForTabStrip();
  buildTabMap();
  applyGroupStyling();
  watchTabStrip();
}

// ── Message listener (commands from side panel) ────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'APPLY_GROUPS') {
    state.groups = msg.groups;
    applyGroupStyling();
    sendResponse({ ok: true });
    return true;
  }
  if (msg.type === 'NAVIGATE_TO_SHEET') {
    const el = state.tabMap.get(msg.sheetId);
    if (el) {
      // Click the inner tab name span — that's what Google Sheets listens on
      const target = el.querySelector('.docs-sheet-tab-name') ?? el;
      target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      target.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true, cancelable: true }));
      target.click();
    }
    sendResponse({ ok: true });
    return true;
  }
});

// ── API ────────────────────────────────────────────────────────────────────────

function apiCall(url, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'SHEETS_API', url, method, body }, (res) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (res.error) return reject(new Error(res.error));
      resolve(res.data);
    });
  });
}

async function loadSheets() {
  const data = await apiCall(`${API}/${state.spreadsheetId}?fields=sheets.properties`);
  state.sheets = data.sheets.map((s) => ({
    sheetId: s.properties.sheetId,
    title: s.properties.title,
    hidden: !!s.properties.hidden,
  }));
}

async function loadGroups() {
  const hasCfg = state.sheets.some((s) => s.title === CONFIG_SHEET);
  if (!hasCfg) { state.groups = []; return; }
  try {
    const range = encodeURIComponent(`${CONFIG_SHEET}!A1`);
    const data = await apiCall(`${API}/${state.spreadsheetId}/values/${range}`);
    const raw = data.values?.[0]?.[0];
    state.groups = raw ? (JSON.parse(raw).groups ?? []) : [];
  } catch {
    state.groups = [];
  }
}

// ── Group Styling ──────────────────────────────────────────────────────────────

function applyGroupStyling() {
  // Clear previous markers
  document.querySelectorAll('[data-stg-group]').forEach((el) => {
    delete el.dataset.stgGroup;
    el.style.removeProperty('--stg-color');
    el.classList.remove(`${STG}-in-group`);
  });

  buildTabMap();

  for (const group of state.groups) {
    for (const sheetId of group.sheetIds) {
      const el = state.tabMap.get(sheetId);
      if (!el) continue;
      el.dataset.stgGroup = group.id;
      el.style.setProperty('--stg-color', group.color);
      el.classList.add(`${STG}-in-group`);
    }
  }
}

// ── DOM Helpers ────────────────────────────────────────────────────────────────

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

function getTabStrip() {
  return (
    document.querySelector('.docs-sheet-container-bar') ||
    document.querySelector('.docs-sheet-tab-strip') ||
    document.querySelector('#sheet-tab-strip') ||
    document.querySelector('[class*="sheet-tab-strip"]') ||
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
  const nameSpans = Array.from(document.querySelectorAll('.docs-sheet-tab-name'));

  if (nameSpans.length > 0) {
    return nameSpans.map((span) => {
      let el = span.parentElement;
      while (el && el !== strip) {
        const parent = el.parentElement;
        if (!parent || parent === strip) break;
        if (parent.querySelectorAll('.docs-sheet-tab-name').length > 1) break;
        el = parent;
      }
      return el ?? span;
    });
  }

  return Array.from(
    document.querySelectorAll('.docs-sheet-tab, [class*="sheet-tab"]:not([class*="strip"]):not([class*="name"])')
  );
}

function getTabName(el) {
  const nameEl =
    el.querySelector('.docs-sheet-tab-name') ||
    el.querySelector('.docs-sheet-tab-caption') ||
    el.querySelector('[class*="tab-name"]') ||
    el.querySelector('[class*="tab-caption"]');
  return (nameEl || el).textContent.trim();
}

function buildTabMap() {
  state.tabMap.clear();
  for (const el of getTabElements()) {
    const name = getTabName(el);
    const sheet = state.sheets.find((s) => s.title === name && s.title !== CONFIG_SHEET);
    if (sheet) {
      state.tabMap.set(sheet.sheetId, el);
      el.dataset.stgId = sheet.sheetId;
    }
  }
}

function watchTabStrip() {
  const strip = getTabStrip();
  if (!strip) return;
  let timer = null;
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      buildTabMap();
      applyGroupStyling();
    }, 300);
  }).observe(strip, { childList: true, subtree: true });
}

// ── Go ─────────────────────────────────────────────────────────────────────────

init().catch(console.error);
