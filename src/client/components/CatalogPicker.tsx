import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type { Item, Person } from '@shared/types';
import { api, errorMessage } from '../lib/api';
import { keys } from '../lib/queries';
import { PeoplePicker } from './fields';
import { Icon } from './Icon';
import { cx, ErrorText, GhostButton, PrimaryButton, Sheet } from './ui';

type PickerProps = {
  open: boolean;
  title: string;
  items: Item[];
  suggested?: Item[];
  /** How many of each item are already there (shown, not hidden: duplicates are fine). */
  existing?: Map<string, number>;
  existingLabel?: string;
  /** Offer "Who packs these" for the whole selection. */
  people?: Person[];
  onClose: () => void;
  /** `people`: who packs them; empty = each item's usual people. */
  onAdd: (ids: string[], people: string[]) => Promise<void>;
};

/** Multi-select catalog items, with optional suggestions pinned on top. */
export function CatalogPicker(props: PickerProps) {
  if (!props.open) return null;
  return <PickerBody {...props} />;
}

function PickerBody(props: PickerProps) {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [people, setPeople] = useState<string[]>([]);
  const qc = useQueryClient();
  const name = q.trim();
  // Not in the catalog yet: offer to add it, so nothing has to be set up first.
  const canCreate =
    !!name && !props.items.some((i) => i.name.trim().toLowerCase() === name.toLowerCase());

  async function create() {
    setBusy(true);
    setError('');
    try {
      const item = await api.post<Item>('/items', { name });
      await qc.invalidateQueries({ queryKey: keys.state });
      setPicked((p) => new Set(p).add(item.id));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const suggestedIds = useMemo(
    () => new Set((props.suggested ?? []).map((i) => i.id)),
    [props.suggested],
  );
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const visible = props.items.filter(
      (i) =>
        !i.archived &&
        (!needle ||
          i.name.toLowerCase().includes(needle) ||
          (i.category ?? '').toLowerCase().includes(needle)),
    );
    const out = new Map<string, Item[]>();
    if (!needle && suggestedIds.size) {
      const s = visible.filter((i) => suggestedIds.has(i.id));
      if (s.length) out.set('Suggested for this trip', s);
    }
    for (const i of visible) {
      if (!needle && suggestedIds.has(i.id)) continue;
      const k = i.category || 'Other';
      if (!out.has(k)) out.set(k, []);
      out.get(k)!.push(i);
    }
    const sugg = out.get('Suggested for this trip');
    const rest = [...out.entries()]
      .filter(([k]) => k !== 'Suggested for this trip')
      .sort(([a], [b]) => (a === 'Other' ? 1 : b === 'Other' ? -1 : a.localeCompare(b)));
    return sugg ? [['Suggested for this trip', sugg] as [string, Item[]], ...rest] : rest;
  }, [props.items, q, suggestedIds]);

  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  async function add() {
    setBusy(true);
    setError('');
    try {
      await props.onAdd([...picked], people);
      props.onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add those.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={props.open}
      onClose={props.onClose}
      title={props.title}
      footer={
        <>
          <ErrorText>{error}</ErrorText>
          <div className="ml-auto flex items-center">
            <GhostButton onClick={props.onClose}>Cancel</GhostButton>
            <PrimaryButton onClick={add} disabled={!picked.size || busy}>
              {picked.size ? `Add ${picked.size}` : 'Add'}
            </PrimaryButton>
          </div>
        </>
      }
    >
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-surface py-2.5">
        <Icon name="search" className="text-faint" />
        <input
          aria-label="Search the catalog"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search, or type a new item"
          className="w-full bg-transparent text-base focus:outline-none"
        />
      </div>
      {props.people && props.people.length > 0 && (
        <div className="flex flex-col gap-1.5 border-b border-line py-3">
          <span className="text-xs text-soft">Who packs these</span>
          <PeoplePicker people={props.people} value={people} onChange={setPeople} />
          <span className="text-xs text-faint">
            {people.length ? 'One entry each.' : 'Nobody picked: each item’s usual people.'}
          </span>
        </div>
      )}
      {canCreate && (
        <button
          type="button"
          onClick={create}
          disabled={busy}
          className="flex w-full items-center gap-3 border-b border-line py-2.5 text-left text-accent"
        >
          <Icon name="plus" size={18} className="flex-none" />
          <span className="flex-1 text-base">Add “{name}” to the catalog</span>
        </button>
      )}
      {groups.length === 0 && !canCreate && (
        <p className="py-10 text-center text-sm text-soft">
          {props.items.length ? 'Nothing matches.' : 'Your catalog is empty. Search to add one.'}
        </p>
      )}
      {groups.map(([group, list]) => (
        <section key={group} className="pt-4">
          <h3 className="pb-1 text-xs tracking-[0.08em] text-soft uppercase">{group}</h3>
          {list.map((i) => {
            const on = picked.has(i.id);
            return (
              <button
                key={i.id}
                type="button"
                onClick={() => toggle(i.id)}
                aria-pressed={on}
                className="flex w-full items-center gap-3 border-b border-line py-2.5 text-left"
              >
                <span
                  className={cx(
                    'grid h-5 w-5 flex-none place-items-center rounded-md border-[1.5px]',
                    on ? 'border-accent bg-accent text-accent-ink' : 'border-faint',
                  )}
                >
                  {on && <Icon name="check" size={14} strokeWidth={2.4} />}
                </span>
                <span className="flex-1 text-base">{i.name}</span>
                {!!props.existing?.get(i.id) && (
                  <span className="text-xs text-faint tnum">
                    {props.existingLabel ?? 'Added'} ×{props.existing.get(i.id)}
                  </span>
                )}
              </button>
            );
          })}
        </section>
      ))}
    </Sheet>
  );
}
