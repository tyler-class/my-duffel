import { describe, expect, it } from 'vitest';
import {
  describeRelative,
  mergeWhen,
  NO_DATE,
  normalizeWhen,
  planTemplateTodos,
  planTodosClone,
  planTodosFromTemplate,
  sortTemplateTodos,
  sortTripTodos,
  todoDueDate,
  tripStage,
} from '../../src/shared/logic/todos';
import type { TemplateTodo, TodoWhen, TripTodo } from '../../src/shared/types';

const trip = { start_date: '2026-12-17', end_date: '2026-12-21' };
const none = { start_date: null, end_date: null };
const rel = (
  rel_days: number,
  rel_dir: 'before' | 'on' | 'after',
  rel_anchor: 'start' | 'middle' | 'end',
): TodoWhen => ({ ...NO_DATE, date_mode: 'relative', rel_days, rel_dir, rel_anchor });
const fixed = (due_date: string): TodoWhen => ({ ...NO_DATE, date_mode: 'fixed', due_date });

const tt = (p: Partial<TemplateTodo>): TemplateTodo => ({
  id: 'x',
  template_id: 't',
  title: 'Do it',
  phase: 'pre',
  ...NO_DATE,
  notes: null,
  sort_order: 0,
  ...p,
});
const td = (p: Partial<TripTodo>): TripTodo => ({
  id: 'x',
  trip_id: 'trip',
  title: 'Do it',
  phase: 'pre',
  ...NO_DATE,
  notes: null,
  done: false,
  done_at: null,
  sort_order: 0,
  ...p,
});

describe('todoDueDate', () => {
  it('counts days before, on or after the start, middle or end', () => {
    expect(todoDueDate(rel(3, 'before', 'start'), trip)).toBe('2026-12-14');
    expect(todoDueDate(rel(0, 'on', 'start'), trip)).toBe('2026-12-17');
    expect(todoDueDate(rel(0, 'on', 'middle'), trip)).toBe('2026-12-19');
    expect(todoDueDate(rel(1, 'after', 'middle'), trip)).toBe('2026-12-20');
    expect(todoDueDate(rel(2, 'after', 'end'), trip)).toBe('2026-12-23');
    expect(todoDueDate(rel(30, 'after', 'end'), trip)).toBe('2027-01-20');
  });
  it('rounds the middle of an even-length trip down', () => {
    expect(
      todoDueDate(rel(0, 'on', 'middle'), { start_date: '2026-12-17', end_date: '2026-12-20' }),
    ).toBe('2026-12-18');
  });
  it('uses fixed dates as they are, and needs trip dates for relative ones', () => {
    expect(todoDueDate(fixed('2026-05-01'), none)).toBe('2026-05-01');
    expect(todoDueDate(rel(3, 'before', 'start'), none)).toBeNull();
    expect(todoDueDate(NO_DATE, trip)).toBeNull();
    // A trip with only a start ends on its start day.
    expect(todoDueDate(rel(1, 'after', 'end'), { start_date: '2026-12-17', end_date: null })).toBe(
      '2026-12-18',
    );
  });
});

describe('normalizeWhen / mergeWhen / describeRelative', () => {
  it('keeps only the fields the mode uses', () => {
    expect(normalizeWhen({ date_mode: 'none', due_date: '2026-01-01', rel_days: 3 })).toEqual(
      NO_DATE,
    );
    expect(normalizeWhen({ due_date: '2026-01-01' })).toEqual(fixed('2026-01-01'));
    expect(normalizeWhen({ date_mode: 'fixed' })).toEqual(NO_DATE);
    expect(normalizeWhen({ rel_days: 2 })).toEqual(rel(2, 'before', 'start'));
    expect(normalizeWhen({ date_mode: 'relative', rel_dir: 'on', rel_days: 9 })).toEqual(
      rel(0, 'on', 'start'),
    );
  });
  it('applies a change to a stored date', () => {
    expect(mergeWhen(rel(3, 'before', 'start'), { rel_anchor: 'end', rel_dir: 'after' })).toEqual(
      rel(3, 'after', 'end'),
    );
    expect(mergeWhen(rel(3, 'before', 'start'), { due_date: '2026-02-02' })).toEqual(
      fixed('2026-02-02'),
    );
    expect(mergeWhen(fixed('2026-02-02'), { date_mode: 'none' })).toEqual(NO_DATE);
  });
  it('says relative dates in words', () => {
    expect(describeRelative(rel(3, 'before', 'start'))).toBe('3 days before the trip starts');
    expect(describeRelative(rel(1, 'after', 'end'))).toBe('1 day after the trip ends');
    expect(describeRelative(rel(0, 'on', 'middle'))).toBe('The middle of the trip');
    expect(describeRelative(rel(2, 'before', 'middle'))).toBe(
      '2 days before the middle of the trip',
    );
    expect(describeRelative(fixed('2026-01-01'))).toBe('');
  });
});

describe('moving to-dos between templates and trips', () => {
  it('keeps template dates as they are; relative ones follow the trip', () => {
    const d = planTodosFromTemplate([
      tt({ title: 'Kennel', ...rel(7, 'before', 'start') }),
      tt({ title: 'Renew', ...fixed('2026-06-01') }),
    ]);
    expect(d.map((x) => [x.title, x.date_mode, x.rel_days, x.due_date])).toEqual([
      ['Kennel', 'relative', 7, null],
      ['Renew', 'fixed', null, '2026-06-01'],
    ]);
  });
  it('copies to a new trip: fixed dates move with the start, relative stay, never done', () => {
    const next = { start_date: '2027-03-01', end_date: '2027-03-03' };
    const d = planTodosClone(
      [
        td({ title: 'Kennel', ...fixed('2026-12-10'), done: true }),
        td({ title: 'Hike', phase: 'during', ...rel(1, 'after', 'start') }),
        td({ title: 'Undated' }),
      ],
      trip,
      next,
    );
    expect(d.map((x) => [x.title, x.due_date, x.rel_days])).toEqual([
      ['Kennel', '2027-02-22', null],
      ['Hike', null, 1],
      ['Undated', null, null],
    ]);
    expect(d.every((x) => !('done' in x))).toBe(true);
    // Without start dates a fixed date stays put.
    expect(planTodosClone([td(fixed('2026-05-01'))], none, next)[0]!.due_date).toBe('2026-05-01');
  });
  it('turns fixed dates relative for a template', () => {
    const t = planTemplateTodos(
      [
        td(fixed('2026-12-03')),
        td(fixed('2026-12-17')),
        td(fixed('2026-12-19')),
        td(fixed('2026-12-23')),
        td(rel(2, 'before', 'end')),
      ],
      trip,
    );
    expect(t.map((x) => describeRelative(x))).toEqual([
      '14 days before the trip starts',
      'The day the trip starts',
      '2 days after the trip starts',
      '2 days after the trip ends',
      '2 days before the trip ends',
    ]);
    expect(planTemplateTodos([td(fixed('2026-12-03'))], none)[0]!.date_mode).toBe('fixed');
  });
});

describe('sorting', () => {
  it('sorts trip to-dos by phase, then date, undated last', () => {
    const s = sortTripTodos(
      [
        td({ title: 'c', phase: 'after', ...rel(1, 'after', 'end') }),
        td({ title: 'b' }),
        td({ title: 'a', ...rel(7, 'before', 'start') }),
        td({ title: 'a0', ...fixed('2026-12-01') }),
      ],
      trip,
    );
    expect(s.map((x) => x.title)).toEqual(['a0', 'a', 'b', 'c']);
  });
  it('sorts template to-dos in trip order', () => {
    const s = sortTemplateTodos([
      tt({ title: 'week before', ...rel(7, 'before', 'start') }),
      tt({ title: 'month before', ...rel(30, 'before', 'start') }),
      tt({ title: 'no date' }),
      tt({ title: 'fixed', ...fixed('2026-01-01') }),
      tt({ title: 'mid', phase: 'during', ...rel(0, 'on', 'middle') }),
      tt({ title: 'day 1', phase: 'during', ...rel(0, 'on', 'start') }),
    ]);
    expect(s.map((x) => x.title)).toEqual([
      'month before',
      'week before',
      'fixed',
      'no date',
      'day 1',
      'mid',
    ]);
  });
});

describe('tripStage', () => {
  it('knows before, during and after', () => {
    expect(tripStage(trip, '2026-12-16')).toBe('before');
    expect(tripStage(trip, '2026-12-17')).toBe('during');
    expect(tripStage(trip, '2026-12-21')).toBe('during');
    expect(tripStage(trip, '2026-12-22')).toBe('after');
    expect(tripStage(none, '2026-12-22')).toBe('before');
  });
});
