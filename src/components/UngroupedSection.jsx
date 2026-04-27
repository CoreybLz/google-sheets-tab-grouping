import { useState, useEffect } from 'react';
import { useDroppable, useDraggable } from '@dnd-kit/core';
import { GripVertical, Plus, ChevronDown, ChevronRight } from 'lucide-react';

// ── Draggable ungrouped tab ────────────────────────────────────────────────────

function UngroupedTabRow({ sheet, groups, onAddToGroup, onNavigate, onCreateGroup }) {
  const [showMenu, setShowMenu] = useState(false);

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `tab-${sheet.sheetId}`,
    data: { type: 'tab', sheetId: sheet.sheetId, fromGroupId: null },
  });

  return (
    <div
      ref={setNodeRef}
      className={`group flex items-center gap-2 px-2 py-1.5 rounded-md transition-all ${isDragging ? 'opacity-30' : 'hover:bg-gray-50'}`}
    >
      {/* drag handle */}
      <button
        {...listeners}
        {...attributes}
        className="flex-shrink-0 text-gray-200 hover:text-gray-400 cursor-grab active:cursor-grabbing p-0.5 touch-none"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical className="w-3 h-3" />
      </button>

      {/* tab name */}
      <span
        className="flex-1 min-w-0 text-sm text-gray-700 truncate cursor-pointer hover:text-blue-600 hover:underline"
        onClick={() => onNavigate(sheet.sheetId)}
        title={sheet.title}
      >
        {sheet.title}
      </span>

      {/* Add to group button */}
      <div className="relative flex-shrink-0">
        <button
          onClick={(e) => { e.stopPropagation(); setShowMenu((v) => !v); }}
          className="opacity-0 group-hover:opacity-100 flex items-center gap-1 text-xs text-gray-500 border border-gray-200 rounded-full px-2 py-0.5 hover:border-gray-400 hover:text-gray-700 transition-all"
          title="Add to group"
        >
          <Plus className="w-3 h-3" />
          Group
        </button>

        {showMenu && (
          <AddToGroupMenu
            groups={groups}
            onSelect={(groupId) => { onAddToGroup(sheet.sheetId, groupId); setShowMenu(false); }}
            onCreateNew={() => { onCreateGroup(sheet.sheetId); setShowMenu(false); }}
            onClose={() => setShowMenu(false)}
          />
        )}
      </div>
    </div>
  );
}

// ── Inline dropdown for adding to group ───────────────────────────────────────

function AddToGroupMenu({ groups, onSelect, onCreateNew, onClose }) {
  useEffect(() => {
    const handler = (e) => {
      if (!e.target.closest('[data-add-menu]')) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div
      data-add-menu
      className="absolute right-0 top-7 z-50 bg-white rounded-xl shadow-xl border border-gray-100 py-1 min-w-36 max-w-48"
    >
      {groups.length > 0 ? (
        <>
          {groups.map((g) => (
            <button
              key={g.id}
              onClick={() => onSelect(g.id)}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 text-left"
            >
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: g.color }} />
              <span className="truncate">{g.name}</span>
            </button>
          ))}
          <div className="border-t border-gray-100 mt-1 pt-1">
            <button
              onClick={onCreateNew}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 text-left"
            >
              <Plus className="w-3.5 h-3.5" />
              New group
            </button>
          </div>
        </>
      ) : (
        <button
          onClick={onCreateNew}
          className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 text-left"
        >
          <Plus className="w-3.5 h-3.5" />
          New group
        </button>
      )}
    </div>
  );
}

// ── Ungrouped section ──────────────────────────────────────────────────────────

export default function UngroupedSection({ sheets, groups, onAddToGroup, onNavigate, onCreateGroup }) {
  const [collapsed, setCollapsed] = useState(false);

  const { setNodeRef, isOver } = useDroppable({
    id: 'ungrouped-drop',
    data: { type: 'ungrouped-drop' },
  });

  if (sheets.length === 0) return null;


  return (
    <div
      ref={setNodeRef}
      className={`mx-2 mt-1 rounded-lg transition-all ${isOver ? 'ring-2 ring-blue-300 ring-inset bg-blue-50/30' : ''}`}
    >
      {/* Section header */}
      <button
        className="flex items-center gap-1.5 w-full px-2 py-1.5 text-left"
        onClick={() => setCollapsed((v) => !v)}
      >
        {collapsed
          ? <ChevronRight className="w-3 h-3 text-gray-400" />
          : <ChevronDown className="w-3 h-3 text-gray-400" />
        }
        <span className="text-xs font-semibold text-gray-400 tracking-wider uppercase">
          Ungrouped
        </span>
        <span className="text-xs text-gray-300 ml-1">{sheets.length}</span>
      </button>

      {!collapsed && (
        <div className="pb-2">
          {sheets.map((sheet) => (
            <UngroupedTabRow
              key={sheet.sheetId}
              sheet={sheet}
              groups={groups}
              onAddToGroup={onAddToGroup}
              onNavigate={onNavigate}
              onCreateGroup={(sheetId) => onCreateGroup('New Group', null, [sheetId])}
            />
          ))}
          {isOver && (
            <p className="text-xs text-blue-500 italic px-4 py-1">Drop here to ungroup</p>
          )}
        </div>
      )}
    </div>
  );
}
