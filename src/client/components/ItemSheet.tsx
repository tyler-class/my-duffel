import { useId, useMemo, useState } from 'react';
import type { Item, Person, TripBag, TripItem } from '@shared/types';
import { calcQty, displayQty, resolveCalc, rowCalc } from '@shared/logic';
import { QTY_MODE_LABELS } from '@shared/lookups';
import { Icon } from './Icon';
import { SelectSheet } from './fields';
import {
  DangerButton,
  ErrorText,
  FieldRow,
  GhostButton,
  Pick,
  PersonDot,
  PrimaryButton,
  Sheet,
  SlideToggle,
  Stepper,
  TextInput,
} from './ui';

export type Placement = { trip_bag_id: string | null; no_bag: boolean };

export interface ItemDraft {
  name: string;
  person_id: string | null;
  /** Add mode: everyone the new item is for. One row is created per person; empty means Shared. */
  people: string[];
  trip_bag_id: string | null;
  no_bag: boolean;
  notes: string;
  qty: number | null;
  qtyTouched: boolean;
  /** A fixed number instead of the catalog rule; stays put when trip dates change. */
  custom: boolean;
  /** Item group. Undefined = not chosen yet (adding: the catalog item's). */
  category?: string | null;
}

export interface SaveResult {
  item_id?: string | null;
  name: string;
  person_id: string | null;
  /** Add mode only: create one row per person (empty = one Shared row). */
  person_ids?: string[];
  trip_bag_id: string | null;
  no_bag: boolean;
  notes: string | null;
  qty?: number | null;
  qty_override?: number | null;
  category?: string | null;
}

function bagHint(bags: TripBag[], draft: ItemDraft): string {
  const bag = draft.no_bag ? undefined : bags.find((b) => b.id === draft.trip_bag_id);
  if (!bag) return 'Not packed in a bag.';
  return bag.carry_on ? 'Carry-on bag, so this counts as carry-on.' : 'Checked bag.';
}

function blankDraft(row: TripItem | undefined, initial: Partial<ItemDraft> | undefined): ItemDraft {
  if (row) {
    return {
      name: row.name,
      person_id: row.person_id,
      people: row.person_id ? [row.person_id] : [],
      trip_bag_id: row.trip_bag_id,
      no_bag: row.no_bag,
      notes: row.notes ?? '',
      qty: displayQty(row),
      qtyTouched: false,
      custom: row.qty_override !== null,
      category: row.category,
    };
  }
  return {
    name: '',
    person_id: null,
    people: initial?.person_id ? [initial.person_id] : [],
    trip_bag_id: null,
    no_bag: false,
    notes: '',
    qty: 1,
    qtyTouched: false,
    custom: false,
    ...initial,
  };
}

type ItemSheetProps = {
  /** The trip's travelers: what “Everyone” selects. */
  travelers?: string[];
  open: boolean;
  mode: 'add' | 'edit';
  row?: TripItem;
  initial?: Partial<ItemDraft>;
  people: Person[];
  bags: TripBag[];
  catalog: Item[];
  len: { days: number | null; nights: number | null } | null;
  onClose: () => void;
  onSave: (r: SaveResult) => Promise<void>;
  onDelete?: () => void;
  bagName: (b: TripBag) => string;
  /** Group names to choose from. */
  categories: string[];
};

/** Add or edit one row on a trip's list. */
export function ItemSheet(props: ItemSheetProps) {
  if (!props.open) return null;
  return <ItemSheetBody key={props.row?.id ?? 'new'} {...props} />;
}

function ItemSheetBody(props: ItemSheetProps) {
  const { open, mode, row, people, bags, catalog, len } = props;
  const everyone = props.travelers?.length
    ? people.filter((p) => props.travelers!.includes(p.id)).map((p) => p.id)
    : people.map((p) => p.id);
  const listId = useId();
  const [draft, setDraft] = useState<ItemDraft>(() => blankDraft(row, props.initial));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const match = useMemo(() => {
    const n = draft.name.trim().toLowerCase();
    return n ? catalog.find((i) => !i.archived && i.name.toLowerCase() === n) : undefined;
  }, [draft.name, catalog]);

  // What the calculation would give: the row's snapshot when editing, or the catalog item when adding.
  const calc =
    row?.calc_mode && row.calc_unit_qty !== null
      ? rowCalc(row)
      : !row && match
        ? resolveCalc(match)
        : null;
  const calculated = calc ? calcQty(calc, len) : null;
  const shownQty = calc && !draft.custom ? calculated : draft.qty;

  const set = (patch: Partial<ItemDraft>) => setDraft((d) => ({ ...d, ...patch }));

  async function save() {
    const name = draft.name.trim();
    if (!name) {
      setError('Enter an item name.');
      return;
    }
    setBusy(true);
    setError('');
    const base = {
      name,
      person_id: draft.person_id,
      ...(mode === 'add' ? { person_ids: draft.people } : {}),
      trip_bag_id: draft.no_bag ? null : draft.trip_bag_id,
      no_bag: draft.no_bag,
      ...(draft.category !== undefined ? { category: draft.category } : {}),
      notes: draft.notes.trim() || null,
    };
    let result: SaveResult;
    if (mode === 'add') {
      result = match
        ? {
            ...base,
            item_id: match.id,
            qty_override: draft.custom ? draft.qty : null,
          }
        : { ...base, item_id: null, qty: draft.qty ?? 1 };
    } else if (calc) {
      result = {
        ...base,
        qty_override: draft.custom ? draft.qty : null,
      };
    } else {
      result = { ...base, qty: draft.qty, qty_override: null };
    }
    try {
      await props.onSave(result);
      props.onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that.');
    } finally {
      setBusy(false);
    }
  }

  const ruleText = calc
    ? calc.mode === 'fixed'
      ? `${calc.unitQty}`
      : `${calc.unitQty} ${QTY_MODE_LABELS[calc.mode].toLowerCase()}${calc.offset ? ` ${calc.offset > 0 ? '+' : '−'}${Math.abs(calc.offset)}` : ''}${calc.max ? `, max ${calc.max}` : ''}`
    : '';
  const qtyHint = !calc
    ? null
    : draft.custom
      ? 'Stays at this number when trip dates change.'
      : calculated === null
        ? 'Set trip dates to calculate.'
        : calc.mode === 'fixed'
          ? 'Catalog default.'
          : 'Updates when trip dates change.';

  return (
    <Sheet
      open={open}
      onClose={props.onClose}
      title={mode === 'add' ? 'Add item' : 'Edit item'}
      footer={
        <>
          {mode === 'edit' && props.onDelete ? (
            <DangerButton onClick={props.onDelete}>Delete</DangerButton>
          ) : (
            <span />
          )}
          <div className="flex items-center">
            <GhostButton onClick={props.onClose}>Cancel</GhostButton>
            <PrimaryButton onClick={save} disabled={busy}>
              {busy ? 'Saving…' : mode === 'add' ? 'Add' : 'Save'}
            </PrimaryButton>
          </div>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <FieldRow icon="tag" label="Item" htmlFor="item-name">
          <TextInput
            id="item-name"
            autoFocus={mode === 'add'}
            list={listId}
            value={draft.name}
            placeholder="e.g. Swim diapers"
            autoComplete="off"
            enterKeyHint="done"
            onChange={(e) => set({ name: e.target.value })}
          />
          <datalist id={listId}>
            {catalog
              .filter((i) => !i.archived)
              .map((i) => (
                <option key={i.id} value={i.name} />
              ))}
          </datalist>
        </FieldRow>
        <FieldRow icon="grid" label="Group" htmlFor="item-group">
          <SelectSheet
            id="item-group"
            title="Group"
            value={draft.category !== undefined ? draft.category : (match?.category ?? null)}
            onChange={(category) => set({ category })}
            options={props.categories}
            placeholder="No group"
          />
        </FieldRow>
        <FieldRow icon="hash" hint={qtyHint}>
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-soft">Quantity</span>
              <Stepper
                value={shownQty}
                onChange={(v) => set({ qty: v, qtyTouched: true, custom: !!calc })}
              />
            </div>
            {calc && (
              <SlideToggle<'catalog' | 'custom'>
                label="Quantity source"
                value={draft.custom ? 'custom' : 'catalog'}
                onChange={(v) =>
                  set(
                    v === 'custom'
                      ? { custom: true, qty: shownQty ?? 1, qtyTouched: true }
                      : { custom: false, qty: calculated },
                  )
                }
                options={[
                  ['catalog', `Catalog · ${ruleText}`],
                  ['custom', 'Custom'],
                ]}
              />
            )}
          </div>
        </FieldRow>
        {mode === 'add' ? (
          <FieldRow
            icon="user"
            label="For"
            hint={
              draft.people.length > 1
                ? `Adds ${draft.people.length} rows, one for each person.`
                : undefined
            }
          >
            <div className="flex flex-wrap gap-1.5">
              {everyone.length > 1 && (
                <Pick
                  on={everyone.every((id) => draft.people.includes(id))}
                  onClick={() =>
                    set({
                      people: everyone.every((id) => draft.people.includes(id)) ? [] : everyone,
                    })
                  }
                >
                  <Icon name="users" size={13} />
                  Everyone
                </Pick>
              )}
              {people.map((p) => {
                const on = draft.people.includes(p.id);
                return (
                  <Pick
                    key={p.id}
                    on={on}
                    onClick={() =>
                      set({
                        people: on
                          ? draft.people.filter((x) => x !== p.id)
                          : [...draft.people, p.id],
                      })
                    }
                  >
                    <PersonDot person={p} />
                    {p.name}
                  </Pick>
                );
              })}
              <Pick on={draft.people.length === 0} onClick={() => set({ people: [] })}>
                Shared
              </Pick>
            </div>
          </FieldRow>
        ) : (
          <FieldRow icon="user" label="For">
            <div className="flex flex-wrap gap-1.5">
              {people.map((p) => (
                <Pick
                  key={p.id}
                  on={draft.person_id === p.id}
                  onClick={() => set({ person_id: p.id })}
                >
                  <PersonDot person={p} />
                  {p.name}
                </Pick>
              ))}
              <Pick on={draft.person_id === null} onClick={() => set({ person_id: null })}>
                <Icon name="users" size={13} />
                Shared
              </Pick>
            </div>
          </FieldRow>
        )}
        <FieldRow icon="bag" label="Bag" hint={bagHint(bags, draft)}>
          <div className="flex flex-wrap gap-1.5">
            {bags.map((b) => (
              <Pick
                key={b.id}
                on={!draft.no_bag && draft.trip_bag_id === b.id}
                onClick={() => set({ trip_bag_id: b.id, no_bag: false })}
              >
                <Icon name={b.carry_on ? 'backpack' : 'bag'} size={13} />
                {props.bagName(b)}
              </Pick>
            ))}
            <Pick
              on={draft.no_bag || !draft.trip_bag_id}
              onClick={() => set({ no_bag: true, trip_bag_id: null })}
            >
              <Icon name="nobag" size={13} />
              No bag
            </Pick>
          </div>
        </FieldRow>
        <FieldRow icon="note" label="Notes" htmlFor="item-notes">
          <TextInput
            id="item-notes"
            value={draft.notes}
            placeholder="Size, brand, anything to remember"
            onChange={(e) => set({ notes: e.target.value })}
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
