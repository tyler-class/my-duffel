import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { bagFit, shortBagLabel, tripLength, unassignedCount } from '@shared/logic';
import type { AppState, Trip, TripBag, TripDetail } from '@shared/types';
import { api } from '../lib/api';
import { keys, useAppState, useTrip } from '../lib/queries';
import { useSave } from '../lib/useSave';
import { plural } from '../lib/format';
import { Icon } from '../components/Icon';
import { BagSheet, type BagDraft } from '../components/BagSheet';
import { NumberInput, OnePicker, PeoplePicker, TagPicker } from '../components/fields';
import { useToast } from '../components/Toast';
import {
  cx,
  DangerButton,
  Empty,
  ErrorText,
  FieldRow,
  GhostButton,
  PageHeader,
  PrimaryButton,
  SectionLabel,
  Sheet,
  Switch,
  TextInput,
} from '../components/ui';

interface Form {
  name: string;
  start_date: string;
  end_date: string;
  days: number | null;
  nights: number | null;
  destination: string;
  trip_type: string | null;
  climate: string | null;
  activities: string[];
  travelers: string[];
  notes: string;
  archived: boolean;
}

const toForm = (t: Trip): Form => ({
  name: t.name,
  start_date: t.start_date ?? '',
  end_date: t.end_date ?? '',
  days: t.days,
  nights: t.nights,
  destination: t.destination ?? '',
  trip_type: t.trip_type,
  climate: t.climate,
  activities: t.activities,
  travelers: t.travelers,
  notes: t.notes ?? '',
  archived: !!t.archived_at,
});

export function TripSettings() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const { data: state } = useAppState();
  const { data: detail, error: loadError } = useTrip(id);
  if (loadError)
    return (
      <Empty
        title="Trip not found"
        action={<GhostButton onClick={() => nav('/')}>Back to trips</GhostButton>}
      />
    );
  if (!detail || !state) return null;
  return <TripSettingsBody key={detail.trip.id} detail={detail} state={state} />;
}

function TripSettingsBody({ detail, state }: { detail: TripDetail; state: AppState }) {
  const nav = useNavigate();
  const { run, busy, error } = useSave();
  const [form, setForm] = useState<Form>(() => toForm(detail.trip));
  const [bagSheet, setBagSheet] = useState<TripBag | 'new' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [fillCount, setFillCount] = useState(0);
  const toast = useToast();

  const fits = useMemo(() => {
    const items = new Map(state.items.map((i) => [i.id, i]));
    const suitcases = new Map(state.suitcases.map((s) => [s.id, s]));
    const rows = detail.items.map((r) => {
      const it = r.item_id ? items.get(r.item_id) : undefined;
      return {
        ...r,
        length_in: it?.length_in ?? null,
        width_in: it?.width_in ?? null,
        height_in: it?.height_in ?? null,
        no_bag: r.no_bag || !!it?.not_in_suitcase,
      };
    });
    return detail.bags.map((b) => ({
      bag: b,
      fit: bagFit(b.id, b.suitcase_id ? (suitcases.get(b.suitcase_id) ?? null) : null, rows),
    }));
  }, [detail, state]);

  const trip = detail.trip;
  const set = (p: Partial<Form>) => setForm((f) => ({ ...f, ...p }));
  const fromDates = tripLength(form.start_date || null, form.end_date || null);
  const unassigned = unassignedCount(detail.items);
  const missingDims = fits.reduce((n, f) => n + (f.fit.capacityL ? f.fit.missingDims : 0), 0);

  async function saveTrip() {
    const datesChanged =
      form.start_date !== (trip.start_date ?? '') || form.end_date !== (trip.end_date ?? '');
    const lengthEdited = form.days !== trip.days || form.nights !== trip.nights;
    const body: Record<string, unknown> = {
      name: form.name,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      destination: form.destination,
      trip_type: form.trip_type,
      climate: form.climate,
      activities: form.activities,
      travelers: form.travelers,
      notes: form.notes,
      archived: form.archived,
    };
    // Manual days/nights win until the dates change again.
    if (lengthEdited && !datesChanged)
      Object.assign(body, { days: form.days, nights: form.nights });
    const saved = await run(
      () => api.patch<TripDetail>(`/trips/${trip.id}`, body),
      [keys.trip(trip.id)],
    );
    if (saved) {
      // People added to the trip get their things from its template or the trip it copied.
      const added = saved.items.length - detail.items.length;
      if (added > 0)
        toast({ text: `Added ${added} item${added === 1 ? '' : 's'} for the new travelers` });
      nav(`/trips/${trip.id}`);
    }
  }

  async function saveBag(b: BagDraft) {
    const ok = await run(
      () =>
        bagSheet === 'new'
          ? api.post(`/trips/${trip.id}/bags`, b)
          : api.patch(`/trip-bags/${(bagSheet as TripBag).id}`, b),
      [keys.trip(trip.id)],
    );
    if (ok) {
      setBagSheet(null);
      // A new or re-owned bag may be the home some waiting items were missing.
      const { moves } = await api.get<{ moves: unknown[] }>(`/trips/${trip.id}/placements`);
      if (moves.length) setFillCount(moves.length);
    }
  }

  return (
    <div className="pb-12">
      <PageHeader title={trip.name} back />

      <SectionLabel icon="bag">Bags</SectionLabel>
      <div className="px-6">
        {fits.map(({ bag, fit }) => (
          <button
            key={bag.id}
            onClick={() => setBagSheet(bag)}
            className="flex w-full flex-col gap-1.5 border-b border-line py-3 text-left"
          >
            <span className="flex items-center gap-2">
              <Icon name={bag.carry_on ? 'backpack' : 'bag'} size={16} className="text-soft" />
              <span className="flex-1 text-base">{shortBagLabel(bag.label, trip.name)}</span>
              {bag.carry_on && (
                <span className="rounded bg-accent-tint px-1.5 py-px text-[11px] font-medium text-accent">
                  Carry-on
                </span>
              )}
              <span className="text-xs text-soft tnum">{plural(fit.itemCount, 'item')}</span>
            </span>
            {fit.capacityL ? (
              <span className="flex items-center gap-3 pl-6">
                <span className="h-[3px] flex-1 overflow-hidden rounded bg-track">
                  <span
                    className={cx('block h-full', fit.warn ? 'bg-danger' : 'bg-accent')}
                    style={{ width: `${Math.min(100, fit.pct ?? 0)}%` }}
                  />
                </span>
                <span className={cx('text-xs tnum', fit.warn ? 'text-danger' : 'text-soft')}>
                  {fit.usedL} / {fit.capacityL} L
                </span>
              </span>
            ) : (
              <span className="pl-6 text-xs text-faint">
                {bag.suitcase_id
                  ? 'Add a capacity to this suitcase to see how full it is.'
                  : 'Link a suitcase to see how full it is.'}
              </span>
            )}
          </button>
        ))}
        {unassigned > 0 && (
          <button
            className="pt-3 text-left text-sm text-accent"
            onClick={() => nav(`/trips/${trip.id}?select=waiting`)}
          >
            {plural(unassigned, 'item')} still need a bag. Sort them now →
          </button>
        )}
        {missingDims > 0 && (
          <p className="pt-1 text-xs text-faint">
            {plural(missingDims, 'item')} have no size yet, so fullness is an underestimate.
          </p>
        )}
        <GhostButton icon="plus" className="-ml-3 mt-1" onClick={() => setBagSheet('new')}>
          Add bag
        </GhostButton>
      </div>

      <SectionLabel icon="settings">Details</SectionLabel>
      <div className="px-6">
        <FieldRow icon="tag" label="Name" htmlFor="t-name">
          <TextInput
            id="t-name"
            value={form.name}
            onChange={(e) => set({ name: e.target.value })}
          />
        </FieldRow>
        <FieldRow icon="cal">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor="t-start" className="text-xs text-soft">
                Leaving
              </label>
              <TextInput
                id="t-start"
                type="date"
                value={form.start_date}
                onChange={(e) => set({ start_date: e.target.value })}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor="t-end" className="text-xs text-soft">
                Back
              </label>
              <TextInput
                id="t-end"
                type="date"
                value={form.end_date}
                min={form.start_date || undefined}
                onChange={(e) => set({ end_date: e.target.value })}
              />
            </div>
          </div>
        </FieldRow>
        <FieldRow
          icon="moon"
          hint={
            fromDates
              ? 'Set from the dates. Change these to override until the dates change.'
              : 'Used to scale per-day and per-night items.'
          }
        >
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <label htmlFor="t-days" className="text-xs text-soft">
                Days
              </label>
              <NumberInput
                id="t-days"
                step="1"
                value={form.days}
                onChange={(days) => set({ days })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="t-nights" className="text-xs text-soft">
                Nights
              </label>
              <NumberInput
                id="t-nights"
                step="1"
                value={form.nights}
                onChange={(nights) => set({ nights })}
              />
            </div>
          </div>
        </FieldRow>
        <FieldRow icon="map" label="Destination" htmlFor="t-dest">
          <TextInput
            id="t-dest"
            value={form.destination}
            onChange={(e) => set({ destination: e.target.value })}
          />
        </FieldRow>
        <FieldRow icon="plane" label="Trip type">
          <OnePicker
            value={form.trip_type}
            onChange={(trip_type) => set({ trip_type })}
            options={state.lookups.tripType ?? []}
          />
        </FieldRow>
        <FieldRow icon="users" label="Travelers">
          <PeoplePicker
            people={state.people}
            value={form.travelers}
            onChange={(travelers) => set({ travelers })}
          />
        </FieldRow>
        <FieldRow icon="weather" label="Weather">
          <OnePicker
            value={form.climate}
            onChange={(climate) => set({ climate })}
            options={state.lookups.climate ?? []}
          />
        </FieldRow>
        <FieldRow icon="run" label="Activities">
          <TagPicker
            value={form.activities}
            onChange={(activities) => set({ activities })}
            options={state.lookups.activity ?? []}
          />
        </FieldRow>
        <FieldRow icon="note" label="Notes" htmlFor="t-notes">
          <TextInput
            id="t-notes"
            value={form.notes}
            onChange={(e) => set({ notes: e.target.value })}
          />
        </FieldRow>
        <FieldRow
          icon="archive"
          hint="Trips also move to Past when everything is packed or a week after they end."
        >
          <div className="flex items-center justify-between">
            <span className="text-base">Archived</span>
            <Switch
              label="Archived"
              on={form.archived}
              onChange={(archived) => set({ archived })}
            />
          </div>
        </FieldRow>
        <div className="flex flex-col gap-3 pt-5">
          <ErrorText>{error}</ErrorText>
          <PrimaryButton onClick={saveTrip} disabled={busy || !form.name.trim()}>
            Save
          </PrimaryButton>
          <div className="flex justify-between">
            <GhostButton
              icon="copy"
              className="-ml-3"
              onClick={() => nav(`/trips/new?clone=${trip.id}`)}
            >
              Copy to a new trip
            </GhostButton>
            <DangerButton onClick={() => setConfirmDelete(true)}>Delete trip</DangerButton>
          </div>
        </div>
      </div>

      <BagSheet
        open={bagSheet !== null}
        initial={
          bagSheet && bagSheet !== 'new'
            ? {
                // Show the name without the trip's name in front ("Lisbon - Sam carry-on").
                label: shortBagLabel(bagSheet.label, trip.name),
                suitcase_id: bagSheet.suitcase_id,
                role: bagSheet.role,
                carry_on: bagSheet.carry_on,
                notes: bagSheet.notes,
                people: bagSheet.people,
              }
            : undefined
        }
        suitcases={state.suitcases}
        people={state.people}
        error={error}
        onClose={() => setBagSheet(null)}
        onSave={saveBag}
        onDelete={
          bagSheet && bagSheet !== 'new'
            ? async () => {
                const res = await run(
                  () => api.del<{ moved?: number }>(`/trip-bags/${bagSheet.id}`),
                  [keys.trip(trip.id)],
                );
                if (res) {
                  setBagSheet(null);
                  toast({
                    text: res.moved
                      ? `Bag removed. ${plural(res.moved, 'item')} moved to No bag.`
                      : 'Bag removed.',
                  });
                }
              }
            : undefined
        }
      />
      <Sheet
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete ${trip.name}?`}
        footer={
          <>
            <GhostButton onClick={() => setConfirmDelete(false)}>Cancel</GhostButton>
            <PrimaryButton
              tone="danger"
              onClick={async () => {
                if (await run(() => api.del(`/trips/${trip.id}`))) nav('/', { replace: true });
              }}
            >
              Delete
            </PrimaryButton>
          </>
        }
      >
        <p className="py-2 text-sm text-soft">
          The trip, its bags and its {plural(detail.items.length, 'item')} are removed. Templates
          and the catalog stay.
        </p>
      </Sheet>
      <Sheet
        open={fillCount > 0}
        onClose={() => setFillCount(0)}
        title="Fill the bag?"
        footer={
          <>
            <GhostButton onClick={() => setFillCount(0)}>Not now</GhostButton>
            <PrimaryButton
              disabled={busy}
              onClick={async () => {
                const res = await run(
                  () => api.post<{ moved: number }>(`/trips/${trip.id}/placements/apply`),
                  [keys.trip(trip.id)],
                );
                setFillCount(0);
                if (res) toast({ text: `Moved ${plural(res.moved, 'item')} into their bags` });
              }}
            >
              Move {plural(fillCount, 'item')}
            </PrimaryButton>
          </>
        }
      >
        <p className="py-2 text-sm text-soft">
          {plural(fillCount, 'item')} in No bag now {fillCount === 1 ? 'has' : 'have'} a matching
          bag. Move {fillCount === 1 ? 'it' : 'them'} in?
        </p>
      </Sheet>
    </div>
  );
}
