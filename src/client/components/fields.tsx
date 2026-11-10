import { useId, useState, type ReactNode } from 'react';
import type { Person } from '@shared/types';
import { packLabel, type PackChoice } from '@shared/logic';
import { Icon } from './Icon';
import { Pick, PersonDot, Sheet, TextInput, cx } from './ui';

/** Free text with suggestions. */
export function Combo({
  id,
  value,
  onChange,
  options,
  placeholder,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
}) {
  const listId = useId();
  return (
    <>
      <TextInput
        id={id}
        list={listId}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
      />
      <datalist id={listId}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
    </>
  );
}

/** Pick one (or none) from suggestions, or type a new one. */
export function OnePicker({
  value,
  onChange,
  options,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  options: string[];
}) {
  const [custom, setCustom] = useState('');
  const all =
    value && !options.some((o) => o.toLowerCase() === value.toLowerCase())
      ? [...options, value]
      : options;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {all.map((o) => (
        <Pick
          key={o}
          on={value?.toLowerCase() === o.toLowerCase()}
          onClick={() => onChange(value?.toLowerCase() === o.toLowerCase() ? null : o)}
        >
          {o}
        </Pick>
      ))}
      <AddTag value={custom} setValue={setCustom} onAdd={(t) => onChange(t)} />
    </div>
  );
}

/** Multi-select tags from suggestions, plus custom ones. */
export function TagPicker({
  value,
  onChange,
  options,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  options: string[];
}) {
  const [custom, setCustom] = useState('');
  const lower = value.map((v) => v.toLowerCase());
  const all = [
    ...options,
    ...value.filter((v) => !options.some((o) => o.toLowerCase() === v.toLowerCase())),
  ];
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {all.map((o) => {
        const on = lower.includes(o.toLowerCase());
        return (
          <Pick
            key={o}
            on={on}
            onClick={() =>
              onChange(
                on ? value.filter((v) => v.toLowerCase() !== o.toLowerCase()) : [...value, o],
              )
            }
          >
            {o}
          </Pick>
        );
      })}
      <AddTag
        value={custom}
        setValue={setCustom}
        onAdd={(t) => !lower.includes(t.toLowerCase()) && onChange([...value, t])}
      />
    </div>
  );
}

function AddTag({
  value,
  setValue,
  onAdd,
}: {
  value: string;
  setValue: (v: string) => void;
  onAdd: (t: string) => void;
}) {
  const add = () => {
    const t = value.trim();
    if (t) onAdd(t);
    setValue('');
  };
  return (
    <span className="inline-flex items-center gap-1 rounded-full border-2 border-dashed border-line px-2.5 py-[1px]">
      <Icon name="plus" size={13} className="text-faint" />
      <input
        aria-label="Add your own"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
        placeholder="New"
        className="w-16 bg-transparent text-sm focus:outline-none"
      />
    </span>
  );
}

const samePack = (a: PackChoice | null, b: PackChoice | null) =>
  typeof a === 'object' && typeof b === 'object' && a && b
    ? a.type.toLowerCase() === b.type.toLowerCase()
    : a === b;

/**
 * Auto pack: luggage, carry-on, a bag type (or a new one), or no bag. With `inherit`, a
 * first option (null) uses someone else's choice, labelled with it.
 */
export function PackPicker({
  value,
  onChange,
  types,
  inherit,
  main = true,
  noBag = true,
}: {
  value: PackChoice | null;
  onChange: (v: PackChoice | null) => void;
  types: string[];
  inherit?: string;
  main?: boolean;
  noBag?: boolean;
}) {
  const [custom, setCustom] = useState('');
  const typed =
    typeof value === 'object' && value && !types.some((t) => samePack({ type: t }, value))
      ? [...types, value.type]
      : types;
  const options: PackChoice[] = [
    ...(main ? (['main'] as const) : []),
    'carry_on',
    ...typed.map((type) => ({ type })),
    ...(noBag ? (['none'] as const) : []),
  ];
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {inherit !== undefined && (
        <Pick on={value === null} onClick={() => onChange(null)}>
          {inherit}
        </Pick>
      )}
      {options.map((o) => (
        <Pick key={packLabel(o)} on={samePack(value, o)} onClick={() => onChange(o)}>
          {packLabel(o)}
        </Pick>
      ))}
      <AddTag value={custom} setValue={setCustom} onAdd={(type) => onChange({ type })} />
    </div>
  );
}

export function PeoplePicker({
  people,
  value,
  onChange,
}: {
  people: Person[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  if (!people.length)
    return <span className="text-sm text-faint">Add people under More → People.</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {people.map((p) => {
        const on = value.includes(p.id);
        return (
          <Pick
            key={p.id}
            on={on}
            onClick={() => onChange(on ? value.filter((v) => v !== p.id) : [...value, p.id])}
          >
            <PersonDot person={p} />
            {p.name}
          </Pick>
        );
      })}
    </div>
  );
}

export function NumberInput({
  id,
  value,
  onChange,
  placeholder,
  step = 'any',
}: {
  id?: string;
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder?: string;
  step?: string;
}) {
  return (
    <TextInput
      id={id}
      type="number"
      inputMode="decimal"
      min={0}
      step={step}
      value={value ?? ''}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      className="tnum"
    />
  );
}

/**
 * A whole number that can go below zero, with − and + buttons: the iPhone number pad has no
 * minus key. Null shows `placeholder` (a default being inherited) until a button is tapped.
 */
export function OffsetStepper({
  id,
  value,
  onChange,
  placeholder,
  base = 0,
}: {
  id?: string;
  value: number | null;
  onChange: (v: number) => void;
  placeholder?: string;
  /** Where the first tap starts from when the value is null. */
  base?: number;
}) {
  const cur = value ?? base;
  const btn =
    'flex h-10 w-10 flex-none items-center justify-center rounded-full border border-line bg-surface text-soft active:bg-chip';
  return (
    <div className="flex items-center gap-3">
      <button type="button" className={btn} aria-label="Less" onClick={() => onChange(cur - 1)}>
        <Icon name="minus" size={16} />
      </button>
      <output
        id={id}
        aria-live="polite"
        className={cx(
          'min-w-12 text-center font-mono text-base tnum',
          value === null ? 'text-faint' : 'text-ink',
        )}
      >
        {value === null ? (placeholder ?? signed(base)) : signed(value)}
      </output>
      <button type="button" className={btn} aria-label="More" onClick={() => onChange(cur + 1)}>
        <Icon name="plus" size={16} />
      </button>
    </div>
  );
}

const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');

/**
 * A tap-to-open picker: shows the current value like a select, opens a sheet
 * listing the options, and lets you add a new one.
 */
export function SelectSheet({
  id,
  value,
  onChange,
  options,
  title,
  placeholder = 'Choose',
  allowNone = true,
}: {
  id?: string;
  value: string | null;
  onChange: (v: string | null) => void;
  options: string[];
  title: string;
  placeholder?: string;
  allowNone?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const all =
    value && !options.some((o) => o.toLowerCase() === value.toLowerCase())
      ? [...options, value]
      : options;
  const needle = q.trim().toLowerCase();
  const shown = needle ? all.filter((o) => o.toLowerCase().includes(needle)) : all;
  const exact = all.some((o) => o.toLowerCase() === needle);
  const pick = (v: string | null) => {
    onChange(v);
    setOpen(false);
    setQ('');
  };
  return (
    <>
      <button
        id={id}
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-left text-base"
      >
        <span className={value ? 'text-ink' : 'text-faint'}>{value || placeholder}</span>
        <Icon name="chevDown" size={16} className="text-soft" />
      </button>
      <Sheet
        open={open}
        onClose={() => {
          setOpen(false);
          setQ('');
        }}
        title={title}
      >
        <form
          className="sticky top-0 z-10 bg-surface pb-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (shown.length === 1) pick(shown[0]!);
            else if (needle && !exact) pick(q.trim());
          }}
        >
          <div className="flex items-center gap-2 rounded-xl border border-line bg-bg px-3 py-2">
            <Icon name="search" size={16} className="text-faint" />
            <input
              aria-label={`Search ${title.toLowerCase()}`}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search or add new"
              className="flex-1 bg-transparent text-base focus:outline-none"
            />
          </div>
        </form>
        <div className="flex flex-col">
          {allowNone && !needle && (
            <OptionRow on={!value} onClick={() => pick(null)}>
              <span className="text-soft">None</span>
            </OptionRow>
          )}
          {shown.map((o) => (
            <OptionRow
              key={o}
              on={value?.toLowerCase() === o.toLowerCase()}
              onClick={() => pick(o)}
            >
              {o}
            </OptionRow>
          ))}
          {needle && !exact && (
            <OptionRow on={false} onClick={() => pick(q.trim())}>
              <span className="inline-flex items-center gap-2 text-accent">
                <Icon name="plus" size={16} />
                Add “{q.trim()}”
              </span>
            </OptionRow>
          )}
        </div>
      </Sheet>
    </>
  );
}

function OptionRow({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className="flex items-center gap-3 border-b border-line py-3 text-left text-base"
    >
      <span className="flex-1">{children}</span>
      {on && <Icon name="check" size={16} className="text-accent" strokeWidth={2.2} />}
    </button>
  );
}
