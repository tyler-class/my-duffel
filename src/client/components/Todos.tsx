import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { TODO_PHASE_LABELS, TODO_PHASES, type TodoPhase } from '@shared/lookups';
import {
  describeRelative,
  localToday,
  sortTemplateTodos,
  sortTripTodos,
  todoDueDate,
  whenCols,
  type tripStage,
} from '@shared/logic';
import type { AppState, Template, TemplateTodo, TripDetail, TripTodo } from '@shared/types';
import { api, errorMessage } from '../lib/api';
import { formatDay } from '../lib/format';
import { keys } from '../lib/queries';
import { Icon } from './Icon';
import { SwipeRow } from './SwipeRow';
import { TodoSheet, type TodoDraft } from './TodoSheet';
import { useToast } from './Toast';
import { cx, ErrorText, IconButton } from './ui';

type Stage = ReturnType<typeof tripStage>;

/** The phase that's happening now comes first. */
export function phaseOrder(stage: Stage): TodoPhase[] {
  if (stage === 'during') return ['during', 'after', 'pre'];
  if (stage === 'after') return ['after', 'during', 'pre'];
  return [...TODO_PHASES];
}

const NOW: Record<Stage, TodoPhase> = { before: 'pre', during: 'during', after: 'after' };

function PhaseHeader({
  phase,
  now,
  done,
  total,
  onAdd,
}: {
  phase: TodoPhase;
  now: boolean;
  done?: number;
  total: number;
  onAdd: () => void;
}) {
  const label = TODO_PHASE_LABELS[phase];
  return (
    <div className="flex items-center gap-2 rounded-2xl bg-chip py-1.5 pr-1.5 pl-3.5">
      <span className="text-base font-semibold">{label}</span>
      {now && (
        <span className="rounded bg-todo-tint px-1.5 py-px text-[11px] font-medium text-todo">
          Now
        </span>
      )}
      <span className="ml-auto font-mono text-xs text-faint tnum">
        {total > 0 && (done !== undefined ? `${done}/${total}` : total)}
      </span>
      <IconButton
        icon="plus"
        label={`Add a ${label.toLowerCase()} to-do`}
        className="h-7 w-7"
        onClick={onAdd}
      />
    </div>
  );
}

/** A trip's to-dos, before, during and after, with what's happening now first. */
export function TripTodos({ detail, stage }: { detail: TripDetail; stage: Stage }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [sheet, setSheet] = useState<{ todo?: TripTodo; phase: TodoPhase } | null>(null);
  const [error, setError] = useState('');
  const tripId = detail.trip.id;
  const key = keys.trip(tripId);
  const today = localToday();
  const sorted = sortTripTodos(detail.todos, detail.trip);

  function local(change: (todos: TripTodo[]) => TripTodo[]) {
    const prev = qc.getQueryData<TripDetail>(key);
    if (prev) qc.setQueryData<TripDetail>(key, { ...prev, todos: change(prev.todos) });
  }
  async function send(fn: () => Promise<TripDetail | unknown>) {
    setError('');
    try {
      const res = await fn();
      if (res && typeof res === 'object' && 'todos' in res) qc.setQueryData(key, res);
    } catch (e) {
      setError(errorMessage(e));
      qc.invalidateQueries({ queryKey: key });
    }
  }

  const toggle = (t: TripTodo) => {
    local((ts) => ts.map((x) => (x.id === t.id ? { ...x, done: !t.done } : x)));
    return send(() => api.patch<TripDetail>(`/trip-todos/${t.id}`, { done: !t.done }));
  };

  const body = (d: TodoDraft) => ({
    title: d.title,
    phase: d.phase,
    ...whenCols(d),
    notes: d.notes.trim() || null,
  });

  async function remove(t: TripTodo) {
    setSheet(null);
    local((ts) => ts.filter((x) => x.id !== t.id));
    await send(() => api.del(`/trip-todos/${t.id}`));
    toast({
      text: `Deleted ${t.title}`,
      action: {
        label: 'Undo',
        run: () =>
          void send(() =>
            api.post<TripDetail>(`/trips/${tripId}/todos`, {
              title: t.title,
              phase: t.phase,
              ...whenCols(t),
              notes: t.notes,
              done: t.done,
              sort_order: t.sort_order,
            }),
          ),
      },
    });
  }

  return (
    <div>
      <div className="px-5">
        <ErrorText>{error}</ErrorText>
      </div>
      {phaseOrder(stage).map((phase) => {
        const rows = sorted.filter((t) => t.phase === phase);
        return (
          <section key={phase} className="mt-5 px-5">
            <PhaseHeader
              phase={phase}
              now={stage !== 'before' && NOW[stage] === phase}
              done={rows.filter((t) => t.done).length}
              total={rows.length}
              onAdd={() => setSheet({ phase })}
            />
            {!rows.length && <p className="px-3 py-3 text-sm text-faint">Nothing yet.</p>}
            {rows.map((t) => {
              const due = todoDueDate(t, detail.trip);
              // A relative date the trip can't place yet (no dates) shows in words.
              const dateText = due ? formatDay(due) : describeRelative(t);
              const late = !t.done && !!due && due < today;
              return (
                <SwipeRow
                  key={t.id}
                  id={t.id}
                  onDelete={() => remove(t)}
                  className="border-b border-line"
                >
                  <div className="flex items-center px-3">
                    <button
                      className="flex h-full items-center py-3 pr-3.5"
                      aria-label={t.done ? `Mark ${t.title} not done` : `Mark ${t.title} done`}
                      aria-pressed={t.done}
                      onClick={() => toggle(t)}
                    >
                      <span
                        className={cx(
                          'grid h-5 w-5 place-items-center rounded-md border-[1.5px] transition-colors',
                          t.done ? 'border-accent bg-accent text-accent-ink' : 'border-faint',
                        )}
                      >
                        {t.done && <Icon name="check" size={14} strokeWidth={2.4} />}
                      </span>
                    </button>
                    <button
                      className="flex min-w-0 flex-1 flex-col gap-0.5 py-3 text-left"
                      onClick={() => setSheet({ todo: t, phase: t.phase })}
                    >
                      <span
                        className={cx(
                          'text-base leading-tight',
                          t.done && 'text-faint line-through decoration-1',
                        )}
                      >
                        {t.title}
                      </span>
                      {(dateText || t.notes) && (
                        <span className="flex min-w-0 items-center gap-2.5 overflow-hidden text-[13px] whitespace-nowrap text-soft">
                          {dateText && (
                            <span
                              className={cx(
                                'inline-flex flex-none items-center gap-1',
                                late && 'text-danger',
                              )}
                            >
                              <Icon name="cal" size={13} />
                              {dateText}
                            </span>
                          )}
                          {t.notes && <span className="truncate">{t.notes}</span>}
                        </span>
                      )}
                    </button>
                  </div>
                </SwipeRow>
              );
            })}
          </section>
        );
      })}
      <div className="h-8" />
      <TodoSheet
        open={!!sheet}
        editing={!!sheet?.todo}
        trip={detail.trip}
        initial={
          sheet?.todo
            ? {
                title: sheet.todo.title,
                phase: sheet.todo.phase,
                ...whenCols(sheet.todo),
                notes: sheet.todo.notes ?? '',
              }
            : { phase: sheet?.phase ?? 'pre' }
        }
        onClose={() => setSheet(null)}
        onDelete={sheet?.todo ? () => remove(sheet.todo!) : undefined}
        onSave={async (d) => {
          const res = sheet?.todo
            ? await api.patch<TripDetail>(`/trip-todos/${sheet.todo.id}`, body(d))
            : await api.post<TripDetail>(`/trips/${tripId}/todos`, body(d));
          qc.setQueryData(key, res);
        }}
      />
    </div>
  );
}

/** A template's to-dos, with dates relative to the trip. */
export function TemplateTodos({ tpl }: { tpl: Template }) {
  const qc = useQueryClient();
  const [sheet, setSheet] = useState<{ todo?: TemplateTodo; phase: TodoPhase } | null>(null);
  const [error, setError] = useState('');
  const sorted = sortTemplateTodos(tpl.todos);

  function put(t: Template) {
    const prev = qc.getQueryData<AppState>(keys.state);
    if (prev)
      qc.setQueryData<AppState>(keys.state, {
        ...prev,
        templates: prev.templates.map((x) => (x.id === t.id ? t : x)),
      });
  }
  async function remove(t: TemplateTodo) {
    setSheet(null);
    setError('');
    put({ ...tpl, todos: tpl.todos.filter((x) => x.id !== t.id) });
    try {
      await api.del(`/template-todos/${t.id}`);
    } catch (e) {
      setError(errorMessage(e));
    }
    qc.invalidateQueries({ queryKey: keys.state });
  }

  return (
    <div>
      <div className="px-5">
        <ErrorText>{error}</ErrorText>
      </div>
      {!tpl.todos.length && (
        <p className="px-6 pt-4 text-sm text-soft">
          Things to do before, during or after a trip. Trips made from this template get them, with
          dates worked out from the trip’s dates.
        </p>
      )}
      {TODO_PHASES.map((phase) => {
        const rows = sorted.filter((t) => t.phase === phase);
        return (
          <section key={phase} className="mt-5 px-5">
            <PhaseHeader
              phase={phase}
              now={false}
              total={rows.length}
              onAdd={() => setSheet({ phase })}
            />
            {rows.map((t) => (
              <SwipeRow
                key={t.id}
                id={t.id}
                onDelete={() => remove(t)}
                className="border-b border-line"
              >
                <button
                  className="flex w-full min-w-0 flex-col gap-0.5 px-3 py-3 text-left"
                  onClick={() => setSheet({ todo: t, phase: t.phase })}
                >
                  <span className="text-base leading-tight">{t.title}</span>
                  {(t.date_mode !== 'none' || t.notes) && (
                    <span className="flex min-w-0 items-center gap-2.5 overflow-hidden text-[13px] whitespace-nowrap text-soft">
                      {t.date_mode !== 'none' && (
                        <span className="inline-flex flex-none items-center gap-1">
                          <Icon name="cal" size={13} />
                          {t.date_mode === 'fixed' ? formatDay(t.due_date) : describeRelative(t)}
                        </span>
                      )}
                      {t.notes && <span className="truncate">{t.notes}</span>}
                    </span>
                  )}
                </button>
              </SwipeRow>
            ))}
          </section>
        );
      })}
      <div className="h-8" />
      <TodoSheet
        open={!!sheet}
        editing={!!sheet?.todo}
        initial={
          sheet?.todo
            ? {
                title: sheet.todo.title,
                phase: sheet.todo.phase,
                ...whenCols(sheet.todo),
                notes: sheet.todo.notes ?? '',
              }
            : { phase: sheet?.phase ?? 'pre' }
        }
        onClose={() => setSheet(null)}
        onDelete={sheet?.todo ? () => remove(sheet.todo!) : undefined}
        onSave={async (d) => {
          const b = {
            title: d.title,
            phase: d.phase,
            ...whenCols(d),
            notes: d.notes.trim() || null,
          };
          put(
            sheet?.todo
              ? await api.patch<Template>(`/template-todos/${sheet.todo.id}`, b)
              : await api.post<Template>(`/templates/${tpl.id}/todos`, b),
          );
        }}
      />
    </div>
  );
}
