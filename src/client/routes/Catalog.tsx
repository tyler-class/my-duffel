import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { QTY_MODE_LABELS, type QtyMode } from '@shared/lookups';
import type { AppState, Item } from '@shared/types';
import { calcSummary, packChoice, packFields, packLabel, resolveCalc } from '@shared/logic';
import { api } from '../lib/api';
import { useAppState } from '../lib/queries';
import { useSave } from '../lib/useSave';
import { load, save } from '../lib/storage';
import { packHint } from '../lib/format';
import { Icon } from '../components/Icon';
import {
  NumberInput,
  OffsetStepper,
  PackPicker,
  PeoplePicker,
  SelectSheet,
  TagPicker,
} from '../components/fields';
import { CatalogHeader } from '../components/CatalogNav';
import { SwipeRow } from '../components/SwipeRow';
import { useToast } from '../components/Toast';
import {
  DangerButton,
  GhostButton,
  Empty,
  ErrorText,
  FieldRow,
  PageHeader,
  PersonDot,
  PrimaryButton,
  SlideToggle,
  Sheet,
  Switch,
  TextInput,
  SectionLabel,
} from '../components/ui';

function qtySummary(i: Item): string {
  const s = calcSummary(resolveCalc(i));
  return i.qty_mode !== 'fixed' && i.max_qty !== null ? `${s} · max ${i.max_qty}` : s;
}

export function Catalog() {
  const nav = useNavigate();
  const { data } = useAppState();
  const { run } = useSave();
  const toast = useToast();
  // An item on templates disappears from them when deleted, so say so and offer to archive.
  const [confirmDelete, setConfirmDelete] = useState<{ item: Item; templates: number } | null>(
    null,
  );
  const deleteItem = async (i: Item) => {
    setConfirmDelete(null);
    if (await run(() => api.del(`/items/${i.id}`))) toast({ text: `Deleted ${i.name}` });
  };
  const removeItem = (i: Item) => {
    const templates = (data?.templates ?? []).filter((t) =>
      t.items.some((ti) => ti.item_id === i.id),
    ).length;
    if (templates) setConfirmDelete({ item: i, templates });
    else void deleteItem(i);
  };
  const [q, setQ] = useState('');
  const [showArchived, setShowArchived] = useState(() => load('showArchived', false));
  const groups = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    const m = new Map<string, Item[]>();
    for (const i of data.items) {
      if (i.archived && !showArchived) continue;
      if (
        needle &&
        !i.name.toLowerCase().includes(needle) &&
        !(i.category ?? '').toLowerCase().includes(needle)
      )
        continue;
      const k = i.category || 'Other';
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(i);
    }
    return [...m.entries()].sort(([a], [b]) =>
      a === 'Other' ? 1 : b === 'Other' ? -1 : a.localeCompare(b),
    );
  }, [data, q, showArchived]);
  if (!data) return null;
  const people = new Map(data.people.map((p) => [p.id, p]));
  const archivedCount = data.items.filter((i) => i.archived).length;

  return (
    <div className="pb-10">
      <CatalogHeader addLabel="Item" onAdd={() => nav('/catalog/item/new')} />
      <Sheet
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title={`Delete ${confirmDelete?.item.name ?? 'item'}?`}
        footer={
          <>
            <GhostButton
              onClick={async () => {
                const i = confirmDelete!.item;
                setConfirmDelete(null);
                if (await run(() => api.patch(`/items/${i.id}`, { archived: true })))
                  toast({ text: `Archived ${i.name}` });
              }}
            >
              Archive instead
            </GhostButton>
            <PrimaryButton tone="danger" onClick={() => deleteItem(confirmDelete!.item)}>
              Delete
            </PrimaryButton>
          </>
        }
      >
        <p className="py-2 text-sm text-soft">
          It’s on{' '}
          {confirmDelete?.templates === 1 ? 'a template' : `${confirmDelete?.templates} templates`}{' '}
          and will be removed from {confirmDelete?.templates === 1 ? 'it' : 'them'}. Archiving hides
          it from the catalog but keeps it on templates.
        </p>
      </Sheet>
      <div className="mx-5 flex items-center gap-2 border-b border-line py-2.5">
        <Icon name="search" className="text-faint" />
        <input
          aria-label="Search the catalog"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search"
          className="w-full bg-transparent text-base focus:outline-none"
        />
      </div>
      {!data.items.length && (
        <Empty title="Your catalog is empty">
          Everything you might pack lives here, with how many to bring and who it’s for.
        </Empty>
      )}
      {groups.map(([cat, items]) => (
        <section key={cat}>
          <SectionLabel
            sticky
            trailing={<span className="text-xs text-soft tnum">{items.length}</span>}
          >
            {cat}
          </SectionLabel>
          {items.map((i) => (
            <SwipeRow
              key={i.id}
              id={i.id}
              onDelete={() => removeItem(i)}
              className="mx-6 border-b border-line"
            >
              <button
                onClick={() => nav(`/catalog/item/${i.id}`)}
                className="flex w-full items-center gap-3 py-3 text-left"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className={i.archived ? 'text-faint' : 'text-base'}>{i.name}</span>
                  <span className="flex items-center gap-2.5 text-[13px] text-soft">
                    {i.default_people.length > 0 && (
                      <span className="inline-flex items-center gap-1">
                        {i.default_people.map((p) => (
                          <PersonDot key={p} person={people.get(p)} />
                        ))}
                      </span>
                    )}
                    {packChoice(i) !== 'main' && (
                      <span className="inline-flex items-center gap-1">
                        <Icon
                          name={
                            i.not_in_suitcase ? 'nobag' : i.usually_carry_on ? 'backpack' : 'bag'
                          }
                          size={13}
                        />
                        {packLabel(packChoice(i))}
                      </span>
                    )}
                    {i.archived && <span>Archived</span>}
                  </span>
                </span>
                <span className="font-mono text-[13px] text-soft tnum">{qtySummary(i)}</span>
              </button>
            </SwipeRow>
          ))}
        </section>
      ))}
      {archivedCount > 0 && (
        <button
          className="px-5 pt-5 text-sm text-soft"
          onClick={() => (setShowArchived(!showArchived), save('showArchived', !showArchived))}
        >
          {showArchived ? 'Hide' : 'Show'} archived ({archivedCount})
        </button>
      )}
    </div>
  );
}

const emptyItem = (): Omit<Item, 'id'> => ({
  name: '',
  category: null,
  qty_mode: 'fixed',
  qty: 1,
  max_qty: null,
  qty_offset: 0,
  climate_tags: [],
  activity_tags: [],
  length_in: null,
  width_in: null,
  height_in: null,
  dimensions_source: null,
  not_in_suitcase: false,
  usually_carry_on: false,
  pack_type: null,
  notes: null,
  archived: false,
  default_people: [],
});

export function ItemEditor() {
  const { id = 'new' } = useParams();
  const { data } = useAppState();
  if (!data) return null;
  const existing = data.items.find((i) => i.id === id);
  if (id !== 'new' && !existing) return <Empty title="Item not found" />;
  return <ItemForm key={id} id={id} data={data} initial={existing ?? emptyItem()} />;
}

function ItemForm({
  id,
  data,
  initial,
}: {
  id: string;
  data: AppState;
  initial: Omit<Item, 'id'>;
}) {
  const nav = useNavigate();
  const { run, busy, error, setError } = useSave();
  const [f, setF] = useState<Omit<Item, 'id'>>(initial);
  const set = (p: Partial<Item>) => setF((cur) => ({ ...cur, ...p }));

  async function submit() {
    if (!f.name.trim()) return setError('Give the item a name.');
    const ok = await run(() =>
      id === 'new' ? api.post('/items', f) : api.patch(`/items/${id}`, f),
    );
    if (ok) nav('/catalog');
  }

  return (
    <div className="pb-12">
      <PageHeader title={id === 'new' ? 'New item' : f.name || 'Item'} back="/catalog" />
      <div className="px-5">
        <FieldRow icon="tag" label="Name" htmlFor="i-name">
          <TextInput
            id="i-name"
            value={f.name}
            autoFocus={id === 'new'}
            onChange={(e) => set({ name: e.target.value })}
          />
        </FieldRow>
        <FieldRow icon="grid" label="Category" htmlFor="i-cat">
          <SelectSheet
            id="i-cat"
            title="Category"
            value={f.category}
            onChange={(category) => set({ category })}
            options={data.lookups.category ?? []}
            placeholder="Choose a category"
          />
        </FieldRow>
        <FieldRow
          icon="hash"
          label="How many"
          hint={
            f.qty_mode === 'fixed'
              ? 'The same count on every trip.'
              : `Scales with trip length: ${f.qty} ${QTY_MODE_LABELS[f.qty_mode].toLowerCase()}${f.qty_offset ? `, ${f.qty_offset > 0 ? 'plus' : 'minus'} ${Math.abs(f.qty_offset)}` : ''}.`
          }
        >
          <SlideToggle<QtyMode>
            label="Quantity mode"
            value={f.qty_mode}
            onChange={(qty_mode) => set({ qty_mode })}
            options={[
              ['fixed', 'Fixed'],
              ['per_day', 'Per day'],
              ['per_night', 'Per night'],
            ]}
          />
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <label htmlFor="i-qty" className="text-xs text-soft">
                {f.qty_mode === 'fixed'
                  ? 'Count'
                  : `Count ${QTY_MODE_LABELS[f.qty_mode].toLowerCase()}`}
              </label>
              <NumberInput id="i-qty" value={f.qty} onChange={(v) => set({ qty: v ?? 0 })} />
            </div>
            {f.qty_mode !== 'fixed' && (
              <div className="flex flex-col gap-1">
                <label htmlFor="i-max" className="text-xs text-soft">
                  At most
                </label>
                <NumberInput
                  id="i-max"
                  value={f.max_qty}
                  placeholder="No limit"
                  onChange={(max_qty) => set({ max_qty })}
                />
              </div>
            )}
          </div>
          {f.qty_mode !== 'fixed' && (
            <div className="flex flex-col gap-1">
              <label htmlFor="i-offset" className="text-xs text-soft">
                Plus or minus
              </label>
              <OffsetStepper
                id="i-offset"
                value={f.qty_offset}
                onChange={(qty_offset) => set({ qty_offset })}
              />
            </div>
          )}
        </FieldRow>
        <FieldRow
          icon="user"
          label="Who packs this"
          hint="Each person gets their own entry when it goes on a trip. Nobody: one shared entry."
        >
          <PeoplePicker
            people={data.people}
            value={f.default_people}
            onChange={(default_people) => set({ default_people })}
          />
        </FieldRow>
        <FieldRow icon="weather" label="Weather" hint="Leave empty if the weather doesn’t matter.">
          <TagPicker
            value={f.climate_tags}
            onChange={(climate_tags) => set({ climate_tags })}
            options={data.lookups.climate ?? []}
          />
        </FieldRow>
        <FieldRow icon="run" label="Activities" hint="Leave empty if it always comes along.">
          <TagPicker
            value={f.activity_tags}
            onChange={(activity_tags) => set({ activity_tags })}
            options={data.lookups.activity ?? []}
          />
        </FieldRow>
        <FieldRow
          icon="bag"
          label="Auto pack"
          hint={packHint(packChoice(f), data.settings.autopack_fallback)}
        >
          <PackPicker
            value={packChoice(f)}
            onChange={(c) => set(packFields(c ?? 'main'))}
            types={data.lookups.suitcaseType ?? []}
          />
        </FieldRow>
        <FieldRow
          icon="scale"
          label="Size in inches"
          hint="Optional. Used to estimate how full bags get."
        >
          <div className="grid grid-cols-3 gap-3">
            <NumberInput
              value={f.length_in}
              placeholder="L"
              onChange={(length_in) => set({ length_in })}
            />
            <NumberInput
              value={f.width_in}
              placeholder="W"
              onChange={(width_in) => set({ width_in })}
            />
            <NumberInput
              value={f.height_in}
              placeholder="H"
              onChange={(height_in) => set({ height_in })}
            />
          </div>
          <TextInput
            aria-label="Where the size came from"
            value={f.dimensions_source ?? ''}
            placeholder="Link to where the size came from"
            onChange={(e) => set({ dimensions_source: e.target.value || null })}
          />
        </FieldRow>
        <FieldRow icon="note" label="Notes" htmlFor="i-notes">
          <TextInput
            id="i-notes"
            value={f.notes ?? ''}
            onChange={(e) => set({ notes: e.target.value || null })}
          />
        </FieldRow>
        {id !== 'new' && (
          <FieldRow icon="archive" hint="Archived items stay on old trips but aren’t suggested.">
            <div className="flex items-center justify-between">
              <span className="text-base">Archived</span>
              <Switch label="Archived" on={f.archived} onChange={(archived) => set({ archived })} />
            </div>
          </FieldRow>
        )}
        <div className="flex flex-col gap-3 pt-5">
          <ErrorText>{error}</ErrorText>
          <PrimaryButton onClick={submit} disabled={busy}>
            {id === 'new' ? 'Add to catalog' : 'Save'}
          </PrimaryButton>
          {id !== 'new' && (
            <DangerButton
              className="self-start"
              onClick={async () => {
                if (await run(() => api.del(`/items/${id}`))) nav('/catalog');
              }}
            >
              Delete from catalog
            </DangerButton>
          )}
        </div>
      </div>
    </div>
  );
}
