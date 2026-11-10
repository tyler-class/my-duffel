import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { layoutGroups } from '@shared/logic';
import { DragActive } from '../lib/dragActive';
import { cx } from './ui';

const LOOSE = '';
const rowId = (id: string) => `r:${id}`;
const groupId = (c: string) => `g:${c}`;
const boxId = (key: string) => `c:${key}`;

interface Lists {
  /** Group names in display order. */
  order: string[];
  /** Container ('' = no group, else a group name) → row ids. */
  rows: Record<string, string[]>;
}

type Sortable = { id: string; category: string | null };

function listsFrom(rows: Sortable[], saved: readonly string[], defaults: readonly string[]): Lists {
  const l = layoutGroups(rows, saved, defaults);
  const out: Lists = { order: l.groups.map((g) => g.category), rows: {} };
  out.rows[LOOSE] = l.loose.map((r) => r.id);
  for (const g of l.groups) out.rows[g.category] = g.rows.map((r) => r.id);
  return out;
}

function containerOf(lists: Lists, id: string): string | undefined {
  if (id.startsWith('c:') || id.startsWith('g:')) {
    const key = id.slice(2);
    return key in lists.rows ? key : undefined;
  }
  const r = id.slice(2);
  return Object.keys(lists.rows).find((k) => lists.rows[k]!.includes(r));
}

const flatten = (l: Lists) => [
  ...l.rows[LOOSE]!.map((id) => ({ id, category: null })),
  ...l.order.flatMap((c) => (l.rows[c] ?? []).map((id) => ({ id, category: c }))),
];

// Rows go to the row under the pointer, else the group box under it, else the nearest.
// Groups only trade places with groups.
const baseCollision: CollisionDetection = (args) => {
  const kind = String(args.active.id).slice(0, 2);
  const of = (p: string) => args.droppableContainers.filter((c) => String(c.id).startsWith(p));
  if (kind === 'g:') return closestCenter({ ...args, droppableContainers: of('g:') });
  const rows = of('r:');
  const boxes = of('c:');
  const onRow = pointerWithin({ ...args, droppableContainers: rows });
  if (onRow.length) return onRow;
  const inBox = pointerWithin({ ...args, droppableContainers: boxes });
  if (inBox.length) return inBox;
  return closestCenter({ ...args, droppableContainers: [...rows, ...boxes] });
};

// A mouse drag ends with a click on whatever is under the pointer; swallow it.
let quietUntil = 0;

/**
 * A list of rows split into item groups (categories): rows with no group first, then
 * each group under a small heading. Rows and whole groups can be dragged into a new
 * order (long-press on touch screens); a row dropped in another group joins it.
 */
export function SortableGroups<T extends Sortable>(props: {
  rows: T[];
  /** The list's saved group order. */
  saved: readonly string[];
  /** Default group order for groups not saved yet. */
  defaults: readonly string[];
  disabled?: boolean;
  renderRow: (row: T) => ReactNode;
  renderHeader: (category: string, rows: T[], collapsed: boolean) => ReactNode;
  /** Folded groups show only their heading. Tapping a heading folds or unfolds it. */
  isCollapsed?: (category: string) => boolean;
  onToggle?: (category: string) => void;
  /** New order (and groups) of the rows shown. */
  onRowsChange: (next: { id: string; category: string | null }[]) => void;
  /** New order of the groups shown. */
  onGroupsChange: (order: string[]) => void;
}) {
  const { rows, saved, defaults } = props;
  const base = useMemo(() => listsFrom(rows, saved, defaults), [rows, saved, defaults]);
  const [drag, setDrag] = useState<{ active: string; lists: Lists } | null>(null);
  // When a row jumps to another group the layout shifts under the pointer. Hold the
  // drop target for a frame so that shift doesn't count as a new move.
  const settling = useRef(false);
  const lastOver = useRef<string | number | null>(null);
  useEffect(() => {
    const f = requestAnimationFrame(() => (settling.current = false));
    return () => cancelAnimationFrame(f);
  }, [drag]);
  const collision = useCallback<CollisionDetection>((args) => {
    if (settling.current && lastOver.current !== null) return [{ id: lastOver.current }];
    const hits = baseCollision(args);
    if (hits[0]) lastOver.current = hits[0].id;
    return hits;
  }, []);
  const lists = drag?.lists ?? base;
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 280, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragStart(e: DragStartEvent) {
    setDrag({ active: String(e.active.id), lists: base });
    navigator.vibrate?.(10);
  }

  // Moving a row over another group puts it in that group straight away, so the
  // drop slot shows where it will land.
  function onDragOver(e: DragOverEvent) {
    const active = String(e.active.id);
    const overNode = e.over;
    if (!active.startsWith('r:') || !overNode) return;
    const over = String(overNode.id);
    const translated = e.active.rect.current.translated;
    setDrag((d) => {
      if (!d) return d;
      const from = containerOf(d.lists, active);
      const to = containerOf(d.lists, over);
      if (from === undefined || to === undefined || from === to) return d;
      const id = active.slice(2);
      const target = d.lists.rows[to]!;
      const overIndex = over.startsWith('r:') ? target.indexOf(over.slice(2)) : -1;
      const below = !!translated && translated.top > overNode.rect.top + overNode.rect.height / 2;
      const at = overIndex >= 0 ? overIndex + (below ? 1 : 0) : target.length;
      settling.current = true;
      const next = { ...d.lists.rows };
      next[from] = next[from]!.filter((x) => x !== id);
      next[to] = [...target.slice(0, at), id, ...target.slice(at)];
      return { ...d, lists: { ...d.lists, rows: next } };
    });
  }

  function onDragEnd(e: DragEndEvent) {
    quietUntil = Date.now() + 300;
    const active = String(e.active.id);
    const over = e.over ? String(e.over.id) : null;
    const l = drag?.lists ?? base;
    setDrag(null);
    if (active.startsWith('g:')) {
      const to = over ? containerOf(l, over) : undefined;
      const a = l.order.indexOf(active.slice(2));
      const b = to ? l.order.indexOf(to) : -1;
      if (a >= 0 && b >= 0 && a !== b) props.onGroupsChange(arrayMove(l.order, a, b));
      return;
    }
    let final = l;
    const box = containerOf(l, active);
    if (over && box !== undefined && over.startsWith('r:') && containerOf(l, over) === box) {
      const list = l.rows[box]!;
      const a = list.indexOf(active.slice(2));
      const b = list.indexOf(over.slice(2));
      if (a !== b) final = { ...l, rows: { ...l.rows, [box]: arrayMove(list, a, b) } };
    }
    const next = flatten(final);
    const before = flatten(base);
    if (next.some((r, i) => r.id !== before[i]?.id || r.category !== before[i]?.category))
      props.onRowsChange(next);
  }

  const activeRow = drag?.active.startsWith('r:') ? byId.get(drag.active.slice(2)) : undefined;
  const activeGroup = drag?.active.startsWith('g:') ? drag.active.slice(2) : undefined;
  const draggingRow = !!activeRow;

  return (
    <DragActive.Provider value={!!drag}>
      <div
        onClickCapture={(e) => {
          if (Date.now() < quietUntil) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
      >
        <DndContext
          sensors={sensors}
          collisionDetection={collision}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
          onDragCancel={() => setDrag(null)}
          measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
          autoScroll={{ threshold: { x: 0, y: 0.12 }, acceleration: 5 }}
        >
          <Box id={LOOSE} rows={lists.rows[LOOSE]!} grow={draggingRow}>
            {lists.rows[LOOSE]!.map((id) => {
              const r = byId.get(id);
              return r ? (
                <SortableRow key={id} id={id} disabled={props.disabled}>
                  {props.renderRow(r)}
                </SortableRow>
              ) : null;
            })}
          </Box>
          <SortableContext items={lists.order.map(groupId)} strategy={verticalListSortingStrategy}>
            {lists.order.map((c) => {
              const groupRows = (lists.rows[c] ?? [])
                .map((id) => byId.get(id))
                .filter((r): r is T => !!r);
              return (
                <SortableGroup
                  key={c}
                  category={c}
                  disabled={props.disabled}
                  header={props.renderHeader(c, groupRows, !!props.isCollapsed?.(c))}
                  expanded={!props.isCollapsed?.(c)}
                  onToggle={props.onToggle && (() => props.onToggle!(c))}
                >
                  {/* While a group moves, groups fold to their headings so they swap cleanly. */}
                  <Box id={c} rows={lists.rows[c] ?? []} grow={draggingRow}>
                    {!activeGroup &&
                      !props.isCollapsed?.(c) &&
                      groupRows.map((r) => (
                        <SortableRow key={r.id} id={r.id} disabled={props.disabled}>
                          {props.renderRow(r)}
                        </SortableRow>
                      ))}
                  </Box>
                </SortableGroup>
              );
            })}
          </SortableContext>
          <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(.2,.7,.3,1)' }}>
            {activeRow ? (
              <div className="rounded-xl bg-surface shadow-xl ring-1 ring-line">
                {props.renderRow(activeRow)}
              </div>
            ) : activeGroup ? (
              <div className="rounded-xl bg-surface px-1 shadow-xl ring-1 ring-line">
                {props.renderHeader(
                  activeGroup,
                  (lists.rows[activeGroup] ?? [])
                    .map((id) => byId.get(id))
                    .filter((r): r is T => !!r),
                  !!props.isCollapsed?.(activeGroup),
                )}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>
    </DragActive.Provider>
  );
}

/** Where rows can be dropped: the ungrouped rows, or one group's rows. */
function Box({
  id,
  rows,
  grow,
  children,
}: {
  id: string;
  rows: string[];
  grow: boolean;
  children: ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id: boxId(id) });
  return (
    <SortableContext items={rows.map(rowId)} strategy={verticalListSortingStrategy}>
      <div
        ref={setNodeRef}
        className={cx(
          id === LOOSE ? 'min-h-3' : 'pl-4',
          // An emptied group keeps a little room so the row can go back.
          grow && !rows.length && id !== LOOSE && 'min-h-10',
        )}
      >
        {children}
      </div>
    </SortableContext>
  );
}

const SLOT =
  "after:pointer-events-none after:absolute after:inset-0.5 after:rounded-xl after:border-2 after:border-dashed after:border-accent/70 after:bg-accent-tint/40 after:content-['']";

function SortableRow({
  id,
  disabled,
  children,
}: {
  id: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: rowId(id),
    disabled,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      // Drag attributes only while dragging is on; otherwise the row would read as disabled.
      {...(disabled ? {} : attributes)}
      // The row holds its own buttons, so the wrapper is a group, not a button.
      role="group"
      {...listeners}
      tabIndex={disabled ? undefined : attributes.tabIndex}
      className={cx(
        'relative touch-manipulation outline-none select-none [-webkit-touch-callout:none]',
        isDragging && SLOT,
      )}
    >
      <div className={cx(isDragging && 'invisible')}>{children}</div>
    </div>
  );
}

function SortableGroup({
  category,
  header,
  disabled,
  expanded,
  onToggle,
  children,
}: {
  category: string;
  header: ReactNode;
  disabled?: boolean;
  expanded: boolean;
  onToggle?: () => void;
  children: ReactNode;
}) {
  const {
    setNodeRef,
    setActivatorNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: groupId(category), disabled });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cx('relative', isDragging && SLOT)}
    >
      <div className={cx(isDragging && 'invisible')}>
        <div
          ref={setActivatorNodeRef}
          {...(disabled ? {} : attributes)}
          {...listeners}
          tabIndex={disabled ? undefined : attributes.tabIndex}
          aria-expanded={onToggle ? expanded : undefined}
          onClick={onToggle}
          className={cx(
            'touch-manipulation outline-none select-none [-webkit-touch-callout:none]',
            onToggle ? 'cursor-pointer' : !disabled && 'cursor-grab',
          )}
        >
          {header}
        </div>
        {children}
      </div>
    </div>
  );
}
