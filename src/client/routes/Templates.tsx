import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { DEFAULT_LOOKUPS, QTY_MODE_LABELS, type QtyMode } from '@shared/lookups';
import type { AppState, Item, Template, TemplateBag, TemplateItem } from '@shared/types';
import {
  calcSummary,
  mergeCategoryOrder,
  orderCategories,
  packChoice,
  packLabel,
  planFromTemplate,
  reorderMoves,
  resolveCalc,
  typedBags,
  unplacedSummary,
  type PackChoice,
} from '@shared/logic';
import { BagSheet, type BagDraft } from '../components/BagSheet';
import { api, errorMessage } from '../lib/api';
import { keys, useAppState } from '../lib/queries';
import { useSave } from '../lib/useSave';
import { load, save } from '../lib/storage';
import { gapText, packHint, plural } from '../lib/format';
import { Icon } from '../components/Icon';
import { CatalogPicker } from '../components/CatalogPicker';
import {
  NumberInput,
  OffsetStepper,
  OnePicker,
  PackPicker,
  PeoplePicker,
  SelectSheet,
  TagPicker,
} from '../components/fields';
import { SortableGroups } from '../components/SortableGroups';
import { TemplateTodos } from '../components/Todos';
import { SearchToggle } from '../components/SearchToggle';
import { matches } from '../lib/search';
import { SwipeRow } from '../components/SwipeRow';
import {
  cx,
  DangerButton,
  Empty,
  ErrorText,
  FieldRow,
  GhostButton,
  ListRow,
  PageHeader,
  PersonDot,
  SectionLabel,
  PrimaryButton,
  Sheet,
  SlideToggle,
  TextInput,
} from '../components/ui';

export function Templates() {
  const nav = useNavigate();
  const { data } = useAppState();
  const { run, busy, error } = useSave();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [toDelete, setToDelete] = useState<Template | null>(null);
  if (!data) return null;
  return (
    <div className="pb-10">
      <PageHeader
        title="Templates"
        icon="tmpl"
        action={
          <PrimaryButton icon="plus" onClick={() => (setName(''), setCreating(true))}>
            New
          </PrimaryButton>
        }
      />
      {!data.templates.length && (
        <Empty title="No templates yet">
          A template is a reusable packing list, like “Beach week”. You can also save any trip as a
          template from its menu.
        </Empty>
      )}
      {data.templates.map((t) => (
        <ListRow
          key={t.id}
          onClick={() => nav(`/templates/${t.id}`)}
          swipeDelete={{ id: t.id, onDelete: () => setToDelete(t) }}
        >
          <span className="text-base">{t.name}</span>
          <span className="text-[13px] text-soft">
            {[plural(t.items.length, 'item'), t.trip_type, t.climate].filter(Boolean).join(' · ')}
          </span>
        </ListRow>
      ))}
      <Sheet
        open={creating}
        onClose={() => setCreating(false)}
        title="New template"
        footer={
          <>
            <ErrorText>{error}</ErrorText>
            <div className="ml-auto flex">
              <GhostButton onClick={() => setCreating(false)}>Cancel</GhostButton>
              <PrimaryButton
                disabled={!name.trim() || busy}
                onClick={async () => {
                  const t = await run(() => api.post<Template>('/templates', { name }));
                  if (t) nav(`/templates/${t.id}`);
                }}
              >
                Create
              </PrimaryButton>
            </div>
          </>
        }
      >
        <FieldRow icon="tmpl" label="Name" htmlFor="tpl-new">
          <TextInput
            id="tpl-new"
            autoFocus
            value={name}
            placeholder="e.g. Ski weekend"
            onChange={(e) => setName(e.target.value)}
          />
        </FieldRow>
      </Sheet>
      <Sheet
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        title={`Delete ${toDelete?.name ?? 'template'}?`}
        footer={
          <>
            <GhostButton onClick={() => setToDelete(null)}>Cancel</GhostButton>
            <PrimaryButton
              tone="danger"
              disabled={busy}
              onClick={async () => {
                if (toDelete && (await run(() => api.del(`/templates/${toDelete.id}`))))
                  setToDelete(null);
              }}
            >
              Delete
            </PrimaryButton>
          </>
        }
      >
        <p className="py-2 text-sm text-soft">Trips made from it keep their lists.</p>
      </Sheet>
    </div>
  );
}

function overrideSummary(ti: TemplateItem, item?: Item): string {
  return calcSummary(resolveCalc(item ?? { qty_mode: 'fixed', qty: 1, max_qty: null }, ti));
}

export function TemplateEditor() {
  const { id = '' } = useParams();
  const { data } = useAppState();
  if (!data) return null;
  const tpl = data.templates.find((t) => t.id === id);
  if (!tpl) return <Empty title="Template not found" />;
  return <TemplateBody key={tpl.id} data={data} tpl={tpl} />;
}

function TemplateBody({ data, tpl }: { data: AppState; tpl: Template }) {
  const nav = useNavigate();
  const { run, busy, error } = useSave();
  const [form, setForm] = useState({
    name: tpl.name,
    trip_type: tpl.trip_type,
    climate: tpl.climate,
    activities: tpl.activities,
    notes: tpl.notes ?? '',
  });
  const [picker, setPicker] = useState(false);
  const [editing, setEditing] = useState<TemplateItem | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [bagSheet, setBagSheet] = useState<TemplateBag | 'new' | null>(null);
  const [tab, setTab] = useState<'details' | 'items' | 'todos'>('details');
  const [moveError, setMoveError] = useState('');
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  // Folded groups, remembered per template on this device.
  const foldKey = `templateFolded:${tpl.id}`;
  const [folded, setFolded] = useState<Record<string, boolean>>(() => load(foldKey, {}));
  const toggleFolded = (c: string) =>
    setFolded((f) => {
      const n = { ...f, [c]: !f[c] };
      save(foldKey, n);
      return n;
    });
  const qc = useQueryClient();
  const sorted = useMemo(
    () => [...tpl.items].sort((a, b) => a.sort_order - b.sort_order),
    [tpl.items],
  );

  /** Writes a change into the cached template right away, then saves it. */
  async function saveOrder(change: (t: Template) => Template, send: () => Promise<unknown>) {
    const prev = qc.getQueryData<AppState>(keys.state);
    if (prev)
      qc.setQueryData<AppState>(keys.state, {
        ...prev,
        templates: prev.templates.map((t) => (t.id === tpl.id ? change(t) : t)),
      });
    setMoveError('');
    try {
      await send();
    } catch (e) {
      setMoveError(errorMessage(e));
    }
    qc.invalidateQueries({ queryKey: keys.state });
  }

  function moveRows(next: { id: string; category: string | null }[]) {
    const moves = reorderMoves(sorted, next);
    if (!moves.length) return;
    const by = new Map(moves.map((m) => [m.id, m]));
    return saveOrder(
      (t) => ({
        ...t,
        items: t.items.map((i) => {
          const m = by.get(i.id);
          if (!m) return i;
          return {
            ...i,
            sort_order: m.sort_order,
            category: m.category !== undefined ? m.category : i.category,
          };
        }),
      }),
      () => api.post(`/templates/${tpl.id}/items/reorder`, { moves }),
    );
  }

  function moveGroups(order: string[]) {
    const present = tpl.items.map((i) => i.category?.trim()).filter((c): c is string => !!c);
    const full = orderCategories(present, tpl.category_order, DEFAULT_LOOKUPS.category);
    const category_order = mergeCategoryOrder(full, order);
    return saveOrder(
      (t) => ({ ...t, category_order }),
      () => api.patch(`/templates/${tpl.id}`, { category_order }),
    );
  }
  const items = new Map(data.items.map((i) => [i.id, i]));
  // Search narrows the packing list by item name, group or notes.
  const shown = sorted.filter((ti) =>
    matches(query, items.get(ti.item_id)?.name, ti.category, ti.notes),
  );
  const people = new Map(data.people.map((p) => [p.id, p]));
  // Where this template's items would go with its bags (all people, any trip length).
  const gaps = tpl.items.length
    ? unplacedSummary(
        planFromTemplate(tpl.items, items, {
          len: null,
          travelers: [],
          bags: typedBags(tpl.bags, new Map(data.suitcases.map((s) => [s.id, s]))),
          fallback: data.settings.autopack_fallback,
        }),
      )
    : [];
  const dirty =
    form.name !== tpl.name ||
    form.trip_type !== tpl.trip_type ||
    form.climate !== tpl.climate ||
    form.notes !== (tpl.notes ?? '') ||
    form.activities.join('|') !== tpl.activities.join('|');

  return (
    <div className="pb-12">
      <PageHeader
        title={tpl.name}
        back="/templates"
        action={
          <PrimaryButton icon="plus" onClick={() => nav(`/trips/new?template=${tpl.id}`)}>
            Trip
          </PrimaryButton>
        }
      />
      <div className="px-5 pb-1">
        <SlideToggle<'details' | 'items' | 'todos'>
          label="Template sections"
          value={tab}
          onChange={setTab}
          options={[
            ['details', 'Details'],
            ['items', 'Packing'],
            ['todos', 'To-dos'],
          ]}
        />
      </div>

      {tab === 'items' && (
        <>
          <SectionLabel
            icon="bag"
            trailing={
              <button className="text-sm text-accent" onClick={() => setBagSheet('new')}>
                + Add bag
              </button>
            }
          >
            Bags
          </SectionLabel>
          {!tpl.bags.length && (
            <p className="px-6 pt-2 text-sm text-soft">
              Add the bags you usually take. Trips made from this template start with them, and each
              person’s items go straight into their bags.
            </p>
          )}
          {tpl.bags.map((bg) => (
            <SwipeRow
              key={bg.id}
              id={bg.id}
              onDelete={() => run(() => api.del(`/template-bags/${bg.id}`))}
              className="mx-6 border-b border-line"
            >
              <button
                onClick={() => setBagSheet(bg)}
                className="flex w-full items-center gap-3 py-3 text-left"
              >
                <Icon name={bg.carry_on ? 'backpack' : 'bag'} className="text-soft" />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-base">{bg.label}</span>
                  <span className="flex items-center gap-2 text-[13px] text-soft">
                    {bg.people.length ? (
                      <span className="inline-flex items-center gap-1">
                        {bg.people.map((p) => (
                          <PersonDot key={p} person={people.get(p)} />
                        ))}
                        {bg.people
                          .map((p) => people.get(p)?.name)
                          .filter(Boolean)
                          .join(', ')}
                      </span>
                    ) : (
                      <span>Shared</span>
                    )}
                    {bg.carry_on && <span>· Carry-on</span>}
                  </span>
                </span>
              </button>
            </SwipeRow>
          ))}
          {gaps.length > 0 && (
            <div className="mx-6 mt-3 flex flex-col gap-1 rounded-2xl bg-chip px-4 py-3 text-sm text-soft">
              <span className="font-medium text-ink">Some items won’t have a bag</span>
              {gaps.map((g) => (
                <span key={`${g.person_id}|${g.carry}|${g.pack_type}`}>
                  {g.person_id ? (people.get(g.person_id)?.name ?? 'Someone') : 'Shared'}:{' '}
                  {gapText(g)}
                </span>
              ))}
              <span className="text-xs text-faint">They’ll start in No bag on new trips.</span>
            </div>
          )}

          <div className="flex items-center gap-2 px-5 pt-5 pb-2">
            {!searchOpen && !query && (
              <span className="text-xs tracking-[0.08em] whitespace-nowrap text-soft uppercase">
                {plural(tpl.items.length, 'item')}
              </span>
            )}
            <SearchToggle
              value={query}
              onChange={setQuery}
              label="Search this template"
              onOpenChange={setSearchOpen}
            />
            <GhostButton
              icon="plus"
              className="-mr-3 py-1 whitespace-nowrap"
              onClick={() => setPicker(true)}
            >
              Add from catalog
            </GhostButton>
          </div>
          {query.trim() && !shown.length && (
            <p className="px-5 py-10 text-center text-sm text-soft">
              Nothing matches “{query.trim()}”.
            </p>
          )}
          <div className="px-5">
            <ErrorText>{moveError}</ErrorText>
            <SortableGroups
              rows={shown}
              saved={tpl.category_order}
              defaults={DEFAULT_LOOKUPS.category}
              onRowsChange={moveRows}
              onGroupsChange={moveGroups}
              isCollapsed={(c) => !query.trim() && !!folded[c]}
              onToggle={(c) => toggleFolded(c)}
              renderHeader={(c, rs, isFolded) => (
                <div className="flex items-center gap-2 px-1 pt-4 pb-1.5">
                  <span className="rounded-full bg-chip px-2.5 py-0.5 text-[13px] font-semibold text-soft">
                    {c}
                  </span>
                  <Icon
                    name="chev"
                    size={12}
                    className={cx('text-faint transition-transform', isFolded && '-rotate-90')}
                  />
                  <span className="ml-auto font-mono text-[11px] text-faint tnum">{rs.length}</span>
                </div>
              )}
              renderRow={(ti) => {
                const item = items.get(ti.item_id);
                const who = ti.assignees.length ? ti.assignees : (item?.default_people ?? []);
                return (
                  <SwipeRow
                    id={ti.id}
                    onDelete={() => run(() => api.del(`/template-items/${ti.id}`))}
                    className="border-b border-line"
                  >
                    <button
                      onClick={() => setEditing(ti)}
                      className="flex w-full items-center gap-3 px-1 py-3 text-left"
                    >
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="text-base">{item?.name ?? 'Removed item'}</span>
                        <span className="flex items-center gap-2.5 text-[13px] text-soft">
                          {who.length ? (
                            <span className="inline-flex items-center gap-1">
                              {who.map((p) => (
                                <PersonDot key={p} person={people.get(p)} />
                              ))}
                              {!ti.assignees.length && <span className="text-faint">default</span>}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1">
                              <Icon name="users" size={13} />
                              Shared
                            </span>
                          )}
                          {(ti.pack_type || ti.carry_on) && (
                            <span className="inline-flex items-center gap-1">
                              <Icon name={ti.pack_type ? 'bag' : 'backpack'} size={13} />
                              {ti.pack_type ?? 'Carry-on'}
                            </span>
                          )}
                          {ti.notes && <span className="truncate">{ti.notes}</span>}
                        </span>
                      </span>
                      <span className="font-mono text-[13px] text-soft tnum">
                        {overrideSummary(ti, item)}
                      </span>
                    </button>
                  </SwipeRow>
                );
              }}
            />
          </div>
        </>
      )}

      {tab === 'todos' && <TemplateTodos tpl={tpl} />}

      {tab === 'details' && (
        <div className="px-5 pt-3">
          <FieldRow icon="tag" label="Name" htmlFor="tpl-name">
            <TextInput
              id="tpl-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </FieldRow>
          <FieldRow icon="plane" label="Trip type">
            <OnePicker
              value={form.trip_type}
              onChange={(trip_type) => setForm({ ...form, trip_type })}
              options={data.lookups.tripType ?? []}
            />
          </FieldRow>
          <FieldRow icon="weather" label="Weather">
            <OnePicker
              value={form.climate}
              onChange={(climate) => setForm({ ...form, climate })}
              options={data.lookups.climate ?? []}
            />
          </FieldRow>
          <FieldRow icon="run" label="Activities">
            <TagPicker
              value={form.activities}
              onChange={(activities) => setForm({ ...form, activities })}
              options={data.lookups.activity ?? []}
            />
          </FieldRow>
          <FieldRow icon="note" label="Notes" htmlFor="tpl-notes">
            <TextInput
              id="tpl-notes"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </FieldRow>
          <div className="flex flex-col gap-3 pt-5">
            <ErrorText>{error}</ErrorText>
            {dirty && (
              <PrimaryButton
                disabled={busy || !form.name.trim()}
                onClick={() => run(() => api.patch(`/templates/${tpl.id}`, form))}
              >
                Save changes
              </PrimaryButton>
            )}
            <DangerButton className="self-start" onClick={() => setConfirmDelete(true)}>
              Delete template
            </DangerButton>
          </div>
        </div>
      )}

      <CatalogPicker
        open={picker}
        title={`Add to ${tpl.name}`}
        items={data.items}
        existing={tpl.items.reduce(
          (m, i) => m.set(i.item_id, (m.get(i.item_id) ?? 0) + 1),
          new Map<string, number>(),
        )}
        existingLabel="On template"
        onClose={() => setPicker(false)}
        people={data.people}
        onAdd={async (ids, people) => {
          await run(() =>
            api.post(`/templates/${tpl.id}/items`, { item_ids: ids, assignees: people }),
          );
        }}
      />
      <BagSheet
        open={bagSheet !== null}
        initial={
          bagSheet && bagSheet !== 'new'
            ? {
                label: bagSheet.label,
                suitcase_id: bagSheet.suitcase_id,
                role: bagSheet.role,
                carry_on: bagSheet.carry_on,
                notes: bagSheet.notes,
                people: bagSheet.people,
              }
            : undefined
        }
        suitcases={data.suitcases}
        people={data.people}
        error={error}
        onClose={() => setBagSheet(null)}
        onSave={async (b: BagDraft) => {
          const ok = await run(() =>
            bagSheet === 'new'
              ? api.post(`/templates/${tpl.id}/bags`, b)
              : api.patch(`/template-bags/${(bagSheet as TemplateBag).id}`, b),
          );
          if (ok) setBagSheet(null);
        }}
        onDelete={
          bagSheet && bagSheet !== 'new'
            ? async () => {
                if (await run(() => api.del(`/template-bags/${bagSheet.id}`))) setBagSheet(null);
              }
            : undefined
        }
      />
      {editing && (
        <TemplateItemSheet
          key={editing.id}
          ti={editing}
          item={items.get(editing.item_id)}
          categories={data.lookups.category ?? []}
          onClose={() => setEditing(null)}
        />
      )}
      <Sheet
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete ${tpl.name}?`}
        footer={
          <>
            <GhostButton onClick={() => setConfirmDelete(false)}>Cancel</GhostButton>
            <PrimaryButton
              tone="danger"
              onClick={async () => {
                if (await run(() => api.del(`/templates/${tpl.id}`))) nav('/templates');
              }}
            >
              Delete
            </PrimaryButton>
          </>
        }
      >
        <p className="py-2 text-sm text-soft">Trips made from it keep their lists.</p>
      </Sheet>
    </div>
  );
}

type ModeChoice = 'default' | QtyMode;

const signedText = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');

function TemplateItemSheet({
  ti,
  item,
  categories,
  onClose,
}: {
  ti: TemplateItem;
  item?: Item;
  categories: string[];
  onClose: () => void;
}) {
  const { data } = useAppState();
  const { run, busy, error } = useSave();
  const [mode, setMode] = useState<ModeChoice>(ti.qty_mode_override ?? 'default');
  const [qty, setQty] = useState<number | null>(ti.qty_override);
  const [offset, setOffset] = useState<number | null>(ti.qty_offset_override);
  const [assignees, setAssignees] = useState<string[]>(ti.assignees);
  // null = the catalog item's choice.
  const [pack, setPack] = useState<PackChoice | null>(
    ti.pack_type ? { type: ti.pack_type } : ti.carry_on ? 'carry_on' : null,
  );
  const [notes, setNotes] = useState(ti.notes ?? '');
  const [category, setCategory] = useState(ti.category);
  if (!data) return null;
  const effMode = mode === 'default' ? (item?.qty_mode ?? 'fixed') : mode;
  return (
    <Sheet
      open={!!ti}
      onClose={onClose}
      title={item?.name ?? 'Template item'}
      footer={
        <>
          <DangerButton
            onClick={async () => {
              if (await run(() => api.del(`/template-items/${ti.id}`))) onClose();
            }}
          >
            Remove
          </DangerButton>
          <div className="flex">
            <GhostButton onClick={onClose}>Cancel</GhostButton>
            <PrimaryButton
              disabled={busy}
              onClick={async () => {
                const ok = await run(() =>
                  api.patch(`/template-items/${ti.id}`, {
                    qty_mode_override: mode === 'default' ? null : mode,
                    qty_override: qty,
                    qty_offset_override: effMode === 'fixed' ? null : offset,
                    assignees,
                    carry_on: pack === 'carry_on',
                    pack_type: typeof pack === 'object' && pack ? pack.type : null,
                    category,
                    notes,
                  }),
                );
                if (ok) onClose();
              }}
            >
              Save
            </PrimaryButton>
          </div>
        </>
      }
    >
      <FieldRow icon="grid" label="Group" htmlFor="ti-group">
        <SelectSheet
          id="ti-group"
          title="Group"
          value={category}
          onChange={setCategory}
          options={categories}
          placeholder="No group"
        />
      </FieldRow>
      <FieldRow
        icon="hash"
        label="How many"
        hint={
          item
            ? `Catalog default: ${item.qty} ${QTY_MODE_LABELS[item.qty_mode].toLowerCase()}${item.qty_mode !== 'fixed' && item.qty_offset ? `, ${item.qty_offset > 0 ? 'plus' : 'minus'} ${Math.abs(item.qty_offset)}` : ''}${item.max_qty !== null ? `, at most ${item.max_qty}` : ''}.`
            : undefined
        }
      >
        <SlideToggle<ModeChoice>
          label="Quantity mode"
          value={mode}
          onChange={setMode}
          options={[
            ['default', 'Default'],
            ['fixed', 'Fixed'],
            ['per_day', 'Per day'],
            ['per_night', 'Per night'],
          ]}
        />
        <NumberInput value={qty} placeholder={`Default (${item?.qty ?? 1})`} onChange={setQty} />
        <span className="text-xs text-faint">
          {effMode === 'fixed'
            ? 'Total per person.'
            : `Per person, ${QTY_MODE_LABELS[effMode].toLowerCase()}.`}
        </span>
        {effMode !== 'fixed' && (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-soft">Plus or minus</span>
            <div className="flex items-center justify-between gap-3">
              <OffsetStepper
                value={offset}
                base={item?.qty_offset ?? 0}
                placeholder={`Default (${signedText(item?.qty_offset ?? 0)})`}
                onChange={setOffset}
              />
              {offset !== null && (
                <button
                  type="button"
                  className="text-sm text-soft underline"
                  onClick={() => setOffset(null)}
                >
                  Use default
                </button>
              )}
            </div>
          </div>
        )}
      </FieldRow>
      <FieldRow
        icon="user"
        label="Who packs this"
        hint={
          assignees.length > 1
            ? 'Each person gets their own entry on the trip, with this quantity each.'
            : assignees.length
              ? undefined
              : 'Nobody picked: uses the catalog item’s, or one shared entry.'
        }
      >
        <PeoplePicker people={data.people} value={assignees} onChange={setAssignees} />
      </FieldRow>
      <FieldRow
        icon="bag"
        label="Auto pack"
        hint={packHint(pack ?? (item ? packChoice(item) : 'main'), data.settings.autopack_fallback)}
      >
        <PackPicker
          value={pack}
          onChange={setPack}
          types={data.lookups.suitcaseType ?? []}
          inherit={`Catalog: ${item ? packLabel(packChoice(item)) : 'Luggage'}`}
          main={false}
          noBag={false}
        />
      </FieldRow>
      <FieldRow icon="note" label="Notes" htmlFor="ti-notes">
        <TextInput id="ti-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </FieldRow>
      <div className="pt-3">
        <ErrorText>{error}</ErrorText>
      </div>
    </Sheet>
  );
}
