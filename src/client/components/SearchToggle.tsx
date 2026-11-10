import { useRef, useState } from 'react';
import { Icon } from './Icon';
import { cx } from './ui';

/**
 * A round search button that grows leftward into a search field. It stays open while
 * there's text; ✕ or Escape clears and closes it.
 */
export function SearchToggle({
  value,
  onChange,
  label,
  onOpenChange,
}: {
  value: string;
  onChange: (v: string) => void;
  /** e.g. "Search this trip". */
  label: string;
  /** Lets the row hide other controls while the field is open. */
  onOpenChange?: (open: boolean) => void;
}) {
  const [opened, setOpened] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const open = opened || value !== '';
  const setOpen = (v: boolean) => {
    setOpened(v);
    onOpenChange?.(v);
  };
  const close = () => {
    onChange('');
    setOpen(false);
  };
  return (
    <div
      className={cx(
        'ml-auto flex h-[38px] min-w-0 flex-1 items-center justify-end overflow-hidden rounded-full bg-chip transition-[max-width] duration-200 ease-out',
        open ? 'max-w-[640px]' : 'max-w-[38px]',
      )}
    >
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => {
          setOpen(true);
          requestAnimationFrame(() => input.current?.focus());
        }}
        className="grid h-[38px] w-[38px] flex-none place-items-center text-soft"
      >
        <Icon name="search" size={17} />
      </button>
      {open && (
        <>
          <input
            ref={input}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && close()}
            onBlur={() => !value && setOpen(false)}
            placeholder="Search"
            aria-label={label}
            className="h-full min-w-0 flex-1 bg-transparent pr-1 text-base text-ink placeholder:text-faint/55 focus:outline-none"
          />
          <button
            type="button"
            aria-label="Clear search"
            onMouseDown={(e) => e.preventDefault()}
            onClick={close}
            className="grid h-[38px] w-9 flex-none place-items-center text-faint"
          >
            <Icon name="x" size={15} />
          </button>
        </>
      )}
    </div>
  );
}
