import { useState, useEffect } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import {
  GripVertical, ChevronDown, ChevronRight,
  Pencil, Trash2, Check, X,
} from 'lucide-react';
import { COLORS } from '../lib/colors';

const log = (...a) => console.log('[STG list]', ...a);

// ── Drag overlay previews ──────────────────────────────────────────────────────

function GroupOverlayPreview({ group }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-white rounded-lg shadow-xl border border-blue-200 opacity-90 w-64">
      <GripVertical className="w-3.5 h-3.5 text-gray-300" />
      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: group.color }} />
      <span className="text-sm font-medium text-gray-800 truncate flex-1">{group.name}</span>
      <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">{group.sheetIds.length}</span>
    </div>
  );
}

function TabOverlayPreview({ sheetId, sheets, groups }) {
  const sheet = sheets.find((s) => s.sheetId === sheetId);
  const group = groups.find((g) => g.sheetIds.includes(sheetId));
  if (!sheet) return null;
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-white rounded-lg shadow-xl border border-blue-200 opacity-90 w-52">
      <div className="w-0.5 h-4 rounded-full flex-shrink-0" style={{ background: group?.color ?? '#9ca3af' }} />
      <span className="text-xs text-gray-700 truncate">{sheet.title}</span>
    </div>
  );
}

// ── Draggable tab row ──────────────────────────────────────────────────────────

function DraggableTabRow({ sheetId, sheets, groupColor, fromGroupId, onNavigate, onRemove }) {
  const sheet = sheets.find((s) => s.sheetId === sheetId);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `tab-${sheetId}`,
    data: { type: 'tab', sheetId, fromGroupId },
  });

  if (!sheet) return null;

  return (
    <div
      ref={setNodeRef}
      className={`group flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-md transition-all ${isDragging ? 'opacity-30' : 'hover:bg-gray-50'}`}
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

      {/* color bar */}
      <div className="w-0.5 h-4 rounded-full flex-shrink-0" style={{ background: groupColor }} />

      {/* name */}
      <span
        className="flex-1 text-xs text-gray-700 truncate cursor-pointer hover:text-blue-600 hover:underline"
        onClick={() => onNavigate(sheetId)}
        title={sheet.title}
      >
        {sheet.title}
      </span>

      {/* remove button */}
      <button
        onClick={(e) => { e.stopPropagation(); onRemove(sheetId); }}
        className="flex-shrink-0 opacity-0 group-hover:opacity-100 p-0.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 transition-all"
        title="Remove from group"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

// ── Sortable group item ────────────────────────────────────────────────────────

function SortableGroupItem({
  group, sheets, usedColors, activeDragType,
  onAddToGroup, onRemoveFromGroup, onDeleteGroup,
  onRenameGroup, onChangeColor, onToggleCollapse, onNavigate,
}) {
  const [renaming, setRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState('');
  const [showColorPicker, setShowColorPicker] = useState(false);

  const {
    attributes, listeners, setNodeRef, setActivatorNodeRef,
    transform, transition, isDragging,
  } = useSortable({
    id: group.id,
    data: { type: 'group', groupId: group.id },
  });

  // This group also acts as a drop zone for tab drags
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `drop-group-${group.id}`,
    data: { type: 'group-drop', groupId: group.id },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const startRename = () => {
    setRenameVal(group.name);
    setRenaming(true);
  };

  const commitRename = () => {
    const trimmed = renameVal.trim();
    if (trimmed && trimmed !== group.name) onRenameGroup(group.id, trimmed);
    setRenaming(false);
  };

  const groupSheets = group.sheetIds
    .map((id) => sheets.find((s) => s.sheetId === id))
    .filter(Boolean);

  const isTabDragOver = activeDragType === 'tab' && isOver;

  return (
    <div
      ref={(node) => { setNodeRef(node); setDropRef(node); }}
      style={style}
      className={`mb-0.5 rounded-lg transition-all ${isDragging ? 'opacity-40' : ''} ${isTabDragOver ? 'ring-2 ring-blue-400 ring-inset bg-blue-50/40' : ''}`}
    >
      {/* Group header */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg hover:bg-gray-50 group/header">

        {/* Drag handle for group reorder */}
        <button
          ref={setActivatorNodeRef}
          {...listeners}
          {...attributes}
          className="flex-shrink-0 text-gray-200 hover:text-gray-400 cursor-grab active:cursor-grabbing touch-none p-0.5"
          tabIndex={-1}
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="w-3.5 h-3.5" />
        </button>

        {/* Color dot */}
        <div className="relative flex-shrink-0">
          <button
            className="w-3 h-3 rounded-full hover:scale-125 transition-transform"
            style={{ background: group.color }}
            title="Change color"
            onClick={(e) => { e.stopPropagation(); setShowColorPicker((v) => !v); }}
          />
          {showColorPicker && (
            <ColorPickerPopup
              currentColor={group.color}
              usedColors={usedColors}
              groupId={group.id}
              onSelect={(hex) => { onChangeColor(group.id, hex); setShowColorPicker(false); }}
              onClose={() => setShowColorPicker(false)}
            />
          )}
        </div>

        {/* Group name / rename input */}
        {renaming ? (
          <input
            className="flex-1 min-w-0 text-sm font-medium bg-transparent border-b-2 border-blue-500 outline-none text-gray-800"
            value={renameVal}
            autoFocus
            onChange={(e) => setRenameVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
              if (e.key === 'Escape') setRenaming(false);
              e.stopPropagation();
            }}
            onBlur={commitRename}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span
            className="flex-1 min-w-0 text-sm font-medium text-gray-800 truncate select-none"
          >
            {group.name}
          </span>
        )}

        {/* Tab count */}
        <span className="flex-shrink-0 text-xs text-gray-400 tabular-nums">{group.sheetIds.length}</span>

        {/* Pencil icon */}
        {renaming ? (
          <button onClick={commitRename} className="flex-shrink-0 p-1 rounded text-green-500 hover:bg-green-50">
            <Check className="w-3.5 h-3.5" />
          </button>
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); startRename(); }}
            className="flex-shrink-0 p-1 rounded text-gray-300 hover:text-gray-600 hover:bg-gray-100 opacity-0 group-hover/header:opacity-100 transition-all"
            title="Rename"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Trash icon */}
        <button
          onClick={(e) => { e.stopPropagation(); onDeleteGroup(group.id); }}
          className="flex-shrink-0 p-1 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover/header:opacity-100 transition-all"
          title="Delete group"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>

        {/* Collapse toggle */}
        <button
          onClick={(e) => { e.stopPropagation(); onToggleCollapse(group.id); }}
          className="flex-shrink-0 p-1 rounded text-gray-300 hover:text-gray-600 hover:bg-gray-100 transition-all"
          title={group.collapsed ? 'Expand' : 'Collapse'}
        >
          {group.collapsed
            ? <ChevronRight className="w-3.5 h-3.5" />
            : <ChevronDown className="w-3.5 h-3.5" />
          }
        </button>
      </div>

      {/* Tab list */}
      {!group.collapsed && (
        <div className="pl-5 pb-1">
          {groupSheets.map((sheet) => (
            <DraggableTabRow
              key={sheet.sheetId}
              sheetId={sheet.sheetId}
              sheets={sheets}
              groupColor={group.color}
              fromGroupId={group.id}
              onNavigate={onNavigate}
              onRemove={onRemoveFromGroup}
            />
          ))}
          {groupSheets.length === 0 && (
            <p className="text-xs text-gray-400 italic px-2 py-1">No tabs — drag one here</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Inline color picker popup ──────────────────────────────────────────────────

function ColorPickerPopup({ currentColor, usedColors, groupId, onSelect, onClose }) {
  useEffect(() => {
    const handler = (e) => {
      if (!e.target.closest(`[data-color-picker="${groupId}"]`)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [groupId, onClose]);

  return (
    <div
      data-color-picker={groupId}
      className="absolute left-0 top-5 z-50 bg-white rounded-xl shadow-xl border border-gray-100 p-2.5 flex flex-wrap gap-1.5 w-36"
    >
      {COLORS.map((c) => {
        const taken = usedColors.has(c.hex) && c.hex !== currentColor;
        return (
          <button
            key={c.hex}
            title={taken ? `${c.name} (in use)` : c.name}
            onClick={() => !taken && onSelect(c.hex)}
            className={`w-5 h-5 rounded-full border-2 transition-transform ${
              c.hex === currentColor ? 'border-gray-800 scale-110' : 'border-transparent'
            } ${taken ? 'opacity-25 cursor-not-allowed' : 'hover:scale-125 cursor-pointer'}`}
            style={{ background: c.hex }}
          />
        );
      })}
    </div>
  );
}

// ── GroupList root ─────────────────────────────────────────────────────────────

export default function GroupList({
  groups, sheets, usedColors,
  onUpdateGroups, onAddToGroup, onRemoveFromGroup,
  onDeleteGroup, onRenameGroup, onChangeColor,
  onToggleCollapse, onNavigate,
}) {
  const [activeId,       setActiveId]       = useState(null);
  const [activeData,     setActiveData]     = useState(null);
  const [activeDragType, setActiveDragType] = useState(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const handleDragStart = ({ active }) => {
    log('dragStart:', active.id, active.data.current);
    setActiveId(active.id);
    setActiveData(active.data.current);
    setActiveDragType(active.data.current?.type ?? null);
  };

  const handleDragEnd = ({ active, over }) => {
    log('dragEnd: active', active.id, 'over', over?.id);
    setActiveId(null);
    setActiveData(null);
    setActiveDragType(null);

    if (!over) return;

    const type = active.data.current?.type;

    if (type === 'group') {
      const oldIdx = groups.findIndex((g) => g.id === active.id);
      const newIdx = groups.findIndex((g) => g.id === over.id);
      if (oldIdx !== newIdx && oldIdx >= 0 && newIdx >= 0) {
        onUpdateGroups(arrayMove(groups, oldIdx, newIdx));
      }
      return;
    }

    if (type === 'tab') {
      const { sheetId, fromGroupId } = active.data.current;
      const overId = over.id;

      if (overId === 'ungrouped-drop') {
        if (fromGroupId !== null) onRemoveFromGroup(sheetId);
        return;
      }

      // dropped on a group drop zone
      const targetGroupId = overId.startsWith('drop-group-')
        ? overId.replace('drop-group-', '')
        : overId;

      const targetGroup = groups.find((g) => g.id === targetGroupId);
      if (targetGroup && targetGroupId !== fromGroupId) {
        onAddToGroup(sheetId, targetGroupId);
      }
    }
  };

  const handleDragCancel = () => {
    setActiveId(null);
    setActiveData(null);
    setActiveDragType(null);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <SortableContext items={groups.map((g) => g.id)} strategy={verticalListSortingStrategy}>
        <div className="px-2 pt-2">
          {groups.map((group) => (
            <SortableGroupItem
              key={group.id}
              group={group}
              sheets={sheets}
              usedColors={usedColors}
              activeDragType={activeDragType}
              onAddToGroup={onAddToGroup}
              onRemoveFromGroup={onRemoveFromGroup}
              onDeleteGroup={onDeleteGroup}
              onRenameGroup={onRenameGroup}
              onChangeColor={onChangeColor}
              onToggleCollapse={onToggleCollapse}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      </SortableContext>

      <DragOverlay dropAnimation={{ duration: 150, easing: 'ease' }}>
        {activeId && activeData?.type === 'group' && (
          <GroupOverlayPreview group={groups.find((g) => g.id === activeId)} />
        )}
        {activeId && activeData?.type === 'tab' && (
          <TabOverlayPreview sheetId={activeData.sheetId} sheets={sheets} groups={groups} />
        )}
      </DragOverlay>
    </DndContext>
  );
}
