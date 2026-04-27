const API = 'https://sheets.googleapis.com/v4/spreadsheets';
export const CONFIG_SHEET = '__tab_groups__';

const log  = (...a) => console.log('[STG api]',  ...a);
const warn = (...a) => console.warn('[STG api]', ...a);
const oops = (...a) => console.error('[STG api]',...a);

// ── Chrome messaging ───────────────────────────────────────────────────────────

export function getToken(interactive) {
  log('getToken: interactive?', interactive);
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'GET_AUTH_TOKEN', interactive }, (res) => {
      if (chrome.runtime.lastError) {
        warn('getToken runtime error:', chrome.runtime.lastError.message);
        resolve({ error: chrome.runtime.lastError.message });
        return;
      }
      resolve(res ?? { error: 'no response' });
    });
  });
}

function apiCall(url, method = 'GET', body = null) {
  log('apiCall:', method, url);
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'SHEETS_API', url, method, body }, (res) => {
      if (chrome.runtime.lastError) {
        oops('apiCall runtime error:', chrome.runtime.lastError.message);
        return reject(new Error(chrome.runtime.lastError.message));
      }
      if (!res) return reject(new Error('No response from background'));
      if (res.error) {
        oops('apiCall error:', res.error);
        return reject(new Error(res.error));
      }
      if (!res.ok) {
        const msg = res.data?.error?.message ?? `HTTP ${res.status}`;
        oops('apiCall HTTP error:', res.status, msg);
        return reject(new Error(msg));
      }
      resolve(res.data);
    });
  });
}

export function notifyContentScript(tabId, groups) {
  if (!tabId) return;
  chrome.tabs.sendMessage(tabId, { type: 'APPLY_GROUPS', groups })
    .catch(() => {/* content script not present on this tab — expected */});
}

export function navigateToSheet(tabId, sheetId) {
  if (!tabId) { warn('navigateToSheet: no tabId'); return; }
  log('navigateToSheet: tab', tabId, 'sheet', sheetId);
  chrome.tabs.sendMessage(tabId, { type: 'NAVIGATE_TO_SHEET', sheetId })
    .catch(() => {/* content script not present on this tab — expected */});
}

// ── Sheets data ────────────────────────────────────────────────────────────────

export async function loadSheets(spreadsheetId) {
  log('loadSheets:', spreadsheetId);
  const fields = 'sheets.properties(sheetId,title,hidden,tabColorStyle)';
  const data = await apiCall(`${API}/${spreadsheetId}?fields=${encodeURIComponent(fields)}`);
  const sheets = (data.sheets ?? [])
    .map((s) => ({
      sheetId:  s.properties.sheetId,
      title:    s.properties.title,
      hidden:   !!s.properties.hidden,
      tabColor: s.properties.tabColorStyle?.rgbColor ?? null,
    }))
    .filter((s) => s.title !== CONFIG_SHEET && !s.hidden);
  log('loadSheets: got', sheets.length, 'sheets');
  return sheets;
}

export async function loadGroups(spreadsheetId) {
  log('loadGroups:', spreadsheetId);
  const meta = await apiCall(`${API}/${spreadsheetId}?fields=sheets.properties.title`);
  const hasCfg = (meta.sheets ?? []).some((s) => s.properties.title === CONFIG_SHEET);
  if (!hasCfg) { log('loadGroups: no config sheet'); return { groups: [], raw: '' }; }
  try {
    const range = encodeURIComponent(`${CONFIG_SHEET}!A1`);
    const res = await apiCall(`${API}/${spreadsheetId}/values/${range}`);
    const raw = res.values?.[0]?.[0] ?? '';
    const groups = raw ? (JSON.parse(raw).groups ?? []) : [];
    log('loadGroups: loaded', groups.length, 'groups');
    return { groups, raw };
  } catch (err) {
    warn('loadGroups parse error:', err.message);
    return { groups: [], raw: '' };
  }
}

export async function saveGroups(spreadsheetId, groups, lastSaved) {
  const json = JSON.stringify(groups);
  if (json === lastSaved) { log('saveGroups: no changes'); return json; }
  log('saveGroups:', groups.length, 'groups');
  await ensureConfigSheet(spreadsheetId);
  const range = encodeURIComponent(`${CONFIG_SHEET}!A1`);
  await apiCall(
    `${API}/${spreadsheetId}/values/${range}?valueInputOption=RAW`,
    'PUT',
    { range: `${CONFIG_SHEET}!A1`, majorDimension: 'ROWS', values: [[JSON.stringify({ version: 1, groups })]] }
  );
  log('saveGroups: saved');
  return json;
}

async function ensureConfigSheet(spreadsheetId) {
  const data = await apiCall(`${API}/${spreadsheetId}?fields=sheets.properties.title`);
  if ((data.sheets ?? []).some((s) => s.properties.title === CONFIG_SHEET)) return;
  log('ensureConfigSheet: creating');
  await apiCall(`${API}/${spreadsheetId}:batchUpdate`, 'POST', {
    requests: [{ addSheet: { properties: { title: CONFIG_SHEET, hidden: true, gridProperties: { rowCount: 1, columnCount: 1 } } } }],
  });
}

// ── Native tab colors ──────────────────────────────────────────────────────────

function hexToSheetsRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return { red: ((n >> 16) & 255) / 255, green: ((n >> 8) & 255) / 255, blue: (n & 255) / 255 };
}

export async function setNativeTabColors(spreadsheetId, sheetIds, hexColor) {
  if (!sheetIds.length) return;
  log('setNativeTabColors:', sheetIds.length, 'sheets ->', hexColor);
  const rgb = hexToSheetsRgb(hexColor);
  await apiCall(`${API}/${spreadsheetId}:batchUpdate`, 'POST', {
    requests: sheetIds.map((sheetId) => ({
      updateSheetProperties: {
        properties: { sheetId, tabColorStyle: { rgbColor: rgb } },
        fields: 'tabColorStyle',
      },
    })),
  });
}

export async function clearNativeTabColors(spreadsheetId, sheetIds) {
  if (!sheetIds.length) return;
  log('clearNativeTabColors:', sheetIds.length, 'sheets');
  await apiCall(`${API}/${spreadsheetId}:batchUpdate`, 'POST', {
    requests: sheetIds.map((sheetId) => ({
      updateSheetProperties: {
        properties: { sheetId, tabColorStyle: { rgbColor: {} } },
        fields: 'tabColorStyle',
      },
    })),
  });
}
