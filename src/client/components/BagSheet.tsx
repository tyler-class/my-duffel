import { useState } from 'react';
import { defaultBagCarryOn } from '@shared/logic';
import type { Person, Suitcase } from '@shared/types';
import { PeoplePicker } from './fields';
import {
  DangerButton,
  ErrorText,
  FieldRow,
  GhostButton,
  Pick,
  PrimaryButton,
  Sheet,
  Switch,
  TextInput,
} from './ui';

export interface BagDraft {
  label: string;
  suitcase_id: string | null;
  role: string | null;
  carry_on: boolean;
  notes: string | null;
  /** Who the bag is for. Empty = shared. */
  people: string[];
}

type BagSheetProps = {
  open: boolean;
  initial?: BagDraft;
  suitcases: Suitcase[];
  people: Person[];
  onClose: () => void;
  onSave: (b: BagDraft) => Promise<void> | void;
  onDelete?: () => void;
  error?: string;
};

export function BagSheet(props: BagSheetProps) {
  if (!props.open) return null;
  return <BagSheetBody {...props} />;
}

function BagSheetBody(props: BagSheetProps) {
  const [d, setD] = useState<BagDraft>(
    () =>
      props.initial ?? {
        label: '',
        suitcase_id: null,
        role: null,
        carry_on: false,
        notes: null,
        people: [],
      },
  );
  const [carryTouched, setCarryTouched] = useState(!!props.initial);
  const [err, setErr] = useState('');

  // Carry-on starts from the catalog bag until it's switched by hand.
  const set = (patch: Partial<BagDraft>) =>
    setD((cur) => {
      const next = { ...cur, ...patch };
      if (!carryTouched && 'suitcase_id' in patch) {
        next.carry_on = defaultBagCarryOn(
          props.suitcases.find((s) => s.id === next.suitcase_id)?.carry_on,
          null,
        );
      }
      return next;
    });

  async function save() {
    if (!d.label.trim()) return setErr('Give the bag a name.');
    await props.onSave({ ...d, label: d.label.trim() });
  }

  return (
    <Sheet
      open={props.open}
      onClose={props.onClose}
      title={props.initial ? 'Edit bag' : 'Add bag'}
      footer={
        <>
          {props.onDelete ? <DangerButton onClick={props.onDelete}>Remove</DangerButton> : <span />}
          <div className="flex">
            <GhostButton onClick={props.onClose}>Cancel</GhostButton>
            <PrimaryButton onClick={save}>{props.initial ? 'Save' : 'Add'}</PrimaryButton>
          </div>
        </>
      }
    >
      <FieldRow icon="bag" label="Which suitcase">
        <div className="flex flex-wrap gap-1.5">
          {props.suitcases.map((s) => (
            <Pick
              key={s.id}
              on={d.suitcase_id === s.id}
              onClick={() =>
                set(
                  d.suitcase_id === s.id
                    ? { suitcase_id: null }
                    : { suitcase_id: s.id, label: d.label || s.name, people: s.people },
                )
              }
            >
              {s.name}
            </Pick>
          ))}
          {!props.suitcases.length && (
            <span className="text-sm text-faint">
              Add your bags under Catalog → Bags to reuse them and track how full they get.
            </span>
          )}
        </div>
      </FieldRow>
      <FieldRow icon="tag" label="Name" htmlFor="bag-label">
        <TextInput
          id="bag-label"
          value={d.label}
          placeholder="e.g. Kids’ suitcase"
          onChange={(e) => set({ label: e.target.value })}
        />
      </FieldRow>
      <FieldRow
        icon="user"
        label="Whose bag"
        hint={d.people.length ? 'Their items go in it.' : 'Nobody picked: a shared bag.'}
      >
        <PeoplePicker
          people={props.people}
          value={d.people}
          onChange={(people) => set({ people })}
        />
      </FieldRow>
      <FieldRow
        icon="backpack"
        hint={
          d.suitcase_id
            ? 'From the catalog bag. Changing it here doesn’t change the catalog.'
            : 'Its items count as carry-on.'
        }
      >
        <div className="flex items-center justify-between gap-3">
          <span className="text-base">Carry-on</span>
          <Switch
            label="Carry-on"
            on={d.carry_on}
            onChange={(v) => {
              setCarryTouched(true);
              setD((cur) => ({ ...cur, carry_on: v }));
            }}
          />
        </div>
      </FieldRow>
      <div className="pt-3">
        <ErrorText>{err || props.error}</ErrorText>
      </div>
    </Sheet>
  );
}
