import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { localToday, splitTrips, tripLength } from '@shared/logic';
import type { TripDetail } from '@shared/types';
import { api } from '../lib/api';
import { useAppState } from '../lib/queries';
import { useSave } from '../lib/useSave';
import { formatRange, gapText, plural } from '../lib/format';
import { Icon, type IconName } from '../components/Icon';
import { BagSheet, type BagDraft } from '../components/BagSheet';
import { OnePicker, PeoplePicker, TagPicker } from '../components/fields';
import {
  cx,
  ErrorText,
  FieldRow,
  GhostButton,
  PersonDot,
  Sheet,
  PageHeader,
  Pick,
  PrimaryButton,
  TextInput,
} from '../components/ui';

type Start = 'template' | 'clone' | 'blank';
interface Preview {
  rows: number;
  unplaced: { person_id: string | null; carry: boolean; pack_type: string | null; count: number }[];
}

export function NewTrip() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { data } = useAppState();
  const { run, busy, error, setError } = useSave();
  const [start, setStart] = useState<Start>(
    params.get('template') ? 'template' : params.get('clone') ? 'clone' : 'template',
  );
  const [templateId, setTemplateId] = useState<string | null>(params.get('template'));
  const [cloneId, setCloneId] = useState<string | null>(params.get('clone'));
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [destination, setDestination] = useState('');
  const [travelers, setTravelers] = useState<string[] | null>(null);
  const [climate, setClimate] = useState<string | null>(null);
  const [activities, setActivities] = useState<string[] | null>(null);
  const [bags, setBags] = useState<BagDraft[]>([]);
  const [bagSheet, setBagSheet] = useState<number | 'new' | null>(null);
  const [check, setCheck] = useState<Preview | null>(null);

  const pastTrips = useMemo(() => {
    if (!data) return [];
    const { active, archived } = splitTrips(data.trips, localToday());
    return [...archived, ...active];
  }, [data]);
  if (!data) return null;

  const tpl = data.templates.find((t) => t.id === templateId);
  const src = data.trips.find((t) => t.id === cloneId);
  // Nobody is pre-selected: you pick who's going.
  const effectiveTravelers = travelers ?? [];
  const effectiveClimate =
    climate ??
    (start === 'template'
      ? (tpl?.climate ?? null)
      : start === 'clone'
        ? (src?.climate ?? null)
        : null);
  const effectiveActivities =
    activities ??
    (start === 'template'
      ? (tpl?.activities ?? [])
      : start === 'clone'
        ? (src?.activities ?? [])
        : []);
  const len = tripLength(startDate || null, endDate || null);

  const options: [Start, string, string, IconName][] = [
    [
      'template',
      'From a template',
      data.templates.length
        ? data.templates
            .map((t) => t.name)
            .slice(0, 3)
            .join(', ')
        : 'No templates yet',
      'tmpl',
    ],
    ['clone', 'Copy a past trip', 'Same list and bags, all unpacked', 'copy'],
    ['blank', 'Start blank', 'Add items as you go', 'compose'],
  ];

  async function create(skipCheck = false) {
    if (!name.trim()) return setError('Give the trip a name.');
    if (data?.people.length && !effectiveTravelers.length) return setError('Pick who’s traveling.');
    if (start === 'template' && !templateId) return setError('Pick a template.');
    if (start === 'clone' && !cloneId) return setError('Pick a trip to copy.');
    if (startDate && endDate && !len) return setError('The return date is before the start date.');
    const source =
      start === 'template'
        ? { kind: 'template', template_id: templateId }
        : start === 'clone'
          ? { kind: 'clone', trip_id: cloneId }
          : { kind: 'blank' };
    const payload = {
      name,
      start_date: startDate || null,
      end_date: endDate || null,
      destination,
      travelers: effectiveTravelers,
      climate: effectiveClimate,
      activities: effectiveActivities,
      trip_type: start === 'template' ? (tpl?.trip_type ?? null) : null,
      source,
      bags,
    };
    // Before creating, check whether any items would be left without a bag.
    if (!skipCheck && start !== 'clone') {
      const preview = await run(() => api.post<Preview>('/trips/preview', payload));
      if (!preview) return;
      if (preview.unplaced.length) {
        setCheck(preview);
        return;
      }
    }
    setCheck(null);
    const created = await run(() => api.post<TripDetail>('/trips', payload));
    if (created) {
      nav(`/trips/${created.trip.id}`, { replace: true });
    }
  }

  return (
    <div className="pb-10">
      <PageHeader title="New trip" back="/" />
      <div className="px-5">
        <div className="flex flex-col border-t border-line">
          {options.map(([v, title, sub, icon]) => (
            <button
              key={v}
              aria-pressed={start === v}
              onClick={() => setStart(v)}
              className="flex items-center gap-3.5 border-b border-line py-3 text-left"
            >
              <span
                className={cx(
                  'grid h-10 w-10 flex-none place-items-center rounded-[10px]',
                  start === v ? 'bg-accent-tint text-accent' : 'bg-chip text-soft',
                )}
              >
                <Icon name={icon} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className={cx('text-base', start === v && 'font-semibold')}>{title}</span>
                <span className="truncate text-[13px] text-soft">{sub}</span>
              </span>
              <span
                className={cx(
                  'h-[18px] w-[18px] flex-none rounded-full',
                  start === v ? 'border-[5px] border-accent' : 'border-[1.5px] border-faint',
                )}
              />
            </button>
          ))}
        </div>

        {start === 'template' && (
          <FieldRow icon="tmpl" label="Template">
            <div className="flex flex-wrap gap-1.5">
              {data.templates.map((t) => (
                <Pick key={t.id} on={templateId === t.id} onClick={() => setTemplateId(t.id)}>
                  {t.name}
                </Pick>
              ))}
              {!data.templates.length && (
                <span className="text-sm text-faint">
                  Make one under More → Templates, or save a trip as a template.
                </span>
              )}
            </div>
          </FieldRow>
        )}
        {start === 'clone' && (
          <FieldRow icon="copy" label="Copy from">
            <div className="flex flex-wrap gap-1.5">
              {pastTrips.map((t) => (
                <Pick key={t.id} on={cloneId === t.id} onClick={() => setCloneId(t.id)}>
                  {t.name}
                  {t.start_date && (
                    <span className="text-faint">{formatRange(t.start_date, t.end_date)}</span>
                  )}
                </Pick>
              ))}
              {!pastTrips.length && (
                <span className="text-sm text-faint">No trips to copy yet.</span>
              )}
            </div>
          </FieldRow>
        )}

        <FieldRow icon="pin" label="Name" htmlFor="trip-name">
          <TextInput
            id="trip-name"
            value={name}
            placeholder="e.g. Lisbon"
            onChange={(e) => setName(e.target.value)}
          />
        </FieldRow>
        <FieldRow
          icon="cal"
          hint={
            len
              ? `${plural(len.days, 'day')} · ${plural(len.nights, 'night')}. Per-day items scale to fit.`
              : 'Dates set quantities for per-day items.'
          }
        >
          <div className="grid grid-cols-2 gap-4">
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor="start" className="text-xs text-soft">
                Leaving
              </label>
              <TextInput
                id="start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor="end" className="text-xs text-soft">
                Back
              </label>
              <TextInput
                id="end"
                type="date"
                value={endDate}
                min={startDate || undefined}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>
        </FieldRow>
        <FieldRow icon="map" label="Destination" htmlFor="dest">
          <TextInput
            id="dest"
            value={destination}
            placeholder="Optional"
            onChange={(e) => setDestination(e.target.value)}
          />
        </FieldRow>
        <FieldRow icon="users" label="Travelers">
          <PeoplePicker people={data.people} value={effectiveTravelers} onChange={setTravelers} />
        </FieldRow>
        <FieldRow icon="weather" label="Weather" hint="Used to suggest catalog items.">
          <OnePicker
            value={effectiveClimate}
            onChange={setClimate}
            options={data.lookups.climate ?? []}
          />
        </FieldRow>
        <FieldRow icon="run" label="Activities">
          <TagPicker
            value={effectiveActivities}
            onChange={setActivities}
            options={data.lookups.activity ?? []}
          />
        </FieldRow>
        <FieldRow
          icon="bag"
          label="Bags"
          hint={
            start === 'clone'
              ? 'Bags from the copied trip come along. Add more here.'
              : start === 'template' && tpl?.bags.length
                ? 'From the template. Add more for this trip only.'
                : undefined
          }
        >
          <div className="flex flex-wrap gap-1.5">
            {start === 'template' &&
              tpl?.bags.map((b) => (
                <span
                  key={b.id}
                  className="inline-flex items-center gap-1.5 rounded-full border-2 border-dashed border-line px-2.5 py-[3px] text-sm text-soft"
                >
                  <Icon name={b.carry_on ? 'backpack' : 'bag'} size={13} />
                  {b.label}
                </span>
              ))}
            {bags.map((b, i) => (
              <Pick key={i} on onClick={() => setBagSheet(i)}>
                <Icon name={b.carry_on ? 'backpack' : 'bag'} size={13} />
                {b.label}
              </Pick>
            ))}
            <GhostButton icon="plus" className="py-1" onClick={() => setBagSheet('new')}>
              Add bag
            </GhostButton>
          </div>
        </FieldRow>

        <div className="flex flex-col gap-3 pt-5">
          <ErrorText>{error}</ErrorText>
          <PrimaryButton onClick={() => create()} disabled={busy}>
            {busy ? 'Creating…' : 'Create trip'}
          </PrimaryButton>
        </div>
      </div>

      <BagSheet
        open={bagSheet !== null}
        initial={typeof bagSheet === 'number' ? bags[bagSheet] : undefined}
        suitcases={data.suitcases}
        people={data.people}
        onClose={() => setBagSheet(null)}
        onSave={(b) => {
          setBags((cur) =>
            typeof bagSheet === 'number'
              ? cur.map((x, i) => (i === bagSheet ? b : x))
              : [...cur, b],
          );
          setBagSheet(null);
        }}
        onDelete={
          typeof bagSheet === 'number'
            ? () => (setBags((cur) => cur.filter((_, i) => i !== bagSheet)), setBagSheet(null))
            : undefined
        }
      />
      <Sheet
        open={!!check}
        onClose={() => setCheck(null)}
        title={
          check
            ? `${plural(
                check.unplaced.reduce((n, g) => n + g.count, 0),
                'item',
              )} won’t have a bag`
            : ''
        }
      >
        {check && (
          <div className="flex flex-col gap-4 pb-3">
            <div className="flex flex-col gap-1.5 rounded-2xl bg-chip px-4 py-3 text-sm text-soft">
              {check.unplaced.map((g) => {
                const p = data.people.find((x) => x.id === g.person_id);
                return (
                  <span
                    key={`${g.person_id}|${g.carry}|${g.pack_type}`}
                    className="flex items-center gap-2"
                  >
                    {p ? <PersonDot person={p} /> : <Icon name="users" size={14} />}
                    <span className="text-ink">{p?.name ?? 'Shared'}</span>
                    {gapText(g)}
                  </span>
                );
              })}
            </div>
            <p className="text-sm text-soft">
              They’d start in No bag. You can add bags first, or create the trip and sort them into
              bags later.
            </p>
            <div className="flex flex-col gap-2">
              {start === 'template' && templateId && (
                <PrimaryButton icon="tmpl" onClick={() => nav(`/templates/${templateId}`)}>
                  Add bags to the template
                </PrimaryButton>
              )}
              <PrimaryButton
                icon="bag"
                tone={start === 'template' ? 'secondary' : undefined}
                onClick={() => {
                  setCheck(null);
                  setBagSheet('new');
                }}
              >
                Add bags to this trip
              </PrimaryButton>
              <GhostButton className="justify-center" onClick={() => create(true)}>
                Create anyway
              </GhostButton>
            </div>
          </div>
        )}
      </Sheet>
    </div>
  );
}
