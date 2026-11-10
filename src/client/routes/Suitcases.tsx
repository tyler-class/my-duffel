import { useState } from 'react';
import type { Suitcase } from '@shared/types';
import { api } from '../lib/api';
import { useAppState } from '../lib/queries';
import { useSave } from '../lib/useSave';
import { Icon } from '../components/Icon';
import { NumberInput, OnePicker, PeoplePicker } from '../components/fields';
import { CatalogHeader } from '../components/CatalogNav';
import { SwipeRow } from '../components/SwipeRow';
import {
  DangerButton,
  Empty,
  ErrorText,
  FieldRow,
  GhostButton,
  PrimaryButton,
  Sheet,
  Switch,
  TextInput,
} from '../components/ui';

type Draft = Omit<Suitcase, 'id' | 'max_weight_lb'>;
const blank: Draft = {
  name: '',
  type: null,
  length_in: null,
  width_in: null,
  height_in: null,
  capacity_l: null,
  notes: null,
  carry_on: false,
  people: [],
};

export function Suitcases() {
  const { data } = useAppState();
  const { run, busy, error } = useSave();
  const [editing, setEditing] = useState<Suitcase | 'new' | null>(null);
  const [d, setD] = useState<Draft>(blank);
  if (!data) return null;
  const open = (s: Suitcase | 'new') => {
    setEditing(s);
    setD(
      s === 'new'
        ? blank
        : {
            name: s.name,
            type: s.type,
            length_in: s.length_in,
            width_in: s.width_in,
            height_in: s.height_in,
            capacity_l: s.capacity_l,
            notes: s.notes,
            carry_on: s.carry_on,
            people: s.people,
          },
    );
  };
  const save = async () => {
    const ok = await run(() =>
      editing === 'new'
        ? api.post('/suitcases', d)
        : api.patch(`/suitcases/${(editing as Suitcase).id}`, d),
    );
    if (ok) setEditing(null);
  };
  return (
    <div className="pb-10">
      <CatalogHeader addLabel="Bag" onAdd={() => open('new')} />
      {!data.suitcases.length && (
        <Empty title="No suitcases yet">
          Add the bags you own. Give them a capacity in liters to see how full they get on a trip.
        </Empty>
      )}
      {data.suitcases.map((s) => (
        <SwipeRow
          key={s.id}
          id={s.id}
          onDelete={() => run(() => api.del(`/suitcases/${s.id}`))}
          className="mx-6 border-b border-line"
        >
          <button
            onClick={() => open(s)}
            className="flex w-full items-center gap-3 py-3.5 text-left"
          >
            <Icon name={s.carry_on ? 'backpack' : 'bag'} className="text-soft" />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-base">{s.name}</span>
              {(s.type || s.carry_on) && (
                <span className="text-[13px] text-soft">
                  {[s.type, s.carry_on && 'Carry-on'].filter(Boolean).join(' · ')}
                </span>
              )}
            </span>
            {s.capacity_l !== null && (
              <span className="font-mono text-[13px] text-soft tnum">{s.capacity_l} L</span>
            )}
          </button>
        </SwipeRow>
      ))}
      <Sheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Add bag' : 'Edit bag'}
        footer={
          <>
            {editing && editing !== 'new' ? (
              <DangerButton
                onClick={async () => {
                  if (await run(() => api.del(`/suitcases/${editing.id}`))) setEditing(null);
                }}
              >
                Remove
              </DangerButton>
            ) : (
              <span />
            )}
            <div className="flex">
              <GhostButton onClick={() => setEditing(null)}>Cancel</GhostButton>
              <PrimaryButton disabled={!d.name.trim() || busy} onClick={save}>
                Save
              </PrimaryButton>
            </div>
          </>
        }
      >
        <FieldRow icon="tag" label="Name" htmlFor="s-name">
          <TextInput
            id="s-name"
            autoFocus={editing === 'new'}
            value={d.name}
            placeholder="e.g. Big blue spinner"
            onChange={(e) => setD({ ...d, name: e.target.value })}
          />
        </FieldRow>
        <FieldRow
          icon="user"
          label="Whose bag"
          hint={
            d.people.length
              ? 'Their items go in it when a trip is built.'
              : 'Nobody picked: a shared bag.'
          }
        >
          <PeoplePicker
            people={data.people}
            value={d.people}
            onChange={(people) => setD({ ...d, people })}
          />
        </FieldRow>
        <FieldRow
          icon="layers"
          label="Type"
          hint={
            d.type
              ? `Items set to auto pack into a ${d.type.toLowerCase()} go in this bag.`
              : 'Items can auto pack into a type of bag, so give each bag one.'
          }
        >
          <OnePicker
            value={d.type}
            onChange={(type) => setD({ ...d, type })}
            options={data.lookups.suitcaseType ?? []}
          />
        </FieldRow>
        <FieldRow
          icon="backpack"
          hint="Its items count as carry-on, and carry-on items go in it when a trip is built."
        >
          <div className="flex items-center justify-between">
            <span className="text-base">Carry-on</span>
            <Switch
              label="Carry-on"
              on={d.carry_on}
              onChange={(carry_on) => setD({ ...d, carry_on })}
            />
          </div>
        </FieldRow>
        <FieldRow
          icon="scale"
          label="Capacity (liters)"
          htmlFor="s-cap"
          hint="Usually on the tag or the maker’s site."
        >
          <NumberInput
            id="s-cap"
            value={d.capacity_l}
            onChange={(capacity_l) => setD({ ...d, capacity_l })}
          />
        </FieldRow>
        <FieldRow icon="hash" label="Outside size in inches">
          <div className="grid grid-cols-3 gap-3">
            <NumberInput
              value={d.length_in}
              placeholder="L"
              onChange={(length_in) => setD({ ...d, length_in })}
            />
            <NumberInput
              value={d.width_in}
              placeholder="W"
              onChange={(width_in) => setD({ ...d, width_in })}
            />
            <NumberInput
              value={d.height_in}
              placeholder="H"
              onChange={(height_in) => setD({ ...d, height_in })}
            />
          </div>
        </FieldRow>
        <FieldRow icon="note" label="Notes" htmlFor="s-notes">
          <TextInput
            id="s-notes"
            value={d.notes ?? ''}
            onChange={(e) => setD({ ...d, notes: e.target.value || null })}
          />
        </FieldRow>
        <div className="pt-3">
          <ErrorText>{error}</ErrorText>
        </div>
      </Sheet>
    </div>
  );
}
