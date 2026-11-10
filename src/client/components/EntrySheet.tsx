import { useState } from 'react';
import {
  ENTRY_KIND_LABELS,
  ENTRY_KINDS,
  TRANSPORT_MODE_LABELS,
  TRANSPORT_MODES,
  type EntryKind,
  type TransportMode,
} from '@shared/lookups';
import {
  endInstant,
  findAirport,
  isTimeZone,
  searchAirports,
  type AirportData,
} from '@shared/logic';
import type { EntryEnd, ItineraryEntry } from '@shared/types';
import { allZones, useAirports, zoneName } from '../lib/itinerary';
import { Icon, type IconName } from './Icon';
import { Suggest } from './Suggest';
import { useToast } from './Toast';
import {
  DangerButton,
  ErrorText,
  FieldRow,
  GhostButton,
  Pick,
  PrimaryButton,
  Sheet,
  SlideToggle,
  TextInput,
} from './ui';

export interface EntryDraft {
  kind: EntryKind;
  mode: TransportMode | null;
  title: string | null;
  carrier: string | null;
  number: string | null;
  start: EntryEnd;
  end: EntryEnd;
  address: string | null;
  confirmation: string | null;
  details: string | null;
  notes: string | null;
}

const EMPTY_END: EntryEnd = { place: null, code: null, date: null, time: null, tz: null };

export const draftOf = (e: ItineraryEntry): EntryDraft => ({
  kind: e.kind,
  mode: e.mode,
  title: e.title,
  carrier: e.carrier,
  number: e.number,
  start: e.start,
  end: e.end,
  address: e.address,
  confirmation: e.confirmation,
  details: e.details,
  notes: e.notes,
});

export const KIND_ICONS: Record<EntryKind, IconName> = {
  transport: 'plane',
  lodging: 'bed',
  plan: 'ticket',
  note: 'note',
};
export const MODE_ICONS: Record<TransportMode, IconName> = {
  plane: 'plane',
  train: 'train',
  bus: 'bus',
  boat: 'boat',
  car: 'car',
  other: 'route',
};

const CARRIER: Record<TransportMode, [string, string]> = {
  plane: ['Airline', 'Flight'],
  train: ['Rail company', 'Train'],
  bus: ['Bus company', 'Route'],
  boat: ['Ferry line', 'Sailing'],
  car: ['Rental company', 'Reservation'],
  other: ['Company', 'Number'],
};
const usesCodes = (m: TransportMode | null) => m === 'plane' || m === 'train';

type Props = {
  open: boolean;
  initial: Partial<EntryDraft>;
  editing?: boolean;
  /** The zone to start with when nothing else says: the last one on the trip. */
  zone: string;
  onClose: () => void;
  onSave: (d: EntryDraft) => Promise<void>;
  onDelete?: () => void;
};

/** Add or edit an itinerary entry: transport, lodging, a plan or a note. */
export function EntrySheet(props: Props) {
  if (!props.open) return null;
  return <EntrySheetBody {...props} />;
}

const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

function EntrySheetBody({ initial, editing, zone, onClose, onSave, onDelete }: Props) {
  const airports = useAirports();
  const [d, setD] = useState<EntryDraft>(() => ({
    kind: 'plan',
    mode: null,
    title: null,
    carrier: null,
    number: null,
    address: null,
    confirmation: null,
    details: null,
    notes: null,
    ...initial,
    start: { ...EMPTY_END, tz: zone, ...initial.start },
    end: { ...EMPTY_END, tz: zone, ...initial.end },
  }));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<EntryDraft>) => setD((x) => ({ ...x, ...p }));
  const setEnd = (side: 'start' | 'end', p: Partial<EntryEnd>) =>
    setD((x) => {
      const next = { ...x, [side]: { ...x[side], ...p } };
      // One zone for a stay or plan; the arrival day follows the departure until it's set.
      if (side === 'start' && x.kind !== 'transport' && p.tz !== undefined)
        next.end = { ...next.end, tz: p.tz };
      if (
        side === 'start' &&
        p.date &&
        x.kind !== 'lodging' &&
        (!x.end.date || x.end.date === x.start.date)
      )
        next.end = { ...next.end, date: p.date };
      return next;
    });
  const mode = d.mode ?? 'plane';
  const [carrierLabel, numberLabel] = CARRIER[mode];

  function cleaned(): EntryDraft {
    const end = (e: EntryEnd): EntryEnd => ({
      place: clean(e.place),
      code: clean(e.code)?.toUpperCase() ?? null,
      date: e.date || null,
      time: e.time || null,
      tz: clean(e.tz),
    });
    const out: EntryDraft = {
      ...d,
      mode: d.kind === 'transport' ? mode : null,
      title: clean(d.title),
      carrier: d.kind === 'transport' ? clean(d.carrier) : null,
      number: d.kind === 'transport' ? clean(d.number) : null,
      start: end(d.start),
      end: end(d.end),
      address: clean(d.address),
      confirmation: clean(d.confirmation),
      details: clean(d.details),
      notes: clean(d.notes),
    };
    if (d.kind !== 'transport') {
      out.start.code = out.end.code = null;
      out.end.tz = out.start.tz;
      out.end.place = null;
    }
    if (d.kind === 'plan' && out.end.time && !out.end.date) out.end.date = out.start.date;
    if (d.kind === 'plan' && !out.end.time) out.end.date = null;
    if (d.kind === 'note') out.end = { ...EMPTY_END };
    return out;
  }

  async function save() {
    const x = cleaned();
    if (x.kind === 'note' ? !x.notes && !x.title : x.kind === 'transport' ? false : !x.title)
      return setError(x.kind === 'note' ? 'Write the note.' : 'Give it a name.');
    for (const e of [x.start, x.end])
      if (e.tz && !isTimeZone(e.tz))
        return setError(`“${e.tz}” isn’t a time zone. Pick one from the list.`);
    const a = endInstant(x.start);
    const b = endInstant(x.end);
    if (a !== null && b !== null && b < a)
      return setError('The end is before the start. Check the dates, times and time zones.');
    setBusy(true);
    setError('');
    try {
      await onSave(x);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that.');
    } finally {
      setBusy(false);
    }
  }

  const title = editing ? `Edit ${ENTRY_KIND_LABELS[d.kind].toLowerCase()}` : 'Add to itinerary';
  return (
    <Sheet
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          {editing && onDelete ? <DangerButton onClick={onDelete}>Delete</DangerButton> : <span />}
          <div className="flex items-center">
            <GhostButton onClick={onClose}>Cancel</GhostButton>
            <PrimaryButton onClick={save} disabled={busy}>
              {editing ? 'Save' : 'Add'}
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
        {!editing && (
          <FieldRow icon="layers" label="Type">
            {/* Icons show only when there is room for all four with them. */}
            <div className="@container">
              <SlideToggle<EntryKind>
                label="Type"
                value={d.kind}
                onChange={(kind) => set({ kind })}
                options={ENTRY_KINDS.map((k) => [
                  k,
                  <>
                    <Icon name={KIND_ICONS[k]} size={15} className="hidden @min-[372px]:block" />
                    {ENTRY_KIND_LABELS[k]}
                  </>,
                ])}
              />
            </div>
          </FieldRow>
        )}

        {d.kind === 'transport' && (
          <>
            <FieldRow icon={MODE_ICONS[mode]} label="By">
              <div className="flex flex-wrap gap-1.5">
                {TRANSPORT_MODES.map((m) => (
                  <Pick key={m} on={mode === m} onClick={() => set({ mode: m })}>
                    {TRANSPORT_MODE_LABELS[m]}
                  </Pick>
                ))}
              </div>
            </FieldRow>
            <FieldRow icon="tag" label={`${carrierLabel} and ${numberLabel.toLowerCase()}`}>
              <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2">
                <TextInput
                  aria-label={carrierLabel}
                  value={d.carrier ?? ''}
                  placeholder={mode === 'plane' ? 'e.g. American Airlines' : carrierLabel}
                  onChange={(e) => set({ carrier: e.target.value })}
                />
                <TextInput
                  aria-label={numberLabel}
                  value={d.number ?? ''}
                  placeholder={mode === 'plane' ? 'e.g. 2417' : '#'}
                  onChange={(e) => set({ number: e.target.value })}
                />
              </div>
            </FieldRow>
            <EndFields
              label="Departs"
              icon="upload"
              value={d.start}
              codes={usesCodes(mode)}
              airports={airports}
              onChange={(p) => setEnd('start', p)}
            />
            <EndFields
              label="Arrives"
              icon="download"
              value={d.end}
              codes={usesCodes(mode)}
              airports={airports}
              onChange={(p) => setEnd('end', p)}
            />
          </>
        )}

        {d.kind !== 'transport' && (
          <FieldRow
            icon={KIND_ICONS[d.kind]}
            label={
              d.kind === 'lodging' ? 'Where you’re staying' : d.kind === 'note' ? 'Title' : 'What'
            }
            htmlFor="entry-title"
          >
            <TextInput
              id="entry-title"
              autoFocus={!editing}
              value={d.title ?? ''}
              placeholder={
                d.kind === 'lodging'
                  ? 'e.g. Casa do Rio'
                  : d.kind === 'note'
                    ? 'Optional'
                    : 'e.g. Dinner at Taberna, Aquarium tickets'
              }
              onChange={(e) => set({ title: e.target.value })}
            />
          </FieldRow>
        )}

        {d.kind === 'lodging' && (
          <>
            <WhenRow
              label="Check in"
              value={d.start}
              onChange={(p) => setEnd('start', p)}
              icon="cal"
            />
            <WhenRow
              label="Check out"
              value={d.end}
              onChange={(p) => setEnd('end', p)}
              icon="cal"
            />
            <ZoneRow
              value={d.start.tz}
              date={d.start.date}
              onChange={(tz) => setEnd('start', { tz })}
            />
          </>
        )}

        {d.kind === 'plan' && (
          <>
            <FieldRow icon="cal" label="When">
              <TextInput
                type="date"
                aria-label="Date"
                className="min-w-0"
                value={d.start.date ?? ''}
                onChange={(e) => setEnd('start', { date: e.target.value || null })}
              />
              <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
                <TextInput
                  type="time"
                  aria-label="Starts"
                  className="min-w-0"
                  value={d.start.time ?? ''}
                  onChange={(e) => setEnd('start', { time: e.target.value || null })}
                />
                <span className="text-sm text-faint">to</span>
                <TextInput
                  type="time"
                  aria-label="Ends"
                  className="min-w-0"
                  value={d.end.time ?? ''}
                  onChange={(e) => setEnd('end', { time: e.target.value || null })}
                />
              </div>
            </FieldRow>
            <FieldRow icon="pin" label="Place" htmlFor="entry-place">
              <TextInput
                id="entry-place"
                value={d.start.place ?? ''}
                placeholder="Optional"
                onChange={(e) => setEnd('start', { place: e.target.value })}
              />
            </FieldRow>
            <ZoneRow
              value={d.start.tz}
              date={d.start.date}
              onChange={(tz) => setEnd('start', { tz })}
            />
          </>
        )}

        {d.kind === 'note' && (
          <FieldRow icon="cal" label="Date">
            <TextInput
              type="date"
              aria-label="Date"
              value={d.start.date ?? ''}
              onChange={(e) => setEnd('start', { date: e.target.value || null })}
            />
          </FieldRow>
        )}

        {(d.kind === 'lodging' || d.kind === 'plan') && (
          <FieldRow icon="map" label="Address" htmlFor="entry-address">
            <TextInput
              id="entry-address"
              value={d.address ?? ''}
              placeholder="Optional"
              onChange={(e) => set({ address: e.target.value })}
            />
          </FieldRow>
        )}

        {d.kind !== 'note' && (
          <FieldRow icon="hash" label="Confirmation or booking number" htmlFor="entry-conf">
            <TextInput
              id="entry-conf"
              value={d.confirmation ?? ''}
              autoCapitalize="characters"
              placeholder="Optional"
              onChange={(e) => set({ confirmation: e.target.value })}
            />
          </FieldRow>
        )}
        {d.kind === 'transport' && (
          <FieldRow icon="info" label="Seats, terminal, gate" htmlFor="entry-details">
            <TextInput
              id="entry-details"
              value={d.details ?? ''}
              placeholder="e.g. 23A–D · Terminal E"
              onChange={(e) => set({ details: e.target.value })}
            />
          </FieldRow>
        )}
        <FieldRow icon="note" label="Notes" htmlFor="entry-notes">
          <textarea
            id="entry-notes"
            rows={d.kind === 'note' ? 5 : 3}
            value={d.notes ?? ''}
            autoFocus={!editing && d.kind === 'note'}
            placeholder={d.kind === 'note' ? 'e.g. Passports are in the blue folder' : 'Optional'}
            onChange={(e) => set({ notes: e.target.value })}
            className="w-full resize-none rounded-xl border border-line bg-surface px-3 py-2 text-base text-ink transition-colors placeholder:text-faint/55 focus:border-accent focus:outline-none"
          />
        </FieldRow>
        <button type="submit" hidden />
        <div className="pt-3">
          <ErrorText>{error}</ErrorText>
        </div>
      </form>
    </Sheet>
  );
}

/** Date and time on one line. */
function WhenRow({
  label,
  icon,
  value,
  onChange,
}: {
  label: string;
  icon: IconName;
  value: EntryEnd;
  onChange: (p: Partial<EntryEnd>) => void;
}) {
  return (
    <FieldRow icon={icon} label={label}>
      <div className="grid grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] gap-2">
        <TextInput
          type="date"
          aria-label={`${label} date`}
          className="min-w-0"
          value={value.date ?? ''}
          onChange={(e) => onChange({ date: e.target.value || null })}
        />
        <TextInput
          type="time"
          aria-label={`${label} time`}
          className="min-w-0"
          value={value.time ?? ''}
          onChange={(e) => onChange({ time: e.target.value || null })}
        />
      </div>
    </FieldRow>
  );
}

/** A departure or arrival: airport or station, place, date, time and zone. */
function EndFields({
  label,
  icon,
  value,
  codes,
  airports,
  onChange,
}: {
  label: string;
  icon: IconName;
  value: EntryEnd;
  codes: boolean;
  airports: AirportData | null;
  onChange: (p: Partial<EntryEnd>) => void;
}) {
  const [code, setCode] = useState(value.code ?? '');
  const found = airports && codes ? findAirport(airports, value.code) : null;
  const options = airports && codes && code.trim() ? searchAirports(airports, code) : [];

  function typeCode(raw: string) {
    const v = raw.trim().toUpperCase();
    setCode(v);
    const a = airports ? findAirport(airports, v) : null;
    onChange(a ? { code: v, place: a.city || a.name, tz: a.tz } : { code: v || null });
  }

  return (
    <div className="border-b border-line py-3">
      <div className="flex items-center gap-3.5 pb-2">
        <Icon name={icon} className="text-faint" />
        <span className="text-xs text-soft">{label}</span>
      </div>
      <div className="flex flex-col gap-2 pl-8">
        <div className={codes ? 'relative grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2' : ''}>
          {codes && (
            <Suggest
              aria-label={`${label}: airport or station code`}
              className="min-w-0 font-mono uppercase"
              value={code}
              placeholder="BOS"
              autoCapitalize="characters"
              spellCheck={false}
              onChange={typeCode}
              suggestions={options.map((a) => ({
                value: a.code,
                label: a.code,
                sub: [a.city, a.name].filter(Boolean).join(' · '),
              }))}
              onPick={(s) => typeCode(s.value)}
            />
          )}
          <TextInput
            aria-label={`${label}: place`}
            value={value.place ?? ''}
            placeholder={codes ? 'City or station' : 'Place'}
            onChange={(e) => onChange({ place: e.target.value })}
          />
        </div>
        {found && <span className="text-xs text-faint">{found.name}</span>}
        <div className="grid grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] gap-2">
          <TextInput
            type="date"
            aria-label={`${label}: date`}
            className="min-w-0"
            value={value.date ?? ''}
            onChange={(e) => onChange({ date: e.target.value || null })}
          />
          <TextInput
            type="time"
            aria-label={`${label}: local time`}
            className="min-w-0"
            value={value.time ?? ''}
            onChange={(e) => onChange({ time: e.target.value || null })}
          />
        </div>
        <ZonePicker
          value={value.tz}
          at={value.date ? endInstant({ ...value, time: value.time ?? '12:00' }) : null}
          onChange={(tz) => onChange({ tz })}
          label={label}
        />
      </div>
    </div>
  );
}

function ZoneRow({
  value,
  date,
  onChange,
}: {
  value: string | null;
  date: string | null;
  onChange: (tz: string) => void;
}) {
  return (
    <FieldRow icon="clock" label="Time zone">
      <ZonePicker
        value={value}
        at={date ? endInstant({ place: null, code: null, date, time: '12:00', tz: value }) : null}
        onChange={onChange}
        label="Time zone"
      />
    </FieldRow>
  );
}

/** The zone, shown as "Local time · Europe/Lisbon (WEST)"; tap to change it. */
function ZonePicker({
  value,
  at,
  onChange,
  label,
}: {
  value: string | null;
  /** When the time is, so the name shows summer or winter time correctly. */
  at?: number | null;
  onChange: (tz: string) => void;
  label: string;
}) {
  const [editing, setEditing] = useState(false);
  const [now] = useState(() => Date.now());
  const [text, setText] = useState(value ?? '');
  const toast = useToast();
  const q = text.trim().toLowerCase().replace(/\s+/g, '_');
  const zones = allZones();
  const matches = (q ? zones.filter((z) => z.toLowerCase().includes(q)) : zones).slice(0, 200);
  if (!editing)
    return (
      <button
        type="button"
        className="inline-flex items-center gap-1.5 self-start text-xs text-soft"
        onClick={() => setEditing(true)}
      >
        <Icon name="clock" size={13} />
        {value ? `${value.replace(/_/g, ' ')} · ${zoneName(value, at ?? now)}` : 'No time zone'}
        <span className="text-accent">Change</span>
      </button>
    );
  return (
    <div className="relative">
      <Suggest
        aria-label={`${label}: time zone`}
        autoFocus
        value={text}
        placeholder="City or region, e.g. Lisbon"
        spellCheck={false}
        onChange={setText}
        suggestions={matches.map((z) => ({
          value: z,
          label: z.split('/').at(-1)!.replace(/_/g, ' '),
          sub: `${z.split('/').slice(0, -1).join(' / ').replace(/_/g, ' ')} · ${zoneName(z, at ?? now)}`,
        }))}
        onPick={(s) => {
          onChange(s.value);
          setEditing(false);
        }}
        onBlur={() =>
          setTimeout(() => {
            const v = text.trim();
            if (isTimeZone(v)) onChange(v);
            else if (v && v !== value)
              toast({ text: `“${v}” isn’t a time zone. Pick one from the list.` });
            setEditing(false);
          }, 200)
        }
      />
    </div>
  );
}
