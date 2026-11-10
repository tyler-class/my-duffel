import { useState } from 'react';
import { cx, Sheet } from './ui';

// A small, curated set: people first, then animals and a few fun ones.
const GROUPS: [string, string[]][] = [
  [
    'People',
    [
      '👩',
      '👨',
      '🧑',
      '👧',
      '👦',
      '🧒',
      '👶',
      '👵',
      '👴',
      '🧓',
      '👱‍♀️',
      '👱‍♂️',
      '👩‍🦰',
      '👨‍🦰',
      '👩‍🦱',
      '👨‍🦱',
      '👩‍🦳',
      '👨‍🦳',
      '👩‍🦲',
      '👨‍🦲',
      '🧔',
      '🧔‍♀️',
      '👸',
      '🤴',
      '🦸‍♀️',
      '🦸‍♂️',
      '🧚',
      '🧜‍♀️',
      '🧙',
      '🤓',
      '😎',
      '🥳',
      '😊',
      '🙂',
      '😄',
      '🤠',
    ],
  ],
  [
    'Animals',
    [
      '🐥',
      '🐣',
      '🐻',
      '🐼',
      '🐨',
      '🐯',
      '🦁',
      '🐶',
      '🐱',
      '🐰',
      '🦊',
      '🐸',
      '🐵',
      '🐧',
      '🦉',
      '🐢',
      '🐬',
      '🐳',
      '🦄',
      '🦋',
      '🐝',
      '🐞',
      '🦖',
      '🐙',
    ],
  ],
  [
    'Fun',
    [
      '⭐️',
      '🌈',
      '☀️',
      '🌙',
      '🌸',
      '🌻',
      '🍓',
      '🍉',
      '🍦',
      '🧁',
      '⚽️',
      '🏀',
      '🎸',
      '🎨',
      '🚀',
      '✈️',
      '🚗',
      '⛵️',
      '🏖️',
      '⛰️',
      '🎈',
      '💎',
      '❤️',
      '🧸',
    ],
  ],
];

/** Pick an emoji from a grid, or type your own. Shows the current one like a field. */
export function EmojiPicker({
  id,
  value,
  onChange,
  name,
}: {
  id?: string;
  value: string;
  onChange: (emoji: string) => void;
  name: string;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState('');
  const pick = (e: string) => {
    onChange(e);
    setOpen(false);
  };
  return (
    <>
      <button
        id={id}
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-3 text-left"
      >
        <span className="grid h-11 w-11 place-items-center rounded-full bg-chip text-2xl">
          {value || (
            <span className="text-base font-semibold text-soft">
              {name.trim()[0]?.toUpperCase() ?? '?'}
            </span>
          )}
        </span>
        <span className="text-[15px] text-accent">{value ? 'Change' : 'Choose an emoji'}</span>
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Choose an emoji">
        <div className="flex flex-col gap-4 pb-3">
          {GROUPS.map(([label, list]) => (
            <section key={label} className="flex flex-col gap-2">
              <h3 className="text-xs text-soft">{label}</h3>
              <div className="grid grid-cols-7 gap-1 sm:grid-cols-9">
                {list.map((e) => (
                  <button
                    key={e}
                    type="button"
                    aria-label={e}
                    aria-pressed={value === e}
                    onClick={() => pick(e)}
                    className={cx(
                      'grid aspect-square place-items-center rounded-full text-2xl',
                      value === e ? 'bg-accent-tint ring-2 ring-accent' : 'hover:bg-chip',
                    )}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </section>
          ))}
          <form
            className="flex items-center gap-2 border-t border-line pt-3"
            onSubmit={(ev) => {
              ev.preventDefault();
              if (custom.trim()) pick(custom.trim());
            }}
          >
            <input
              aria-label="Type any emoji"
              value={custom}
              maxLength={16}
              onChange={(ev) => setCustom(ev.target.value)}
              placeholder="Or type any emoji"
              className="flex-1 bg-transparent text-base focus:outline-none"
            />
            {custom.trim() && (
              <button type="submit" className="text-[15px] text-accent">
                Use
              </button>
            )}
            {value && !custom.trim() && (
              <button type="button" className="text-[15px] text-soft" onClick={() => pick('')}>
                Remove
              </button>
            )}
          </form>
        </div>
      </Sheet>
    </>
  );
}
