import { useId, useRef, useState, type InputHTMLAttributes } from 'react';
import { cx, TextInput } from './ui';

export interface Suggestion {
  value: string;
  label: string;
  sub?: string;
}

/**
 * A text field with a scrollable list of matches under it, for picking from long lists
 * (airports, time zones). The list spans the nearest positioned ancestor, so put this in a
 * `relative` row to make it as wide as the row.
 */
export function Suggest({
  value,
  onChange,
  suggestions,
  onPick,
  className,
  onBlur,
  ...input
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: string;
  onChange: (text: string) => void;
  suggestions: Suggestion[];
  onPick: (s: Suggestion) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const shown = open && suggestions.length > 0;

  function pick(s: Suggestion) {
    clearTimeout(closeTimer.current);
    onPick(s);
    setOpen(false);
  }

  return (
    <>
      <TextInput
        {...input}
        className={className}
        value={value}
        role="combobox"
        aria-expanded={shown}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onBlur={(e) => {
          closeTimer.current = setTimeout(() => setOpen(false), 150);
          onBlur?.(e);
        }}
        onChange={(e) => {
          onChange(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (!shown) return;
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const n = suggestions.length;
            setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            pick(suggestions[active]!);
          } else if (e.key === 'Escape') {
            e.stopPropagation();
            setOpen(false);
          }
        }}
      />
      {shown && (
        <ul
          id={listId}
          role="listbox"
          className="absolute top-full right-0 left-0 z-30 mt-1 max-h-64 overflow-y-auto overscroll-contain rounded-xl border border-line bg-surface py-1 shadow-xl"
        >
          {suggestions.map((s, i) => (
            <li
              key={s.value}
              role="option"
              aria-selected={i === active}
              className={cx(
                'flex cursor-pointer items-baseline gap-2.5 px-3 py-2 text-[15px]',
                i === active && 'bg-chip',
              )}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(s)}
            >
              <span className="flex-none font-medium text-ink">{s.label}</span>
              {s.sub && <span className="min-w-0 truncate text-[13px] text-soft">{s.sub}</span>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
