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
import { CSS as DndCSS } from '@dnd-kit/utilities';
import { useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { SectionKind } from '@shared/lookups';
import {
  connections,
  dayNumber,
  dayShift,
  entryMinutes,
  entryName,
  formatMinutes,
  orderEntries,
  sortSections,
  type tripStage,
  itineraryRows,
  sectionDays,
  type ItineraryRow,
} from '@shared/logic';
import type { EntryEnd, ItineraryEntry, ItinerarySection, TripDetail } from '@shared/types';
import { api, errorMessage } from '../lib/api';
import { deliverPdf, itineraryPdf, openPdfTab, preparePdf, sharesPdf } from '../lib/printItinerary';
import { DragActive } from '../lib/dragActive';
import { formatDay, formatRange } from '../lib/format';
import { deviceZone, formatClock, homeTime, likelyZone, zoneName } from '../lib/itinerary';
import { load, save } from '../lib/storage';
import { keys } from '../lib/queries';
import { draftOf, EntrySheet, KIND_ICONS, MODE_ICONS, type EntryDraft } from './EntrySheet';
import { Icon, type IconName } from './Icon';
import { SwipeRow } from './SwipeRow';
import { useToast } from './Toast';
import {
  cx,
  DangerButton,
  ErrorText,
  FieldRow,
  GhostButton,
  IconButton,
  PrimaryButton,
  Sheet,
  SlideToggle,
  TextInput,
} from './ui';

type Stage = ReturnType<typeof tripStage>;
type Clock = 'local' | 'home';
const DAY = 86_400_000;

/** "9:40 PM", or in home time "6:40 PM" with the day when it moves. */
/**
 * "9:40 PM", or in home time "6:40 PM" with the day when it moves. `bare`: no day in home
 * time (a transport's arrival shows "+1" instead).
 */
function timeText(e: EntryEnd, clock: Clock, bare = false): string {
  if (!e.time) return '';
  if (clock === 'home') {
    const h = homeTime(e);
    if (h)
      return `${formatClock(h.time)}${!bare && h.date !== e.date ? ` (${formatDay(h.date)})` : ''}`;
  }
  return formatClock(e.time);
}

/** Days from departure to arrival, by the clock being shown: the "+1" on an overnight trip. */
function shownShift(e: ItineraryEntry, clock: Clock): number {
  if (clock === 'home') {
    const a = homeTime(e.start);
    const b = homeTime(e.end);
    if (a && b) return (dayNumber(b.date) ?? 0) - (dayNumber(a.date) ?? 0);
  }
  return dayShift(e);
}

function sectionDates(s: ItinerarySection): string {
  const d = sectionDays(s);
  return d ? formatRange(d[0], d[1]) : '';
}

function copy(text: string, toast: ReturnType<typeof useToast>) {
  void navigator.clipboard
    ?.writeText(text)
    .then(() => toast({ text: `Copied ${text}` }))
    .catch(() => undefined);
}

type Row = ItineraryRow;
const rowsOf = itineraryRows;

const sectionKey = (id: string) => `s:${id}`;
const entryKey = (id: string) => `e:${id}`;
const boxKey = (id: string) => `b:${id}`;
type Lists = Record<string, string[]>;

// Sections trade places with sections. Entries go to the entry under the pointer, else the
// section under it, else the nearest.
const baseCollision: CollisionDetection = (args) => {
  const kind = String(args.active.id).slice(0, 2);
  const of = (p: string) => args.droppableContainers.filter((c) => String(c.id).startsWith(p));
  if (kind === 's:') return closestCenter({ ...args, droppableContainers: of('s:') });
  const rows = of('e:');
  const boxes = of('b:');
  const onRow = pointerWithin({ ...args, droppableContainers: rows });
  if (onRow.length) return onRow;
  const inBox = pointerWithin({ ...args, droppableContainers: boxes });
  if (inBox[0]) {
    // Between lines (a day heading, a gap): the nearest line in that section.
    const box = String(inBox[0].id).slice(2);
    const near = rows.filter((r) => r.data.current?.box === box);
    return near.length ? closestCenter({ ...args, droppableContainers: near }) : inBox;
  }
  return closestCenter({ ...args, droppableContainers: [...rows, ...boxes] });
};

const boxOf = (lists: Lists, id: string) =>
  id.startsWith('b:')
    ? id.slice(2)
    : Object.keys(lists).find((k) => lists[k]!.includes(id.slice(2)));

/** A trip's itinerary: sections in order, with transport, lodging, plans and notes. */
export function TripItinerary({ detail, stage }: { detail: TripDetail; stage: Stage }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState('');
  const [sectionSheet, setSectionSheet] = useState<{
    section?: ItinerarySection;
    kind: SectionKind;
  } | null>(null);
  const [entrySheet, setEntrySheet] = useState<{
    section: ItinerarySection;
    entry?: ItineraryEntry;
  } | null>(null);
  const [clock, setClockRaw] = useState<Clock>(() => load('itineraryClock', 'local'));
  const setClock = (c: Clock) => (setClockRaw(c), save('itineraryClock', c));
  // While something is dragged: what, and (for an entry) each section's entries so far.
  const [drag, setDrag] = useState<{ active: string; lists: Lists } | null>(null);
  // A drag ends with a click on whatever is under the pointer; swallow it.
  const quiet = useRef(false);
  // When an entry jumps to another section the layout shifts under the pointer. Hold the
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
  const tripId = detail.trip.id;
  const [making, setMaking] = useState(false);
  const hasSections = detail.itinerary.length > 0;
  // Phones share the PDF, which needs the tap that started it: load the PDF maker ahead of
  // time (once there's something to print) so building it is quick.
  useEffect(() => {
    if (!hasSections || !sharesPdf()) return;
    const t = setTimeout(() => void preparePdf().catch(() => undefined), 1500);
    return () => clearTimeout(t);
  }, [hasSections]);
  const key = keys.trip(tripId);
  const sections = sortSections(detail.itinerary);
  const here = deviceZone();
  const otherZones = sections.some((s) =>
    s.entries.some((e) => [e.start.tz, e.end.tz].some((z) => z && z !== here)),
  );
  const [now] = useState(() => Date.now());
  const byId = new Map(sections.flatMap((s) => s.entries.map((e) => [e.id, e] as const)));
  const ordered = new Map(sections.map((s) => [s.id, orderEntries(s.entries)]));
  const baseLists: Lists = Object.fromEntries(
    [...ordered].map(([id, list]) => [id, list.map((e) => e.id)]),
  );
  // During a drag, entries show where they've been dragged to so far.
  const entriesOf = (id: string): ItineraryEntry[] =>
    drag?.active.startsWith('e:')
      ? (drag.lists[id] ?? []).map((x) => byId.get(x)!).filter(Boolean)
      : ordered.get(id)!;
  const rowsBySection = new Map(sections.map((s) => [s.id, rowsOf(entriesOf(s.id))]));
  const activeEntry = drag?.active.startsWith('e:') ? byId.get(drag.active.slice(2)) : undefined;

  // "Next": the first line not over yet, once it's close (during the trip, or within two days).
  let next: string | null = null;
  if (stage !== 'after')
    for (const s of sections) {
      const r = rowsBySection.get(s.id)!.find((x) => x.until !== Infinity && x.until >= now);
      if (r) {
        if (stage === 'during' || r.from - now < 2 * DAY) next = r.key;
        break;
      }
    }
  const nextRef = useRef<HTMLDivElement>(null);
  const [params, setParams] = useSearchParams();
  const day = params.get('day');
  useEffect(() => {
    if (day) return; // a notification's day wins (below)
    if (stage === 'during') nextRef.current?.scrollIntoView({ block: 'center' });
  }, [stage, day]);
  // A notification's link: ?day=YYYY-MM-DD scrolls to that day (once).
  useEffect(() => {
    if (!day) return;
    document.querySelector(`[data-day="${CSS.escape(day)}"]`)?.scrollIntoView({ block: 'start' });
    const next = new URLSearchParams(params);
    next.delete('day');
    setParams(next, { replace: true });
  }, [day, params, setParams]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 280, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function send(fn: () => Promise<TripDetail>) {
    setError('');
    try {
      qc.setQueryData(key, await fn());
    } catch (e) {
      setError(errorMessage(e));
      qc.invalidateQueries({ queryKey: key });
    }
  }

  function onDragStart(e: DragStartEvent) {
    setDrag({ active: String(e.active.id), lists: baseLists });
    navigator.vibrate?.(10);
  }

  // An entry dragged over another section joins it straight away, so the gap shows where
  // it will land.
  function onDragOver(e: DragOverEvent) {
    const active = String(e.active.id);
    const overNode = e.over;
    if (!active.startsWith('e:') || !overNode) return;
    const over = String(overNode.id);
    const translated = e.active.rect.current.translated;
    setDrag((d) => {
      if (!d) return d;
      const from = boxOf(d.lists, active);
      const to = boxOf(d.lists, over);
      if (!from || !to || from === to) return d;
      const id = active.slice(2);
      const target = d.lists[to]!;
      const overIndex = over.startsWith('e:') ? target.indexOf(over.slice(2)) : -1;
      const below = !!translated && translated.top > overNode.rect.top + overNode.rect.height / 2;
      const at = overIndex >= 0 ? overIndex + (below ? 1 : 0) : target.length;
      settling.current = true;
      return {
        ...d,
        lists: {
          ...d.lists,
          [from]: d.lists[from]!.filter((x) => x !== id),
          [to]: [...target.slice(0, at), id, ...target.slice(at)],
        },
      };
    });
  }

  function onDragEnd(e: DragEndEvent) {
    quiet.current = true;
    setTimeout(() => (quiet.current = false), 300);
    const active = String(e.active.id);
    const over = e.over ? String(e.over.id) : null;
    const lists = drag?.lists ?? baseLists;
    setDrag(null);
    const prev = qc.getQueryData<TripDetail>(key);

    if (active.startsWith('s:')) {
      const ids = sections.map((s) => s.id);
      const a = ids.indexOf(active.slice(2));
      const b = over?.startsWith('s:') ? ids.indexOf(over.slice(2)) : -1;
      if (a < 0 || b < 0 || a === b) return;
      const order = arrayMove(ids, a, b);
      if (prev)
        qc.setQueryData<TripDetail>(key, {
          ...prev,
          itinerary: prev.itinerary.map((s) => ({ ...s, sort_order: order.indexOf(s.id) })),
        });
      void send(() => api.post<TripDetail>(`/trips/${tripId}/itinerary/order`, { ids: order }));
      return;
    }

    const id = active.slice(2);
    const box = boxOf(lists, active);
    if (!box) return;
    let list = lists[box]!;
    if (over?.startsWith('e:') && boxOf(lists, over) === box) {
      const a = list.indexOf(id);
      const b = list.indexOf(over.slice(2));
      if (a !== b) list = arrayMove(list, a, b);
    }
    const before = baseLists[box]!;
    if (list.length === before.length && list.every((x, i) => x === before[i])) return;
    // Show the new order now; the server keeps connecting flights together.
    if (prev) {
      const moved = byId.get(id)!;
      qc.setQueryData<TripDetail>(key, {
        ...prev,
        itinerary: prev.itinerary.map((s) => {
          const entries = s.entries.filter((x) => x.id !== id);
          if (s.id === box) entries.push({ ...moved, section_id: box });
          return {
            ...s,
            entries: entries.map((x) =>
              s.id === box ? { ...x, sort_order: list.indexOf(x.id) } : x,
            ),
          };
        }),
      });
    }
    void send(() => api.post<TripDetail>(`/itinerary-sections/${box}/order`, { ids: list }));
  }

  async function removeEntry(e: ItineraryEntry, section: ItinerarySection) {
    setEntrySheet(null);
    await send(() => api.del<TripDetail>(`/itinerary-entries/${e.id}`));
    toast({
      text: `Deleted ${entryName(e)}`,
      action: {
        label: 'Undo',
        run: () =>
          void send(() =>
            api.post<TripDetail>(`/itinerary-sections/${section.id}/entries`, {
              ...draftOf(e),
              sort_order: e.sort_order,
            }),
          ),
      },
    });
  }

  /** Print: a PDF of the itinerary, shared (phones) or opened in a new tab (computers). */
  async function print() {
    if (making) return;
    const tab = openPdfTab();
    setMaking(true);
    try {
      const file = await itineraryPdf({ trip: detail.trip, itinerary: detail.itinerary });
      const r = await deliverPdf(file, tab);
      if (r === 'needs-tap')
        toast({
          text: 'Your PDF is ready.',
          action: { label: 'Share', run: () => void deliverPdf(file).catch(() => undefined) },
        });
    } catch (e) {
      tab?.close();
      toast({ text: `Couldn’t make the PDF. ${errorMessage(e)}` });
    } finally {
      setMaking(false);
    }
  }

  const travelCount = sections.filter((s) => s.kind === 'travel').length;
  const t = detail.trip;

  return (
    <div id="itinerary-print">
      {/* On paper: the trip first. */}
      <header className="hidden px-5 pt-2 pb-1 print:block">
        <h1 className="text-2xl font-semibold">{t.name}</h1>
        <p className="text-sm text-soft">
          {[formatRange(t.start_date, t.end_date), t.destination].filter(Boolean).join(' · ')}
        </p>
      </header>

      <div className="px-5">
        <ErrorText>{error}</ErrorText>
      </div>

      <div className="flex items-center gap-2 px-5 pt-3 print:hidden">
        {sections.length > 0 && otherZones && (
          <SlideToggle<Clock>
            size="sm"
            label="Show times in"
            value={clock}
            onChange={setClock}
            options={[
              ['local', 'Local'],
              [
                'home',
                <span key="h" title="Your time zone">
                  {zoneName(here, now)}
                </span>,
              ],
            ]}
          />
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {sections.length > 0 && (
            <button
              className={cx(
                'inline-flex h-8 items-center justify-center gap-1.5 rounded-full bg-chip text-soft',
                making ? 'px-3 text-[13px]' : 'w-8',
              )}
              onClick={() => void print()}
              disabled={making}
              aria-label={making ? 'Making PDF…' : 'Print itinerary (PDF)'}
              title="Print itinerary"
            >
              <Icon name="printer" size={16} />
              {making && <span>Making PDF…</span>}
            </button>
          )}
          <button
            className="inline-flex h-8 items-center gap-1 rounded-full bg-chip pr-3 pl-2 text-[13px] font-medium text-ink"
            onClick={() =>
              // After travel comes a stay, and after a stay more travel.
              setSectionSheet({ kind: sections.at(-1)?.kind === 'travel' ? 'stay' : 'travel' })
            }
          >
            <Icon name="plus" size={14} className="text-soft" />
            Section
          </button>
        </div>
      </div>

      {!sections.length && (
        <p className="px-6 pt-5 text-sm text-soft">
          Flights, trains, places to stay, reservations: everything in order. Start with how you’re
          getting there.
        </p>
      )}

      <DragActive.Provider value={!!drag}>
        <div
          onClickCapture={(e) => {
            if (quiet.current) {
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
            onDragCancel={() => setDrag(null)}
            onDragEnd={onDragEnd}
            measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
            autoScroll={{ threshold: { x: 0, y: 0.12 }, acceleration: 5 }}
          >
            <SortableContext
              items={sections.map((s) => sectionKey(s.id))}
              strategy={verticalListSortingStrategy}
            >
              {sections.map((s) => {
                const rows = rowsBySection.get(s.id)!;
                const conns = new Map(connections(entriesOf(s.id)).map((c) => [c.after, c]));
                const dates = sectionDates(s);
                let lastDay: string | null = null;
                return (
                  <SortableSection
                    key={s.id}
                    section={s}
                    dates={dates}
                    onEdit={() => setSectionSheet({ section: s, kind: s.kind })}
                    onAdd={() => setEntrySheet({ section: s })}
                    entryIds={entriesOf(s.id).map((e) => entryKey(e.id))}
                    draggingEntry={!!activeEntry}
                  >
                    {s.notes && <p className="px-3.5 pt-2 text-[13px] text-soft">{s.notes}</p>}
                    {!rows.length && (
                      <button
                        className="px-3 py-3 text-left text-sm text-faint print:hidden"
                        onClick={() => setEntrySheet({ section: s })}
                      >
                        {s.kind === 'travel'
                          ? 'Add a flight, train, bus, boat or drive.'
                          : 'Add where you’re staying, reservations and plans.'}
                      </button>
                    )}
                    {rows.map((r) => {
                      const showDay = r.date && r.date !== lastDay;
                      if (r.date) lastDay = r.date;
                      const c = r.part === 'all' ? conns.get(r.entry.id) : undefined;
                      return (
                        <SortableEntry
                          key={r.key}
                          id={r.part === 'out' ? null : r.entry.id}
                          section={s.id}
                          nextRef={r.key === next ? nextRef : undefined}
                          head={
                            showDay && (
                              <div
                                data-day={r.date}
                                className="scroll-mt-24 px-3 pt-3 pb-1 text-xs font-medium text-faint break-after-avoid"
                              >
                                {formatDay(r.date)}
                              </div>
                            )
                          }
                          after={
                            c && (
                              <div className="flex items-center gap-2 border-b border-line py-2 pr-3 pl-11 text-[13px] text-soft">
                                <Icon name="clock" size={13} className="text-faint" />
                                <span>
                                  Layover{c.at ? ` in ${c.at}` : ''} · {formatMinutes(c.minutes)}
                                  {c.change && (
                                    <span className="text-danger">
                                      {' '}
                                      · change {c.change.from} → {c.change.to}
                                    </span>
                                  )}
                                </span>
                              </div>
                            )
                          }
                        >
                          <SwipeRow
                            id={r.key}
                            onDelete={() => removeEntry(r.entry, s)}
                            className={cx('border-b border-line', c && 'border-b-0')}
                          >
                            <EntryRow
                              row={r}
                              clock={clock}
                              next={r.key === next}
                              onOpen={() => setEntrySheet({ section: s, entry: r.entry })}
                              onCopy={(text) => copy(text, toast)}
                            />
                          </SwipeRow>
                        </SortableEntry>
                      );
                    })}
                  </SortableSection>
                );
              })}
            </SortableContext>
            <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(.2,.7,.3,1)' }}>
              {activeEntry ? (
                <div className="rounded-xl bg-surface shadow-xl ring-1 ring-line">
                  <EntryRow
                    row={rowsOf([activeEntry])[0]!}
                    clock={clock}
                    next={false}
                    onOpen={() => undefined}
                    onCopy={() => undefined}
                  />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        </div>
      </DragActive.Provider>
      <div className="h-8" />

      <SectionSheet
        open={!!sectionSheet}
        section={sectionSheet?.section}
        kind={sectionSheet?.kind ?? 'stay'}
        suggest={(k) =>
          k === 'travel'
            ? travelCount
              ? 'Heading home'
              : 'Getting there'
            : (detail.trip.destination ?? '')
        }
        count={sections.length}
        onClose={() => setSectionSheet(null)}
        onSave={async (v) => {
          const res = sectionSheet?.section
            ? await api.patch<TripDetail>(`/itinerary-sections/${sectionSheet.section.id}`, v)
            : await api.post<TripDetail>(`/trips/${tripId}/itinerary`, v);
          qc.setQueryData(key, res);
          // A new section is ready for its first entry.
          if (!sectionSheet?.section) {
            const added = sortSections(res.itinerary).at(-1);
            if (added) setEntrySheet({ section: added });
          }
        }}
        onDelete={() => {
          const s = sectionSheet?.section;
          setSectionSheet(null);
          if (s) void send(() => api.del<TripDetail>(`/itinerary-sections/${s.id}`));
        }}
      />

      <EntrySheet
        open={!!entrySheet}
        editing={!!entrySheet?.entry}
        zone={entrySheet ? likelyZone(sections, entrySheet.section.id) : here}
        initial={
          entrySheet?.entry
            ? draftOf(entrySheet.entry)
            : entrySheet?.section.kind === 'travel'
              ? { kind: 'transport', mode: 'plane' }
              : { kind: entrySheet?.section.entries.length ? 'plan' : 'lodging' }
        }
        onClose={() => setEntrySheet(null)}
        onDelete={
          entrySheet?.entry ? () => removeEntry(entrySheet.entry!, entrySheet.section) : undefined
        }
        onSave={async (d: EntryDraft) => {
          const res = entrySheet?.entry
            ? await api.patch<TripDetail>(`/itinerary-entries/${entrySheet.entry.id}`, d)
            : await api.post<TripDetail>(
                `/itinerary-sections/${entrySheet!.section.id}/entries`,
                d,
              );
          qc.setQueryData(key, res);
        }}
      />
    </div>
  );
}

/** A section: its bar (hold and drag it to move the section) and its lines. */
function SortableSection({
  section: s,
  dates,
  onEdit,
  onAdd,
  entryIds,
  draggingEntry,
  children,
}: {
  section: ItinerarySection;
  dates: string;
  onEdit: () => void;
  onAdd: () => void;
  entryIds: string[];
  draggingEntry: boolean;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: sectionKey(s.id),
  });
  const { setNodeRef: setBoxRef } = useDroppable({ id: boxKey(s.id) });
  return (
    <section
      ref={setNodeRef}
      style={{ transform: DndCSS.Translate.toString(transform), transition }}
      className={cx(
        'relative mt-5 px-5 print:mt-4',
        isDragging && 'z-20 opacity-90 [&>div:first-child]:shadow-lg',
      )}
    >
      <div
        {...attributes}
        {...listeners}
        role="group"
        aria-roledescription="Section you can drag to reorder"
        className="flex touch-manipulation items-center gap-2 rounded-2xl bg-chip py-1.5 pr-1.5 pl-3.5 select-none break-after-avoid"
      >
        <button
          className="flex min-w-0 flex-1 items-center gap-2 py-0.5 text-left"
          onClick={onEdit}
          aria-label={`Edit ${s.title}`}
        >
          <Icon name={s.kind === 'travel' ? 'plane' : 'pin'} size={16} className="text-soft" />
          <span className="truncate text-base font-semibold">{s.title}</span>
          {dates && <span className="ml-auto flex-none text-xs text-faint tnum">{dates}</span>}
        </button>
        <IconButton
          icon="plus"
          label={`Add to ${s.title}`}
          className="h-7 w-7 print:hidden"
          onClick={onAdd}
        />
      </div>
      <SortableContext items={entryIds} strategy={verticalListSortingStrategy}>
        {/* An emptied section keeps a little room so an entry can go back. */}
        <div ref={setBoxRef} className={cx(draggingEntry && !entryIds.length && 'min-h-12')}>
          {children}
        </div>
      </SortableContext>
    </section>
  );
}

const SLOT =
  "after:pointer-events-none after:absolute after:inset-0.5 after:rounded-xl after:border-2 after:border-dashed after:border-accent/70 after:bg-accent-tint/40 after:content-['']";

interface EntryLineProps {
  section: string;
  nextRef?: RefObject<HTMLDivElement | null>;
  /** The day heading above it, and a layover under it: they move with the line. */
  head?: ReactNode;
  after?: ReactNode;
  children: ReactNode;
}

/** One line you can hold and drag (a check-out line stays put: it follows its check-in). */
function SortableEntry({
  id,
  section,
  nextRef,
  head,
  after,
  children,
}: EntryLineProps & { id: string | null }) {
  if (!id)
    return (
      <div ref={nextRef} className="break-inside-avoid">
        {head}
        {children}
        {after}
      </div>
    );
  return (
    <DraggableEntry id={id} section={section} nextRef={nextRef} head={head} after={after}>
      {children}
    </DraggableEntry>
  );
}

function DraggableEntry({
  id,
  section,
  nextRef,
  head,
  after,
  children,
}: EntryLineProps & { id: string }) {
  const {
    setNodeRef,
    setActivatorNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: entryKey(id), data: { box: section } });
  return (
    <div
      ref={(n) => {
        setNodeRef(n);
        if (nextRef) nextRef.current = n;
      }}
      style={{ transform: DndCSS.Translate.toString(transform), transition }}
      className={cx('relative break-inside-avoid', isDragging && SLOT)}
    >
      <div className={cx(isDragging && 'invisible')}>
        {head}
        <div
          ref={setActivatorNodeRef}
          {...attributes}
          // The line holds its own buttons, so it's a group, not a button.
          role="group"
          aria-roledescription="Entry you can drag to reorder"
          {...listeners}
          className="touch-manipulation outline-none select-none [-webkit-touch-callout:none]"
        >
          {children}
        </div>
        {after}
      </div>
    </div>
  );
}

function EntryRow({
  row,
  clock,
  next,
  onOpen,
  onCopy,
}: {
  row: Row;
  clock: Clock;
  next: boolean;
  onOpen: () => void;
  onCopy: (text: string) => void;
}) {
  const e = row.entry;
  const icon: IconName =
    row.part === 'out'
      ? 'logout'
      : e.kind === 'transport'
        ? MODE_ICONS[e.mode ?? 'plane']
        : KIND_ICONS[e.kind];
  const lines: ReactNode[] = [];
  let lead: string | null = null;
  if (e.kind === 'transport') {
    const from = e.start.code ?? e.start.place;
    const to = e.end.code ?? e.end.place;
    const shift = shownShift(e, clock);
    const route = [
      [from, timeText(e.start, clock)].filter(Boolean).join(' '),
      [to, timeText(e.end, clock, true)].filter(Boolean).join(' '),
    ];
    if (route.some(Boolean))
      lines.push(
        <span key="route" className="tnum">
          {route[0] || '?'} → {route[1] || '?'}
          {shift > 0 && <sup className="ml-0.5 text-[10px] text-faint">+{shift}</sup>}
        </span>,
      );
    const label = entryName(e);
    const sub = [e.carrier, e.number].filter(Boolean).join(' ');
    if (e.title && sub && sub !== label) lines.push(<span key="num">{sub}</span>);
    // The arrival's own date, when it's two or more days on (local times only: home times
    // carry their day already).
    if (clock === 'local' && e.end.date && e.start.date && e.end.date !== e.start.date && shift > 1)
      lines.push(<span key="arr">Arrives {formatDay(e.end.date)}</span>);
  } else if (e.kind === 'lodging') {
    if (row.part === 'out') {
      lead = 'Check out';
      const outT = timeText(e.end, clock);
      if (outT) lines.push(<span key="t">{outT}</span>);
    } else {
      lead = row.part === 'in' ? 'Check in' : null;
      const inT = timeText(e.start, clock);
      const nights =
        e.start.date && e.end.date ? dayNumber(e.end.date)! - dayNumber(e.start.date)! : null;
      const bits = [
        inT,
        nights ? `${nights} night${nights === 1 ? '' : 's'}` : '',
        e.address ?? '',
      ].filter(Boolean);
      if (bits.length) lines.push(<span key="t">{bits.join(' · ')}</span>);
    }
  } else if (e.kind === 'plan') {
    const time = [timeText(e.start, clock), timeText(e.end, clock)].filter(Boolean).join(' – ');
    const where = e.start.place;
    if (time || where) lines.push(<span key="t">{[time, where].filter(Boolean).join(' · ')}</span>);
  }
  const out = row.part === 'out';
  const minutes = e.kind === 'transport' ? entryMinutes(e) : null;
  const statusQuery =
    e.kind === 'transport' && e.mode === 'plane' && e.carrier && e.number
      ? `${e.carrier} ${e.number} flight status`
      : null;

  return (
    <div
      className={cx(
        'flex items-start gap-3 px-3 py-3',
        next && 'bg-accent-tint/30 print:bg-transparent',
      )}
    >
      <Icon name={icon} size={18} className="mt-0.5 text-soft" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <button className="flex min-w-0 flex-col gap-0.5 text-left" onClick={onOpen}>
          <span className="flex items-center gap-2">
            <span className={cx('min-w-0 truncate text-base leading-tight', out && 'text-soft')}>
              {lead && <span className="text-soft">{lead} · </span>}
              {entryName(e)}
            </span>
            {next && (
              <span className="flex-none rounded bg-accent-tint px-1.5 py-px text-[11px] font-medium text-accent print:hidden">
                Next
              </span>
            )}
            {minutes !== null && (
              <span className="ml-auto flex-none font-mono text-xs text-faint tnum">
                {formatMinutes(minutes)}
              </span>
            )}
          </span>
          {lines.map((l, i) => (
            <span key={i} className="text-[13px] text-soft">
              {l}
            </span>
          ))}
          {e.kind === 'note' && e.notes && (
            <span className="text-[13px] whitespace-pre-line text-soft">{e.notes}</span>
          )}
          {!out && e.kind !== 'note' && (e.details || e.notes) && (
            <span className="truncate text-[13px] text-faint print:whitespace-normal">
              {[e.details, e.notes].filter(Boolean).join(' · ')}
            </span>
          )}
        </button>
        {!out && (e.confirmation || statusQuery) && (
          <span className="flex flex-wrap items-center gap-1.5 pt-1">
            {e.confirmation && (
              <button
                className="inline-flex items-center gap-1 rounded-md bg-chip px-1.5 py-0.5 font-mono text-xs text-ink"
                aria-label={`Copy confirmation ${e.confirmation}`}
                onClick={() => onCopy(e.confirmation!)}
              >
                <Icon name="copy" size={12} className="text-faint print:hidden" />
                {e.confirmation}
              </button>
            )}
            {statusQuery && (
              <a
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-accent first:-ml-1.5 print:hidden"
                href={`https://www.google.com/search?q=${encodeURIComponent(statusQuery)}`}
                target="_blank"
                rel="noreferrer"
              >
                Flight status
              </a>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

function SectionSheet(props: {
  open: boolean;
  section?: ItinerarySection;
  kind: SectionKind;
  /** A name to start with for each kind. */
  suggest: (kind: SectionKind) => string;
  count: number;
  onClose: () => void;
  onSave: (v: { kind: SectionKind; title: string; notes: string | null }) => Promise<void>;
  onDelete: () => void;
}) {
  if (!props.open) return null;
  return <SectionSheetBody {...props} />;
}

function SectionSheetBody({
  section,
  kind: initialKind,
  suggest,
  count,
  onClose,
  onSave,
  onDelete,
}: Parameters<typeof SectionSheet>[0]) {
  const [kind, setKind] = useState<SectionKind>(section?.kind ?? initialKind);
  const [title, setTitle] = useState(section?.title ?? suggest(initialKind));
  // Switching the type swaps in that type's suggested name, until you type your own.
  const [typed, setTyped] = useState(!!section);
  const pickKind = (k: SectionKind) => {
    setKind(k);
    if (!typed) setTitle(suggest(k));
  };
  const [notes, setNotes] = useState(section?.notes ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const n = section?.entries.length ?? 0;

  async function save() {
    if (!title.trim()) return setError('Give the section a name.');
    setBusy(true);
    try {
      await onSave({ kind, title: title.trim(), notes: notes.trim() || null });
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={section ? 'Edit section' : 'Add a section'}
      footer={
        <>
          {section ? (
            <DangerButton onClick={() => (n && !confirm ? setConfirm(true) : onDelete())}>
              {confirm ? `Delete with ${n} ${n === 1 ? 'entry' : 'entries'}?` : 'Delete'}
            </DangerButton>
          ) : (
            <span />
          )}
          <div className="flex items-center">
            <GhostButton onClick={onClose}>Cancel</GhostButton>
            <PrimaryButton onClick={save} disabled={busy}>
              {section ? 'Save' : 'Add'}
            </PrimaryButton>
          </div>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <FieldRow icon="layers" label="Type">
          <SlideToggle<SectionKind>
            label="Type"
            value={kind}
            onChange={pickKind}
            options={[
              [
                'travel',
                <>
                  <Icon name="plane" size={15} />
                  Travel
                </>,
              ],
              [
                'stay',
                <>
                  <Icon name="pin" size={15} />
                  Stay
                </>,
              ],
            ]}
          />
        </FieldRow>
        <FieldRow
          icon="tag"
          label="Name"
          htmlFor="section-title"
          hint={
            kind === 'travel' ? 'e.g. Getting there, Lisbon → Porto, Heading home' : 'e.g. Lisbon'
          }
        >
          <TextInput
            id="section-title"
            autoFocus={!section}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setTyped(true);
            }}
          />
        </FieldRow>
        <FieldRow icon="note" label="Notes" htmlFor="section-notes">
          <TextInput
            id="section-notes"
            value={notes}
            placeholder="Optional"
            onChange={(e) => setNotes(e.target.value)}
          />
        </FieldRow>
        {section && count > 1 && (
          <p className="pt-3 text-xs text-faint">
            To move this section, hold its bar in the list and drag it.
          </p>
        )}
        <button type="submit" hidden />
        <div className="pt-3">
          <ErrorText>{error}</ErrorText>
        </div>
      </form>
    </Sheet>
  );
}
