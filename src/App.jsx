import React, { useState, useEffect, useRef, useCallback } from 'react';
import { RefreshCw, Plus, Download } from 'lucide-react';
import {
  getToken, loadSheets, loadGroups, saveGroups,
  notifyContentScript, navigateToSheet,
  setNativeTabColors, clearNativeTabColors,
} from './lib/api';
import { nextAvailableColor, nearestColor } from './lib/colors';
import GroupList from './components/GroupList';
import UngroupedSection from './components/UngroupedSection';
import NewGroupForm from './components/NewGroupForm';

const log  = (...a) => console.log('[STG app]',  ...a);
const warn = (...a) => console.warn('[STG app]', ...a);
const oops = (...a) => console.error('[STG app]',...a);

const POLL_MS = 9000;

function uid() { return 'g_' + Math.random().toString(36).slice(2, 10); }

export default function App() {
  const [view, setView] = useState('loading'); // loading | not-sheets | not-signed-in | main
  const [groups, setGroupsRaw] = useState([]);
  const [sheets, setSheets] = useState([]);
  const [tabId, setTabId] = useState(null);
  const [spreadsheetId, setSpreadsheetId] = useState(null);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [toast, setToast] = useState(null);

  const lastSavedRef  = useRef('');
  const spreadIdRef   = useRef(null);
  const tabIdRef      = useRef(null);
  const pollTimer     = useRef(null);
  const prevColorsRef = useRef(new Map());

  // Keep refs in sync for callbacks that close over stale values
  spreadIdRef.current = spreadsheetId;
  tabIdRef.current    = tabId;

  // ── Toast ──────────────────────────────────────────────────────────────────

  const showToast = useCallback((msg) => {
    log('toast:', msg);
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);

  // ── Groups state wrapper (saves to Sheets + notifies content script) ───────

  const persistGroups = useCallback(async (newGroups, sid, tid) => {
    const ssId = sid ?? spreadIdRef.current;
    const tId  = tid ?? tabIdRef.current;
    log('persistGroups:', newGroups.length, 'groups');
    setGroupsRaw(newGroups);
    notifyContentScript(tId, newGroups);
    try {
      lastSavedRef.current = await saveGroups(ssId, newGroups, lastSavedRef.current);
    } catch (e) {
      warn('persistGroups save error:', e.message);
      showToast('Failed to save — check console');
    }
  }, [showToast]);

  // ── Load data ──────────────────────────────────────────────────────────────

  const loadData = useCallback(async (ssId, tId) => {
    log('loadData: ssId', ssId, 'tabId', tId);
    try {
      const [sheetsData, { groups: groupsData, raw }] = await Promise.all([
        loadSheets(ssId),
        loadGroups(ssId),
      ]);
      setSheets(sheetsData);
      setGroupsRaw(groupsData);
      lastSavedRef.current = raw;

      // Snapshot current tab colors for polling
      prevColorsRef.current = new Map(
        sheetsData.map((s) => [s.sheetId, JSON.stringify(s.tabColor)])
      );

      notifyContentScript(tId, groupsData);
      setView('main');
      log('loadData: success');
    } catch (err) {
      oops('loadData error:', err.message, err);
      if (/401|403|OAuth|token|credentials/i.test(err.message)) setView('not-signed-in');
      else setView('not-sheets');
    }
  }, []);

  // ── Active tab listener ────────────────────────────────────────────────────

  const refreshFromActiveTab = useCallback(async () => {
    log('refreshFromActiveTab');
    setView('loading');
    stopPolling();

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const tId = tab?.id ?? null;
    setTabId(tId);
    tabIdRef.current = tId;

    const match = tab?.url?.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    const ssId = match?.[1] ?? null;
    setSpreadsheetId(ssId);
    spreadIdRef.current = ssId;

    log('refreshFromActiveTab: tab', tId, 'spreadsheet', ssId);

    if (!ssId) { setView('not-sheets'); return; }

    await loadData(ssId, tId);
    startPolling(ssId);
  }, [loadData]); // eslint-disable-line

  // ── Polling for native color changes ──────────────────────────────────────

  function stopPolling() {
    if (pollTimer.current) { clearInterval(pollTimer.current); pollTimer.current = null; }
  }

  function startPolling(ssId) {
    stopPolling();
    log('startPolling every', POLL_MS, 'ms');
    pollTimer.current = setInterval(() => pollNativeColors(ssId), POLL_MS);
  }

  async function pollNativeColors(ssId) {
    if (!ssId) return;
    try {
      const freshSheets = await loadSheets(ssId);
      let changed = false;

      setGroupsRaw((currentGroups) => {
        let newGroups = currentGroups.map((g) => ({ ...g, sheetIds: [...g.sheetIds] }));

        for (const sheet of freshSheets) {
          const prev = prevColorsRef.current.get(sheet.sheetId);
          const curr = JSON.stringify(sheet.tabColor);
          if (prev === undefined || prev === curr) continue;

          log('pollNativeColors: color changed for', sheet.title);
          changed = true;

          if (sheet.tabColor) {
            const match = nearestColor(sheet.tabColor);
            if (match) {
              // Remove from current group
              newGroups = newGroups.map((g) => ({
                ...g,
                sheetIds: g.sheetIds.filter((id) => id !== sheet.sheetId),
              }));
              // Add to color's group (or create)
              const existing = newGroups.find((g) => g.color === match.hex);
              if (existing) {
                if (!existing.sheetIds.includes(sheet.sheetId)) {
                  existing.sheetIds.push(sheet.sheetId);
                }
              } else {
                newGroups.push({ id: uid(), name: match.name, color: match.hex, collapsed: false, sheetIds: [sheet.sheetId] });
              }
            }
          } else {
            // Color cleared — remove from group
            newGroups = newGroups.map((g) => ({
              ...g,
              sheetIds: g.sheetIds.filter((id) => id !== sheet.sheetId),
            }));
          }
        }

        // Prune empty groups
        newGroups = newGroups.filter((g) => g.sheetIds.length > 0);

        if (changed) {
          prevColorsRef.current = new Map(freshSheets.map((s) => [s.sheetId, JSON.stringify(s.tabColor)]));
          setSheets(freshSheets);
          // Async save — can't await inside setState
          saveGroups(ssId, newGroups, lastSavedRef.current)
            .then((saved) => { lastSavedRef.current = saved; })
            .catch((e) => warn('pollNativeColors save error:', e.message));
          notifyContentScript(tabIdRef.current, newGroups);
        }

        return changed ? newGroups : currentGroups;
      });
    } catch (e) {
      warn('pollNativeColors error:', e.message);
    }
  }

  // ── Init ───────────────────────────────────────────────────────────────────

  useEffect(() => {
    async function init() {
      log('init');
      const { token, error } = await getToken(false);
      log('init: token?', !!token, 'error?', error);
      if (!token) { setView('not-signed-in'); return; }
      await refreshFromActiveTab();

      chrome.tabs.onActivated.addListener(() => refreshFromActiveTab());
      chrome.tabs.onUpdated.addListener((id, info) => {
        if (id === tabIdRef.current && info.url) refreshFromActiveTab();
      });
    }
    init().catch(oops);
    return stopPolling;
  }, []); // eslint-disable-line

  // ── Group operations ───────────────────────────────────────────────────────

  const ungroupedSheets = () => {
    const ids = new Set(groups.flatMap((g) => g.sheetIds));
    return sheets.filter((s) => !ids.has(s.sheetId));
  };

  const createGroup = async (name, colorArg, initialSheetIds = []) => {
    const color = colorArg ?? nextAvailableColor([...usedColors]);
    log('createGroup:', name, color, initialSheetIds);
    const existing = groups.find((g) => g.color === color);
    if (existing) {
      // Merge into existing group (1 group per color)
      const merged = groups.map((g) =>
        g.id === existing.id
          ? { ...g, sheetIds: [...new Set([...g.sheetIds, ...initialSheetIds])] }
          : g
      );
      await persistGroups(merged);
      if (initialSheetIds.length) {
        setNativeTabColors(spreadsheetId, initialSheetIds, color).catch((e) =>
          warn('createGroup setColors error:', e.message)
        );
      }
      showToast(`Added to "${existing.name}"`);
      return;
    }
    const group = { id: uid(), name, color, collapsed: false, sheetIds: initialSheetIds };
    const newGroups = [...groups, group];
    await persistGroups(newGroups);
    if (initialSheetIds.length) {
      setNativeTabColors(spreadsheetId, initialSheetIds, color).catch((e) =>
        warn('createGroup setColors error:', e.message)
      );
    }
  };

  const updateGroups = (newGroups) => persistGroups(newGroups);

  const addToGroup = (sheetId, groupId) => {
    log('addToGroup:', sheetId, '->', groupId);
    const target = groups.find((g) => g.id === groupId);
    if (!target) { warn('addToGroup: group not found', groupId); return; }
    const newGroups = groups.map((g) => ({
      ...g,
      sheetIds: g.id === groupId
        ? [...new Set([...g.sheetIds, sheetId])]
        : g.sheetIds.filter((id) => id !== sheetId),
    }));
    persistGroups(newGroups);
    setNativeTabColors(spreadsheetId, [sheetId], target.color).catch((e) =>
      warn('addToGroup setColor error:', e.message)
    );
  };

  const removeFromGroup = (sheetId) => {
    log('removeFromGroup:', sheetId);
    const newGroups = groups
      .map((g) => ({ ...g, sheetIds: g.sheetIds.filter((id) => id !== sheetId) }))
      .filter((g) => g.sheetIds.length > 0);
    persistGroups(newGroups);
    clearNativeTabColors(spreadsheetId, [sheetId]).catch((e) =>
      warn('removeFromGroup clearColor error:', e.message)
    );
  };

  const deleteGroup = (groupId) => {
    log('deleteGroup:', groupId);
    const group = groups.find((g) => g.id === groupId);
    const sheetIds = group?.sheetIds ?? [];
    const newGroups = groups.filter((g) => g.id !== groupId);
    persistGroups(newGroups);
    if (sheetIds.length) {
      clearNativeTabColors(spreadsheetId, sheetIds).catch((e) =>
        warn('deleteGroup clearColors error:', e.message)
      );
    }
  };

  const renameGroup = (groupId, name) => {
    log('renameGroup:', groupId, '->', name);
    const newGroups = groups.map((g) => (g.id === groupId ? { ...g, name } : g));
    persistGroups(newGroups);
  };

  const changeGroupColor = (groupId, color) => {
    log('changeGroupColor:', groupId, '->', color);
    const conflict = groups.find((g) => g.color === color && g.id !== groupId);
    if (conflict) { showToast(`"${conflict.name}" already uses this color`); return; }
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;
    const newGroups = groups.map((g) => (g.id === groupId ? { ...g, color } : g));
    persistGroups(newGroups);
    setNativeTabColors(spreadsheetId, group.sheetIds, color).catch((e) =>
      warn('changeGroupColor error:', e.message)
    );
  };

  const toggleCollapse = (groupId) => {
    const newGroups = groups.map((g) =>
      g.id === groupId ? { ...g, collapsed: !g.collapsed } : g
    );
    persistGroups(newGroups);
  };

  const importFromTabColors = () => {
    log('importFromTabColors');
    const ungrouped = ungroupedSheets().filter((s) => s.tabColor);
    if (!ungrouped.length) { showToast('No native tab colors found on ungrouped tabs'); return; }
    let created = 0, added = 0;
    let newGroups = [...groups];
    for (const sheet of ungrouped) {
      const match = nearestColor(sheet.tabColor);
      if (!match) continue;
      const existing = newGroups.find((g) => g.color === match.hex);
      if (existing) {
        if (!existing.sheetIds.includes(sheet.sheetId)) {
          existing.sheetIds.push(sheet.sheetId);
          added++;
        }
      } else {
        newGroups.push({ id: uid(), name: match.name, color: match.hex, collapsed: false, sheetIds: [sheet.sheetId] });
        created++;
      }
    }
    if (!created && !added) { showToast('All colored tabs already grouped'); return; }
    persistGroups(newGroups);
    const parts = [created && `${created} created`, added && `${added} added`].filter(Boolean);
    showToast(`Imported: ${parts.join(', ')}`);
  };

  const handleNavigate = (sheetId) => navigateToSheet(tabId, sheetId);

  // ── Render ─────────────────────────────────────────────────────────────────

  if (view === 'loading') {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-gray-400">
          <RefreshCw className="w-6 h-6 animate-spin" />
          <span className="text-sm">Loading…</span>
        </div>
      </div>
    );
  }

  if (view === 'not-sheets') {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center">
        <p className="text-sm text-gray-500 leading-relaxed">
          Open a Google Sheet to manage tab groups.
        </p>
      </div>
    );
  }

  if (view === 'not-signed-in') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="text-sm text-gray-500 leading-relaxed">
          Sign in to enable tab groups.
        </p>
        <button
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-5 py-2 rounded-full transition-colors"
          onClick={async () => {
            const { token } = await getToken(true);
            if (token) refreshFromActiveTab();
          }}
        >
          Sign in with Google
        </button>
      </div>
    );
  }

  // main view
  const usedColors = new Set(groups.map((g) => g.color));

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <header className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-100 flex-shrink-0">
        <span className="flex-1 text-sm font-semibold text-gray-800">Tab Groups</span>

        <button
          onClick={importFromTabColors}
          title="Import from native tab colors"
          className="p-1.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
        >
          <Download className="w-4 h-4" />
        </button>

        <button
          onClick={() => refreshFromActiveTab()}
          title="Refresh"
          className="p-1.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
        </button>

        <button
          onClick={() => setShowNewGroup((v) => !v)}
          title="New group"
          className="flex items-center justify-center w-7 h-7 rounded-full bg-blue-600 hover:bg-blue-700 text-white transition-colors"
        >
          <Plus className="w-4 h-4" />
        </button>
      </header>

      {/* New group form */}
      {showNewGroup && (
        <NewGroupForm
          usedColors={usedColors}
          defaultColor={nextAvailableColor([...usedColors])}
          onCancel={() => setShowNewGroup(false)}
          onCreate={(name, color) => {
            setShowNewGroup(false);
            createGroup(name, color);
          }}
        />
      )}

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        <GroupList
          groups={groups}
          sheets={sheets}
          usedColors={usedColors}
          onUpdateGroups={updateGroups}
          onAddToGroup={addToGroup}
          onRemoveFromGroup={removeFromGroup}
          onDeleteGroup={deleteGroup}
          onRenameGroup={renameGroup}
          onChangeColor={changeGroupColor}
          onToggleCollapse={toggleCollapse}
          onNavigate={handleNavigate}
        />

        <UngroupedSection
          sheets={ungroupedSheets()}
          groups={groups}
          onAddToGroup={addToGroup}
          onNavigate={handleNavigate}
          onCreateGroup={createGroup}
        />
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-xs px-4 py-2 rounded-full shadow-lg pointer-events-none whitespace-nowrap z-50 animate-in fade-in slide-in-from-bottom-2 duration-200">
          {toast}
        </div>
      )}
    </div>
  );
}
