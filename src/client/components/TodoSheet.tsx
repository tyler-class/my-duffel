import { useState } from 'react';
import {
  REL_ANCHORS,
  REL_DIRS,
  TODO_PHASE_LABELS,
  TODO_PHASES,
  type RelAnchor,
  type RelDir,
  type TodoDateMode,
  type TodoPhase,
} from '@shared/lookups';
import { describeRelative, NO_DATE, normalizeWhen, todoDueDate } from '@shared/logic';
import type { TodoWhen } from '@shared/types';
import { formatDay } from '../lib/format';
import { NumberInput } from './fields';
import {
  DangerButton,
  ErrorText,
  FieldRow,
  GhostButton,
  PrimaryButton,
  Sheet,
  SlideToggle,
  TextInput,
} from './ui';

export interface TodoDraft extends TodoWhen {
  title: string;
  phase: TodoPhase;
  notes: string;
}

const MODES: [TodoDateMode, string][] = [
  ['none', 'No date'],
  ['fixed', 'Fixed date'],
  ['relative', 'Relative'],
];
const DIRS: Record<RelDir, string> = { before: 'Before', on: 'On', after: 'After' };
const ANCHORS: Record<RelAnchor, string> = {
  start: 'Start of trip',
  middle: 'Middle',
  end: 'End of trip',
};

type Props = {
  open: boolean;
  initial?: Partial<TodoDraft>;
  editing?: boolean;
  /** The trip's dates, to show when a relative date falls. */
  trip?: { start_date: string | null; end_date: string | null };
  onClose: () => void;
  onSave: (d: TodoDraft) => Promise<void>;
  onDelete?: () => void;
};

/** Add or edit a to-do on a trip or template. */
export function TodoSheet(props: Props) {
  if (!props.open) return null;
  return <TodoSheetBody {...props} />;
}

function TodoSheetBody({ initial, editing, trip, onClose, onSave, onDelete }: Props) {
  const [d, setD] = useState<TodoDraft>({
    title: '',
    phase: 'pre',
    notes: '',
    ...NO_DATE,
    ...initial,
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<TodoDraft>) => setD((x) => ({ ...x, ...p }));
  const when = normalizeWhen(d);
  const falls = d.date_mode === 'relative' && trip ? todoDueDate(when, trip) : null;

  async function save() {
    if (!d.title.trim()) return setError('Enter what needs doing.');
    if (d.date_mode === 'fixed' && !d.due_date) return setError('Pick a date, or choose No date.');
    setBusy(true);
    setError('');
    try {
      await onSave({ ...d, ...when, title: d.title.trim() });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={editing ? 'Edit to-do' : 'Add to-do'}
      footer={
        <>
          {editing && onDelete ? <DangerButton onClick={onDelete}>Delete</DangerButton> : <span />}
          <div className="flex items-center">
            <GhostButton onClick={onClose}>Cancel</GhostButton>
            <PrimaryButton onClick={save} disabled={busy}>
              {editing ? 'Save' : 'Add'}
            </PrimaryButton>
          </div>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <FieldRow icon="check" label="To-do" htmlFor="todo-title">
          <TextInput
            id="todo-title"
            autoFocus={!editing}
            value={d.title}
            placeholder="e.g. Book the kennel"
            onChange={(e) => set({ title: e.target.value })}
          />
        </FieldRow>
        <FieldRow icon="clock" label="When">
          <SlideToggle<TodoPhase>
            label="When"
            value={d.phase}
            onChange={(phase) => set({ phase })}
            options={TODO_PHASES.map((p) => [p, TODO_PHASE_LABELS[p]])}
          />
        </FieldRow>
        <FieldRow
          icon="cal"
          label="Date"
          hint={
            d.date_mode === 'relative'
              ? [describeRelative(when), falls && formatDay(falls)].filter(Boolean).join(' · ')
              : undefined
          }
        >
          <div className="flex flex-col gap-2.5">
            <SlideToggle<TodoDateMode>
              label="Date"
              value={d.date_mode}
              onChange={(m) =>
                set(
                  m === 'relative' && d.date_mode !== 'relative'
                    ? { date_mode: m, rel_days: 3, rel_dir: 'before', rel_anchor: 'start' }
                    : { date_mode: m },
                )
              }
              options={MODES}
            />
            {d.date_mode === 'fixed' && (
              <TextInput
                id="todo-date"
                type="date"
                aria-label="Date"
                value={d.due_date ?? ''}
                onChange={(e) => set({ due_date: e.target.value || null })}
              />
            )}
            {d.date_mode === 'relative' && (
              <>
                <div className="flex flex-wrap items-center gap-1.5">
                  {d.rel_dir !== 'on' && (
                    <div className="w-20">
                      <NumberInput
                        id="todo-days"
                        step="1"
                        value={d.rel_days}
                        placeholder="0"
                        onChange={(v) =>
                          set({ rel_days: v === null ? null : Math.max(0, Math.round(v)) })
                        }
                      />
                    </div>
                  )}
                  {d.rel_dir !== 'on' && <span className="pr-1 text-sm text-soft">days</span>}
                  <SlideToggle<RelDir>
                    label="Before or after"
                    value={d.rel_dir}
                    onChange={(rel_dir) => set({ rel_dir })}
                    options={REL_DIRS.map((x) => [x, DIRS[x]])}
                  />
                </div>
                <SlideToggle<RelAnchor>
                  label="Relative to"
                  value={d.rel_anchor}
                  onChange={(rel_anchor) => set({ rel_anchor })}
                  options={REL_ANCHORS.map((a) => [a, ANCHORS[a]])}
                />
              </>
            )}
          </div>
        </FieldRow>
        <FieldRow icon="note" label="Notes" htmlFor="todo-notes">
          <textarea
            id="todo-notes"
            rows={3}
            value={d.notes}
            placeholder="Details, links, confirmation numbers"
            onChange={(e) => set({ notes: e.target.value })}
            className="w-full resize-none rounded-xl border border-line bg-surface px-3 py-2 text-base text-ink transition-colors placeholder:text-faint/55 focus:border-accent focus:outline-none"
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
