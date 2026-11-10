import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import {
  displayQty,
  isCarryOn,
  localToday,
  mergeCategoryOrder,
  orderCategories,
  progress,
  reorderMoves,
  shortBagLabel,
  tripStage,
} from '@shared/logic';
import { DEFAULT_LOOKUPS } from '@shared/lookups';
import type { Item, Person, Trip, TripBag, TripDetail, TripItem } from '@shared/types';
import { api, errorMessage } from '../lib/api';
import { formatRange, plural } from '../lib/format';
import { keys, useAppState, usePatchTripItem, useTrip } from '../lib/queries';
import { load, save } from '../lib/storage';
import { isOffline } from '../lib/offline';
import { Icon } from '../components/Icon';
import { ItemSheet, type ItemDraft, type SaveResult } from '../components/ItemSheet';
import { CatalogPicker } from '../components/CatalogPicker';
import { SwipeRow } from '../components/SwipeRow';
import { SortableGroups } from '../components/SortableGroups';
import { TripItinerary } from '../components/Itinerary';
import { TripTodos } from '../components/Todos';
import { SearchToggle } from '../components/SearchToggle';
import { matches } from '../lib/search';
import { useToast } from '../components/Toast';
import {
  ActionList,
  cx,
  Empty,
  ErrorText,
  FieldRow,
  GhostButton,
  IconButton,
  InfoPill,
  Menu,
  SlideToggle,
  PersonDot,
  PrimaryButton,
  Sheet,
  TextInput,
} from '../components/ui';

type Status = 'all' | 'packed' | 'todo';
type Where = 'all' | 'carry' | 'luggage';
type GroupBy = 'person' | 'bag';
const NO_BAG = '__nobag';
const SHARED = '__shared';

interface Group {
  key: string;
  label: string;
  person?: Person;
  bag?: TripBag;
  kind: 'person' | 'shared' | 'bag' | 'nobag';
  rows: TripItem[];
}

export function Pack() {
  const { id = '' } = useParams();
  const state = useAppState();
  const trip = useTrip(id);
  if (state.isPending) return <div className="h-40" />;
  if (state.error) return <Empty title="Couldn’t load Duffel">{errorMessage(state.error)}</Empty>;
  const s = state.data;
  if (!s.trips.some((t) => t.id === id)) return <Empty title="Trip not found" />;
  return (
    <PackTrip
      tripId={id}
      trips={s.trips}
      people={s.people}
      catalog={s.items}
      categories={s.lookups.category ?? []}
      detail={trip.data}
      error={trip.error}
    />
  );
}

function PackTrip(props: {
  tripId: string | null;
  trips: Trip[];
  people: Person[];
  catalog: Item[];
  categories: string[];
  detail?: TripDetail;
  error: Error | null;
}) {
  const { trips, people, catalog, detail } = props;
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatusRaw] = useState<Status>(() => load('status', 'all'));
  const [where, setWhereRaw] = useState<Where>(() => load('where', 'all'));
  const [groupBy, setGroupByRaw] = useState<GroupBy>(() => load('groupBy', 'person'));
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => load('collapsed', {}));
  const [editing, setEditing] = useState<TripItem | null>(null);
  const [adding, setAdding] = useState<Partial<ItemDraft> | null>(null);
  const [menu, setMenu] = useState<null | 'menu' | 'reset' | 'template' | 'catalog'>(null);
  const [error, setError] = useState('');
  const [menuAnchor, setMenuAnchor] = useState<DOMRect | null>(null);
  const [filterAnchor, setFilterAnchor] = useState<DOMRect | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moveOpen, setMoveOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  // Packing or To-dos. Unset = pick by where the trip is (see below).
  const [view, setView] = useState<'packing' | 'todos' | 'itinerary' | null>(null);
  const [params, setParams] = useSearchParams();
  // "Sort them now" from trip details: open select mode with the waiting rows picked.
  useEffect(() => {
    if (params.get('select') !== 'waiting' || !detail) return;
    const waiting = detail.items.filter((r) => !r.trip_bag_id && !r.no_bag).map((r) => r.id);
    // Syncing from the URL once, then clearing it, so this runs a single time.
    /* eslint-disable react-hooks/set-state-in-effect */
    setSelecting(true);
    setSelected(new Set(waiting));
    /* eslint-enable react-hooks/set-state-in-effect */
    setParams({}, { replace: true });
  }, [params, detail, setParams]);
  // A notification's link: ?view=packing|todos|itinerary opens that tab (once).
  useEffect(() => {
    const v = params.get('view');
    if (v !== 'packing' && v !== 'todos' && v !== 'itinerary') return;
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    setView(v);
    const next = new URLSearchParams(params);
    next.delete('view');
    setParams(next, { replace: true });
  }, [params, setParams]);
  const stopSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
  };
  async function bulk(
    body: { patch?: Record<string, unknown>; delete?: boolean; assign?: string[] },
    done: string,
  ) {
    if (!props.tripId || !selected.size) return;
    setError('');
    try {
      await api.post(`/trips/${props.tripId}/items/bulk`, { ids: [...selected], ...body });
      toast({ text: done });
      stopSelecting();
      setMoveOpen(false);
      setAssignOpen(false);
    } catch (e) {
      setError(errorMessage(e));
    }
    refresh();
  }
  const patch = usePatchTripItem(props.tripId ?? 'none');

  const setStatus = (v: Status) => (setStatusRaw(v), save('status', v));
  const setWhere = (v: Where) => (setWhereRaw(v), save('where', v));
  const setGroupBy = (v: GroupBy) => (setGroupByRaw(v), save('groupBy', v));
  const toggleCollapsed = (k: string) =>
    setCollapsed((c) => {
      const n = { ...c, [k]: !c[k] };
      save('collapsed', n);
      return n;
    });

  const trip = detail?.trip ?? trips.find((t) => t.id === props.tripId);
  // Who's going: the trip's travelers, or everyone when none are picked.
  const travelersList = trip?.travelers.length
    ? people.filter((p) => trip.travelers.includes(p.id))
    : people;
  const bags = useMemo(() => detail?.bags ?? [], [detail]);
  const rows = useMemo(() => detail?.items ?? [], [detail]);
  const bagMap = useMemo(() => new Map(bags.map((b) => [b.id, b])), [bags]);
  const personMap = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const bagName = (b: TripBag) => shortBagLabel(b.label, trip?.name ?? '');
  const prog = progress(rows, bagMap);
  const todos = detail?.todos ?? [];
  const pre = todos.filter((t) => t.phase === 'pre');
  const preDone = pre.filter((t) => t.done).length;
  // One bar for getting ready: packed items in orange, pre-trip to-dos in blue.
  const readyTotal = prog.total + pre.length;
  const wPacked = readyTotal ? (prog.done / readyTotal) * 100 : 0;
  const wTodos = readyTotal ? (preDone / readyTotal) * 100 : 0;
  const stage = trip ? tripStage(trip, localToday()) : 'before';
  const nowPhase = stage === 'during' ? 'during' : stage === 'after' ? 'after' : null;
  const nowTodos = nowPhase ? todos.filter((t) => t.phase === nowPhase) : [];
  // On the trip (or after it), open on its to-dos when there are any.
  const shown = view ?? (nowTodos.length ? 'todos' : 'packing');

  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const filtered = status !== 'all' || where !== 'all';
  // Searching or filtering: hide what's empty and open everything that has matches.
  const narrowed = filtered || !!query.trim();
  const visible = rows.filter((r) => {
    if (!matches(query, r.name, r.category, r.notes)) return false;
    if (status === 'packed' && !r.packed) return false;
    if (status === 'todo' && r.packed) return false;
    const carry = isCarryOn(r, bagMap);
    if (where === 'carry' && !carry) return false;
    if (where === 'luggage' && (carry || !r.trip_bag_id)) return false;
    return true;
  });

  const groups: Group[] = useMemo(() => {
    const out: Group[] = [];
    if (groupBy === 'person') {
      const onTrip = new Set(rows.map((r) => r.person_id).filter(Boolean));
      const list = people.filter(
        (p) => !trip?.travelers.length || trip.travelers.includes(p.id) || onTrip.has(p.id),
      );
      for (const p of list)
        out.push({
          key: p.id,
          label: p.name,
          person: p,
          kind: 'person',
          rows: visible.filter((r) => r.person_id === p.id),
        });
      const known = new Set(list.map((p) => p.id));
      out.push({
        key: SHARED,
        label: 'Shared',
        kind: 'shared',
        rows: visible.filter((r) => !r.person_id || !known.has(r.person_id)),
      });
    } else {
      for (const b of bags)
        out.push({
          key: b.id,
          label: bagName(b),
          bag: b,
          kind: 'bag',
          rows: visible.filter((r) => r.trip_bag_id === b.id),
        });
      out.push({
        key: NO_BAG,
        label: 'No bag',
        kind: 'nobag',
        rows: visible.filter((r) => !r.trip_bag_id || !bagMap.has(r.trip_bag_id)),
      });
    }
    // With filters on, hide empty groups. Without, keep people and bags (so + is always there),
    // but hide the catch-all groups when they're empty.
    return out.filter((g) =>
      narrowed ? g.rows.length > 0 : g.rows.length > 0 || g.kind === 'person' || g.kind === 'bag',
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupBy, rows, visible.length, status, where, query, people, bags, trip?.travelers]);

  const refresh = () => {
    if (!props.tripId) return;
    qc.invalidateQueries({ queryKey: keys.trip(props.tripId) });
    qc.invalidateQueries({ queryKey: keys.state });
  };

  function toggle(r: TripItem) {
    setError('');
    patch.mutate(
      { id: r.id, patch: { packed: !r.packed } },
      { onError: (e) => !isOffline(e) && setError(errorMessage(e)) },
    );
  }

  async function remove(r: TripItem) {
    if (!props.tripId) return;
    const key = keys.trip(props.tripId);
    const prev = qc.getQueryData<TripDetail>(key);
    if (prev)
      qc.setQueryData<TripDetail>(key, { ...prev, items: prev.items.filter((x) => x.id !== r.id) });
    setEditing(null);
    try {
      await api.del(`/trip-items/${r.id}`);
      toast({
        text: `Deleted ${r.name}`,
        action: {
          label: 'Undo',
          run: async () => {
            try {
              await api.post(`/trips/${r.trip_id}/items`, {
                id: r.id,
                item_id: r.item_id,
                name: r.name,
                person_id: r.person_id && personMap.has(r.person_id) ? r.person_id : null,
                trip_bag_id: r.trip_bag_id && bagMap.has(r.trip_bag_id) ? r.trip_bag_id : null,
                no_bag: r.no_bag,
                qty: r.qty,
                qty_override: r.qty_override,
                packed: r.packed,
                category: r.category,
                notes: r.notes,
                sort_order: r.sort_order,
              });
            } catch (e) {
              setError(errorMessage(e));
            }
            refresh();
          },
        },
      });
    } catch (e) {
      setError(errorMessage(e));
    }
    refresh();
  }

  function openAdd(g: Group) {
    setAdding({
      person_id: g.kind === 'person' ? g.key : null,
      trip_bag_id:
        g.kind === 'bag'
          ? g.key
          : where === 'carry'
            ? (bags.find((b) => b.carry_on)?.id ?? null)
            : null,
      no_bag: g.kind === 'nobag',
    });
  }

  /** Rows were dragged into a new order (or group) inside one person or bag. */
  async function moveRows(next: { id: string; category: string | null }[]) {
    if (!props.tripId) return;
    const moves = reorderMoves(rows, next);
    if (!moves.length) return;
    const key = keys.trip(props.tripId);
    const prev = qc.getQueryData<TripDetail>(key);
    if (prev) {
      const by = new Map(moves.map((m) => [m.id, m]));
      qc.setQueryData<TripDetail>(key, {
        ...prev,
        items: prev.items
          .map((r) => {
            const m = by.get(r.id);
            if (!m) return r;
            return {
              ...r,
              sort_order: m.sort_order,
              category: m.category !== undefined ? m.category : r.category,
            };
          })
          .sort((a, b) => a.sort_order - b.sort_order),
      });
    }
    setError('');
    try {
      await api.post(`/trips/${props.tripId}/items/reorder`, { moves });
    } catch (e) {
      setError(errorMessage(e));
    }
    refresh();
  }

  /** Groups were dragged into a new order; the order is shared by everyone on the trip. */
  async function moveGroups(order: string[]) {
    if (!props.tripId || !trip) return;
    const present = rows.map((r) => r.category?.trim()).filter((c): c is string => !!c);
    const full = orderCategories(present, trip.category_order, DEFAULT_LOOKUPS.category);
    const category_order = mergeCategoryOrder(full, order);
    const key = keys.trip(props.tripId);
    const prev = qc.getQueryData<TripDetail>(key);
    if (prev) qc.setQueryData<TripDetail>(key, { ...prev, trip: { ...prev.trip, category_order } });
    setError('');
    try {
      await api.patch(`/trips/${props.tripId}`, { category_order });
    } catch (e) {
      setError(errorMessage(e));
    }
    refresh();
  }

  async function saveNew(r: SaveResult) {
    const { person_ids, ...row } = r;
    const owners: (string | null)[] = person_ids?.length ? person_ids : [null];
    // One row per person, so each person checks off their own.
    for (const person_id of owners) {
      await api.post(`/trips/${props.tripId}/items`, { ...row, person_id });
    }
    refresh();
  }

  async function saveEdit(r: SaveResult) {
    if (!editing) return;
    await patch.mutateAsync({ id: editing.id, patch: r as Partial<TripItem> });
  }

  if (!trip)
    return props.error ? (
      <Empty title="Couldn’t load this trip">{errorMessage(props.error)}</Empty>
    ) : (
      <div className="h-40" />
    );
  const len =
    trip.days === null && trip.nights === null ? null : { days: trip.days, nights: trip.nights };
  const travelers = trip.travelers.length;

  return (
    <div>
      <button
        onClick={() => nav('/')}
        className="ml-3.5 flex items-center gap-0.5 pt-3 text-[15px] text-soft"
      >
        <Icon name="back" size={18} /> Trips
      </button>

      <header className="flex flex-col gap-2 px-5 pt-5 pb-2">
        <div className="flex items-center justify-between gap-3">
          <h1 className="min-w-0 text-[28px] leading-tight font-semibold tracking-[-0.025em] text-balance">
            {trip.name}
          </h1>
          <IconButton
            icon="more"
            label="Trip menu"
            onClick={(e) => {
              setMenuAnchor(e.currentTarget.getBoundingClientRect());
              setMenu('menu');
            }}
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(trip.start_date || trip.end_date) && (
            <InfoPill icon="cal">{formatRange(trip.start_date, trip.end_date)}</InfoPill>
          )}
          {trip.nights !== null && <InfoPill icon="moon">{plural(trip.nights, 'night')}</InfoPill>}
          {travelers > 0 && <InfoPill icon="users">{plural(travelers, 'traveler')}</InfoPill>}
          {trip.destination && <InfoPill icon="pin">{trip.destination}</InfoPill>}
        </div>
        <div className="mt-2 flex flex-col gap-1.5">
          <div
            className="flex h-1.5 overflow-hidden rounded-full bg-track"
            role="progressbar"
            aria-valuenow={Math.round(wPacked + wTodos)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Ready for the trip"
          >
            <div
              className="h-full bg-accent transition-[width] duration-200"
              style={{ width: `${wPacked}%` }}
            />
            <div
              className="h-full bg-todo transition-[width] duration-200"
              style={{ width: `${wTodos}%` }}
            />
          </div>
          <span className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[13px] text-soft tnum">
            <span className="inline-flex items-center gap-1.5">
              {pre.length > 0 && <span className="h-2 w-2 rounded-full bg-accent" />}
              <span>
                <span className="font-semibold text-ink">{prog.done}</span> of {prog.total} packed
              </span>
            </span>
            {pre.length > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-todo" />
                <span>
                  <span className="font-semibold text-ink">{preDone}</span> of {pre.length} pre-trip
                  to-dos
                </span>
              </span>
            )}
          </span>
          {nowTodos.length > 0 && (
            <button
              className="inline-flex items-center gap-1.5 self-start rounded-full bg-todo-tint px-3 py-1 text-[13px] font-medium text-todo"
              onClick={() => setView('todos')}
            >
              {stage === 'during' ? 'On the trip' : 'After the trip'} ·{' '}
              {nowTodos.every((t) => t.done)
                ? 'all done'
                : `${plural(nowTodos.filter((t) => !t.done).length, 'to-do')} left`}
            </button>
          )}
        </div>
      </header>

      <div className="px-5 pt-3">
        <SlideToggle<'packing' | 'todos' | 'itinerary'>
          label="Trip sections"
          value={shown}
          onChange={(v) => {
            setView(v);
            if (v !== 'packing') stopSelecting();
          }}
          options={[
            ['packing', 'Packing'],
            [
              'todos',
              <span key="t" className="inline-flex items-center gap-1.5">
                To-dos
                {todos.some((t) => !t.done) && (
                  <span className="font-mono text-[11px] text-faint tnum">
                    {todos.filter((t) => !t.done).length}
                  </span>
                )}
              </span>,
            ],
            ['itinerary', 'Itinerary'],
          ]}
        />
      </div>

      {shown === 'todos' && detail && <TripTodos detail={detail} stage={stage} />}
      {shown === 'itinerary' && detail && <TripItinerary detail={detail} stage={stage} />}

      {shown === 'packing' && (
        <>
          <div className="flex flex-col gap-2 px-5 pt-3 pb-1">
            <div className="flex items-center gap-2">
              {/* The search field grows leftward over the toggle. */}
              <div
                className={cx(
                  'flex-none overflow-hidden transition-[max-width,opacity] duration-200',
                  searchOpen || query ? '-mr-2 max-w-0 opacity-0' : 'max-w-[320px]',
                )}
                aria-hidden={searchOpen || !!query}
              >
                <SlideToggle<GroupBy>
                  label="Group by"
                  value={groupBy}
                  onChange={setGroupBy}
                  options={[
                    ['person', 'Person'],
                    ['bag', 'Bag'],
                  ]}
                />
              </div>
              <SearchToggle
                value={query}
                onChange={setQuery}
                label="Search this trip"
                onOpenChange={setSearchOpen}
              />
              <button
                className={cx(
                  'grid h-[38px] w-[38px] flex-none place-items-center rounded-full',
                  selecting ? 'bg-accent text-accent-ink' : 'bg-chip text-soft',
                )}
                onClick={() => (selecting ? stopSelecting() : setSelecting(true))}
                aria-pressed={selecting}
                aria-label={selecting ? 'Done selecting' : 'Select items'}
                title={selecting ? 'Done selecting' : 'Select items'}
              >
                <Icon name="hand" size={17} />
              </button>
              <button
                className="grid h-[38px] w-[38px] flex-none place-items-center rounded-full bg-chip text-soft"
                onClick={() => setMenu('catalog')}
                aria-label="Add from catalog"
                title="Add from catalog"
              >
                <Icon name="plus" size={18} />
              </button>
              <button
                className={cx(
                  'relative grid h-[38px] w-[38px] flex-none place-items-center rounded-full',
                  filtered ? 'bg-accent-tint text-accent' : 'bg-chip text-soft',
                )}
                onClick={(e) => setFilterAnchor(e.currentTarget.getBoundingClientRect())}
                aria-haspopup="menu"
                aria-label="Filter"
                title="Filter"
              >
                <Icon name="filter" size={17} />
                {filtered && (
                  <span className="absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-ink tnum">
                    {(status !== 'all' ? 1 : 0) + (where !== 'all' ? 1 : 0)}
                  </span>
                )}
              </button>
            </div>
            {filtered && (
              <div className="flex flex-wrap gap-1.5">
                {status !== 'all' && (
                  <FilterChip onClear={() => setStatus('all')}>
                    {status === 'packed' ? 'Packed' : 'To pack'}
                  </FilterChip>
                )}
                {where !== 'all' && (
                  <FilterChip onClear={() => setWhere('all')}>
                    {where === 'carry' ? 'Carry-on' : 'Luggage'}
                  </FilterChip>
                )}
              </div>
            )}
          </div>
          <Menu
            open={!!filterAnchor}
            onClose={() => setFilterAnchor(null)}
            anchor={filterAnchor}
            title="Filter"
          >
            <div className="flex flex-col gap-4 py-3">
              <div className="flex flex-col gap-1.5">
                <span className="text-xs text-soft">Show</span>
                <SlideToggle<Status>
                  label="Packed status"
                  value={status}
                  onChange={setStatus}
                  options={[
                    ['all', 'All'],
                    ['packed', 'Packed'],
                    ['todo', 'To pack'],
                  ]}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-xs text-soft">Where</span>
                <SlideToggle<Where>
                  label="Where"
                  value={where}
                  onChange={setWhere}
                  options={[
                    ['all', 'All'],
                    ['carry', 'Carry-on'],
                    ['luggage', 'Luggage'],
                  ]}
                />
              </div>
              {filtered && (
                <button
                  className="self-start text-sm text-accent"
                  onClick={() => (setStatus('all'), setWhere('all'))}
                >
                  Clear filters
                </button>
              )}
            </div>
          </Menu>

          <div className="px-5">
            <ErrorText>{error}</ErrorText>
          </div>

          {!rows.length && detail ? (
            <Empty
              title="This list is empty"
              action={
                <div className="flex gap-2">
                  <PrimaryButton icon="plus" onClick={() => setMenu('catalog')}>
                    Add from catalog
                  </PrimaryButton>
                </div>
              }
            >
              Add items from your catalog, or tap + next to a person.
            </Empty>
          ) : null}
          {narrowed && rows.length > 0 && !groups.length && (
            <p className="px-5 py-12 text-center text-sm text-soft">
              {query.trim()
                ? `Nothing matches “${query.trim()}”.`
                : status === 'todo' && where === 'all'
                  ? 'Everything is packed.'
                  : 'Nothing matches these filters.'}
            </p>
          )}

          {(rows.length > 0 || !detail) &&
            groups.map((g) => {
              const ck = `${groupBy}:${g.key}`;
              const isCollapsed = !query.trim() && !!collapsed[ck];
              const done = g.rows.filter((r) => r.packed).length;
              return (
                <section key={g.key} className="mt-5 px-5">
                  {/* The whole bar folds the section; its buttons (+, Select all) do their own thing. */}
                  <div
                    className="flex cursor-pointer items-center gap-2 rounded-2xl bg-chip py-1.5 pr-1.5 pl-3.5 select-none"
                    onClick={(e) => {
                      if (!(e.target as HTMLElement).closest('button, a')) toggleCollapsed(ck);
                    }}
                  >
                    <button
                      className="flex min-w-0 items-center gap-2 rounded-full py-0.5 text-base font-semibold"
                      aria-expanded={!isCollapsed}
                      onClick={() => toggleCollapsed(ck)}
                    >
                      <GroupMark g={g} />
                      <span className="truncate">{g.label}</span>
                      {g.bag?.carry_on && (
                        <span className="rounded bg-accent-tint px-1.5 py-px text-[11px] font-medium text-accent">
                          Carry-on
                        </span>
                      )}
                      <Icon
                        name="chev"
                        size={13}
                        className={cx(
                          'text-faint transition-transform',
                          isCollapsed && '-rotate-90',
                        )}
                      />
                    </button>
                    {selecting && g.rows.length > 0 && (
                      <button
                        className="ml-auto text-sm text-accent"
                        onClick={() => {
                          const all = g.rows.every((r) => selected.has(r.id));
                          setSelected((cur) => {
                            const n = new Set(cur);
                            for (const r of g.rows) {
                              if (all) n.delete(r.id);
                              else n.add(r.id);
                            }
                            return n;
                          });
                        }}
                      >
                        {g.rows.every((r) => selected.has(r.id)) ? 'Deselect all' : 'Select all'}
                      </button>
                    )}
                    <span
                      className={cx(
                        'font-mono text-xs text-faint tnum',
                        !(selecting && g.rows.length > 0) && 'ml-auto',
                      )}
                    >
                      {done}/{g.rows.length}
                    </span>
                    {!selecting && (
                      <IconButton
                        icon="plus"
                        label={`Add to ${g.label}`}
                        className="h-7 w-7"
                        onClick={() => openAdd(g)}
                      />
                    )}
                  </div>
                  {!isCollapsed && g.person?.notes && (
                    <p className="flex items-start gap-1.5 pt-2 text-[13px] text-soft">
                      <Icon name="note" size={14} className="mt-0.5 flex-none text-faint" />
                      {g.person.notes}
                    </p>
                  )}
                  {!isCollapsed && (
                    <SortableGroups
                      rows={g.rows}
                      saved={trip.category_order}
                      defaults={DEFAULT_LOOKUPS.category}
                      disabled={selecting}
                      onRowsChange={moveRows}
                      onGroupsChange={moveGroups}
                      isCollapsed={(c) => !query.trim() && !!collapsed[`${ck}:${c}`]}
                      onToggle={(c) => toggleCollapsed(`${ck}:${c}`)}
                      renderHeader={(c, rs, folded) => (
                        <div className="flex items-center gap-2 pt-4 pr-3 pb-1.5 pl-1.5">
                          <span className="rounded-full bg-chip px-2.5 py-0.5 text-[13px] font-semibold text-soft">
                            {c}
                          </span>
                          <Icon
                            name="chev"
                            size={12}
                            className={cx(
                              'text-faint transition-transform',
                              folded && '-rotate-90',
                            )}
                          />
                          <span className="ml-auto font-mono text-[11px] text-faint tnum">
                            {rs.filter((r) => r.packed).length}/{rs.length}
                          </span>
                        </div>
                      )}
                      renderRow={(r) => (
                        <Row
                          row={r}
                          tag={rowTag(r, groupBy, bagMap, personMap, bagName)}
                          onToggle={() => toggle(r)}
                          onEdit={() => setEditing(r)}
                          onDelete={() => remove(r)}
                          selecting={selecting}
                          selected={selected.has(r.id)}
                          onSelect={() =>
                            setSelected((cur) => {
                              const n = new Set(cur);
                              if (n.has(r.id)) n.delete(r.id);
                              else n.add(r.id);
                              return n;
                            })
                          }
                        />
                      )}
                    />
                  )}
                </section>
              );
            })}
          <div className={selecting ? 'h-24' : 'h-8'} />
        </>
      )}

      {selecting && (
        <div className="fixed inset-x-0 bottom-[calc(var(--tabbar-clear)+12px)] z-30 flex justify-center px-4 md:bottom-6 md:left-60">
          <div className="flex w-full max-w-xl items-center gap-1 rounded-full bg-ink py-1.5 pr-1.5 pl-4 text-sm text-bg shadow-lg">
            <span className="flex-1 font-medium tnum">
              {selected.size ? `${selected.size} selected` : 'Tap items to select'}
            </span>
            <button
              disabled={!selected.size}
              onClick={() => setMoveOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-2 font-medium text-accent-ink disabled:opacity-40"
            >
              <Icon name="bag" size={15} />
              Move to bag
            </button>
            <button
              disabled={!selected.size}
              onClick={() => setAssignOpen(true)}
              className="rounded-full px-3 py-2 disabled:opacity-40"
              aria-label="Who it’s for"
              title="Who it’s for"
            >
              <Icon name="users" size={17} />
            </button>
            <button
              disabled={!selected.size}
              onClick={() => bulk({ patch: { packed: true } }, `Packed ${selected.size}`)}
              className="rounded-full px-3 py-2 disabled:opacity-40"
              aria-label="Mark packed"
              title="Mark packed"
            >
              <Icon name="check" size={17} />
            </button>
            <button
              disabled={!selected.size}
              onClick={() => bulk({ delete: true }, `Deleted ${selected.size}`)}
              className="rounded-full px-3 py-2 disabled:opacity-40"
              aria-label="Delete selected"
              title="Delete"
            >
              <Icon name="trash" size={17} />
            </button>
          </div>
        </div>
      )}
      <Sheet
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        title={`Who ${selected.size === 1 ? 'is it' : 'are they'} for?`}
      >
        <div className="flex flex-col pb-2">
          {travelersList.map((p) => (
            <button
              key={p.id}
              onClick={() => bulk({ assign: [p.id] }, `Gave ${selected.size} to ${p.name}`)}
              className="flex items-center gap-3 border-b border-line py-3.5 text-left text-base"
            >
              <PersonDot person={p} size={18} />
              <span className="flex-1">{p.name}</span>
            </button>
          ))}
          <button
            onClick={() => bulk({ assign: [] }, `Made ${selected.size} shared`)}
            className="flex items-center gap-3 border-b border-line py-3.5 text-left text-base"
          >
            <Icon name="users" className="text-soft" />
            Shared
          </button>
          {travelersList.length > 1 && (
            <button
              onClick={() =>
                bulk(
                  { assign: travelersList.map((p) => p.id) },
                  `Gave everyone their own ${selected.size === 1 ? 'copy' : 'copies'}`,
                )
              }
              className="flex items-center gap-3 border-b border-line py-3.5 text-left text-base"
            >
              <Icon name="copy" className="text-soft" />
              <span className="flex flex-1 flex-col">
                Everyone, one each
                <span className="text-[13px] text-soft">Each person gets their own entry.</span>
              </span>
            </button>
          )}
        </div>
      </Sheet>
      <Sheet open={moveOpen} onClose={() => setMoveOpen(false)} title={`Move ${selected.size} to…`}>
        <div className="flex flex-col pb-2">
          {bags.map((b) => (
            <button
              key={b.id}
              onClick={() =>
                bulk({ patch: { trip_bag_id: b.id } }, `Moved ${selected.size} to ${bagName(b)}`)
              }
              className="flex items-center gap-3 border-b border-line py-3.5 text-left text-base"
            >
              <Icon name={b.carry_on ? 'backpack' : 'bag'} className="text-accent" />
              <span className="flex-1">{bagName(b)}</span>
              {b.carry_on && (
                <span className="rounded-full bg-accent-tint px-2 py-0.5 text-[11px] font-medium text-accent">
                  Carry-on
                </span>
              )}
            </button>
          ))}
          <button
            onClick={() => bulk({ patch: { no_bag: true } }, `Moved ${selected.size} to No bag`)}
            className="flex items-center gap-3 border-b border-line py-3.5 text-left text-base"
          >
            <Icon name="nobag" className="text-soft" />
            No bag
          </button>
          {!bags.length && (
            <p className="pt-3 text-sm text-soft">
              This trip has no bags yet. Add them in trip details.
            </p>
          )}
        </div>
      </Sheet>

      <ItemSheet
        open={!!editing}
        mode="edit"
        row={editing ?? undefined}
        people={people}
        bags={bags}
        catalog={catalog}
        len={len}
        bagName={bagName}
        categories={props.categories}
        onClose={() => setEditing(null)}
        onSave={saveEdit}
        onDelete={() => editing && remove(editing)}
      />
      <ItemSheet
        open={!!adding}
        mode="add"
        travelers={trip.travelers}
        initial={adding ?? undefined}
        people={people}
        bags={bags}
        catalog={catalog}
        len={len}
        bagName={bagName}
        categories={props.categories}
        onClose={() => setAdding(null)}
        onSave={saveNew}
      />
      <TripMenu
        anchor={menuAnchor}
        trip={trip}
        open={menu}
        setOpen={setMenu}
        rows={rows}
        catalog={catalog}
        onChanged={refresh}
      />
    </div>
  );
}

/** What a row shows beside its name: its bag (orange when it's a carry-on), or whose it is. */
function rowTag(
  r: TripItem,
  groupBy: GroupBy,
  bags: Map<string, TripBag>,
  people: Map<string, Person>,
  bagName: (b: TripBag) => string,
): React.ReactNode {
  if (groupBy === 'person') {
    const b = r.trip_bag_id ? bags.get(r.trip_bag_id) : undefined;
    if (!b)
      return (
        <>
          <Icon name="nobag" size={13} className="flex-none" />
          <span className="truncate">No bag</span>
        </>
      );
    return (
      <>
        <Icon
          name={b.carry_on ? 'backpack' : 'bag'}
          size={13}
          className={cx('flex-none', b.carry_on && 'text-accent')}
        />
        <span className="truncate">{bagName(b)}</span>
      </>
    );
  }
  const p = r.person_id ? people.get(r.person_id) : undefined;
  return (
    <>
      {p ? <PersonDot person={p} /> : <Icon name="users" size={13} className="flex-none" />}
      <span className="truncate">{p ? p.name : 'Shared'}</span>
    </>
  );
}

function GroupMark({ g }: { g: Group }) {
  if (g.kind === 'person') return <PersonDot person={g.person} size={18} />;
  const icon =
    g.kind === 'shared'
      ? 'users'
      : g.kind === 'nobag'
        ? 'nobag'
        : g.bag?.carry_on
          ? 'backpack'
          : 'bag';
  return <Icon name={icon} size={15} className="text-soft" />;
}

function FilterChip({ children, onClear }: { children: React.ReactNode; onClear: () => void }) {
  return (
    <button
      onClick={onClear}
      className="inline-flex items-center gap-1 rounded-full bg-accent-tint py-1 pr-2 pl-3 text-[13px] font-medium text-accent"
      aria-label={`Remove filter ${String(children)}`}
    >
      {children}
      <Icon name="x" size={13} />
    </button>
  );
}

/** One row: check to pack, tap to edit, swipe left to reveal Delete. */
function Row({
  row,
  tag,
  onToggle,
  onEdit,
  onDelete,
  selecting,
  selected,
  onSelect,
}: {
  row: TripItem;
  /** Its bag or person, on the right of the name. */
  tag: React.ReactNode;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  selecting: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const qty = displayQty(row);
  if (selecting) {
    onToggle = onSelect;
    onEdit = onSelect;
  }
  return (
    <SwipeRow
      id={row.id}
      onDelete={onDelete}
      disabled={selecting}
      highlight={selecting && selected}
      className="border-b border-line"
    >
      <div className="flex items-center px-3">
        <button
          className="flex h-full items-center py-3 pr-3.5"
          aria-label={row.packed ? `Mark ${row.name} not packed` : `Mark ${row.name} packed`}
          aria-pressed={row.packed}
          onClick={onToggle}
        >
          <span
            className={cx(
              'grid h-5 w-5 place-items-center border-[1.5px] transition-colors',
              selecting ? 'rounded-full' : 'rounded-md',
              (selecting ? selected : row.packed)
                ? 'border-accent bg-accent text-accent-ink'
                : 'border-faint',
            )}
          >
            {(selecting ? selected : row.packed) && (
              <Icon name="check" size={14} strokeWidth={2.4} />
            )}
          </span>
        </button>
        <button className="flex min-w-0 flex-1 items-center gap-3 py-3 text-left" onClick={onEdit}>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex min-w-0 items-baseline gap-2">
              <span
                className={cx(
                  // The name keeps at least about half the row; the bag shortens first.
                  'min-w-[55%] flex-1 text-base leading-tight',
                  row.packed && 'text-faint line-through decoration-1',
                )}
              >
                {row.name}
              </span>
              <span
                className={cx(
                  'ml-auto inline-flex min-w-0 shrink items-center gap-1 self-center text-[13px] whitespace-nowrap text-soft',
                  row.packed && 'opacity-60',
                )}
              >
                {tag}
              </span>
            </span>
            {row.notes && <span className="truncate text-[13px] text-soft">{row.notes}</span>}
          </span>
          <span
            className={cx(
              'min-w-7 flex-none text-right font-mono text-[13px] tnum',
              row.packed ? 'text-faint' : 'text-soft',
            )}
          >
            {row.calc_mode && row.qty_override !== null && (
              <span title="Custom quantity">
                <Icon name="edit" size={11} className="mr-1 inline text-accent" />
              </span>
            )}
            {qty === null ? '–' : `×${qty}`}
          </span>
        </button>
      </div>
    </SwipeRow>
  );
}

function TripMenu(props: {
  anchor: DOMRect | null;
  trip: Trip;
  open: null | 'menu' | 'reset' | 'template' | 'catalog';
  setOpen: (v: null | 'menu' | 'reset' | 'template' | 'catalog') => void;
  rows: TripItem[];
  catalog: Item[];
  onChanged: () => void;
}) {
  const { trip, open, setOpen } = props;
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [suggested, setSuggested] = useState<Item[]>([]);
  const close = () => (setOpen(null), setError(''));

  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError('');
    try {
      await fn();
      props.onChanged();
      close();
      toast({ text: done });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  // Suggestions for the catalog picker, fetched each time it opens.
  useEffect(() => {
    if (open !== 'catalog') return;
    let live = true;
    api
      .get<Item[]>(`/trips/${trip.id}/suggestions`)
      .then((r) => live && setSuggested(r))
      .catch(() => live && setSuggested([]));
    return () => {
      live = false;
    };
  }, [open, trip.id]);

  return (
    <>
      <Menu open={open === 'menu'} onClose={close} anchor={props.anchor} title={trip.name}>
        <ActionList
          actions={[
            {
              icon: 'settings',
              label: 'Trip details and bags',
              onClick: () => nav(`/trips/${trip.id}/details`),
            },
            {
              icon: 'tmpl',
              label: 'Save as template',
              onClick: () => (setName(trip.name), setOpen('template')),
            },
            {
              icon: 'download',
              label: 'Download as CSV',
              onClick: () => (window.location.href = `/api/trips/${trip.id}/export.csv`),
            },
            {
              icon: 'reset',
              label: 'Reset all to unpacked',
              onClick: () => setOpen('reset'),
              hidden: !props.rows.some((r) => r.packed),
              danger: true,
            },
          ]}
        />
      </Menu>

      <Sheet
        open={open === 'reset'}
        onClose={close}
        title="Reset all to unpacked?"
        footer={
          <>
            <ErrorText>{error}</ErrorText>
            <div className="ml-auto flex">
              <GhostButton onClick={close}>Cancel</GhostButton>
              <PrimaryButton
                disabled={busy}
                onClick={() =>
                  run(() => api.post(`/trips/${trip.id}/reset-packed`), 'Everything is unpacked')
                }
              >
                Reset
              </PrimaryButton>
            </div>
          </>
        }
      >
        <p className="py-2 text-sm text-soft">
          Every item on {trip.name} will be marked not packed.
        </p>
      </Sheet>

      <Sheet
        open={open === 'template'}
        onClose={close}
        title="Save as template"
        footer={
          <>
            <ErrorText>{error}</ErrorText>
            <div className="ml-auto flex">
              <GhostButton onClick={close}>Cancel</GhostButton>
              <PrimaryButton
                disabled={busy || !name.trim()}
                onClick={() =>
                  run(async () => {
                    await api.post(`/trips/${trip.id}/save-as-template`, { name });
                    await qc.invalidateQueries({ queryKey: keys.state });
                  }, `Saved template “${name.trim()}”`)
                }
              >
                Save
              </PrimaryButton>
            </div>
          </>
        }
      >
        <FieldRow icon="tmpl" label="Template name" htmlFor="tpl-name">
          <TextInput
            id="tpl-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </FieldRow>
        <p className="pt-3 text-sm text-soft">
          The list, people, quantities and carry-on choices are saved. Packed checkmarks aren’t.
        </p>
      </Sheet>

      <CatalogPicker
        open={open === 'catalog'}
        title={`Add to ${trip.name}`}
        items={props.catalog}
        suggested={suggested}
        existing={props.rows.reduce(
          (m, r) => (r.item_id ? m.set(r.item_id, (m.get(r.item_id) ?? 0) + 1) : m),
          new Map<string, number>(),
        )}
        existingLabel="On trip"
        onClose={close}
        onAdd={async (ids) => {
          await api.post(`/trips/${trip.id}/items/from-catalog`, { item_ids: ids });
          props.onChanged();
        }}
      />
    </>
  );
}
