import { describe, expect, it } from 'vitest';
import { describeRelative, todoDueDate } from '../../src/shared/logic';
import type { Template, TripDetail } from '../../src/shared/types';
import { session } from './helpers';

describe('to-dos', () => {
  it('move from templates to trips, between trips and back to templates', async () => {
    const api = await session();
    let tpl = (await api.post<Template>('/templates', { name: 'Ski' })).data;
    const add = async (body: object) =>
      (tpl = (await api.post<Template>(`/templates/${tpl.id}/todos`, body)).data);
    await add({
      title: 'Book the kennel',
      date_mode: 'relative',
      rel_days: 14,
      rel_dir: 'before',
      rel_anchor: 'start',
      notes: 'Ask about the dog’s pills',
    });
    await add({ title: 'Rent skis', phase: 'during', date_mode: 'relative', rel_dir: 'on' });
    await add({ title: 'Return skis', phase: 'after' });
    await add({ title: 'Renew passes', due_date: '2027-01-15' });
    expect(tpl.todos.map((t) => t.date_mode)).toEqual(['relative', 'relative', 'none', 'fixed']);
    expect(tpl.todos[1]).toMatchObject({ rel_dir: 'on', rel_days: 0, rel_anchor: 'start' });

    const kennel = tpl.todos[0]!;
    tpl = (await api.patch<Template>(`/template-todos/${kennel.id}`, { rel_days: 10 })).data;
    expect(describeRelative(tpl.todos.find((t) => t.id === kennel.id)!)).toBe(
      '10 days before the trip starts',
    );
    const bad = await api.post(`/templates/${tpl.id}/todos`, { title: 'x', rel_anchor: 'later' });
    expect(bad.status).toBe(400);

    const created = (
      await api.post<TripDetail>('/trips', {
        name: 'Ski week',
        start_date: '2027-02-10',
        end_date: '2027-02-14',
        source: { kind: 'template', template_id: tpl.id },
      })
    ).data;
    const dates = (d: TripDetail) => d.todos.map((t) => [t.title, todoDueDate(t, d.trip)]);
    expect(dates(created)).toEqual([
      ['Book the kennel', '2027-01-31'],
      ['Rent skis', '2027-02-10'],
      ['Return skis', null],
      ['Renew passes', '2027-01-15'],
    ]);

    // Relative dates follow the trip when its dates change.
    const moved = (
      await api.patch<TripDetail>(`/trips/${created.trip.id}`, {
        start_date: '2027-02-20',
        end_date: '2027-02-24',
      })
    ).data;
    expect(dates(moved).slice(0, 2)).toEqual([
      ['Book the kennel', '2027-02-10'],
      ['Rent skis', '2027-02-20'],
    ]);

    const t0 = moved.todos[0]!;
    let d = (await api.patch<TripDetail>(`/trip-todos/${t0.id}`, { done: true })).data;
    expect(d.todos[0]!.done).toBe(true);
    // Switching a to-do to a fixed date drops its relative fields.
    d = (await api.patch<TripDetail>(`/trip-todos/${t0.id}`, { due_date: '2027-02-01' })).data;
    expect(d.todos[0]).toMatchObject({ date_mode: 'fixed', rel_days: null, rel_anchor: null });

    const copy = (
      await api.post<TripDetail>('/trips', {
        name: 'Ski again',
        start_date: '2028-02-20',
        end_date: '2028-02-24',
        source: { kind: 'clone', trip_id: created.trip.id },
      })
    ).data;
    expect(dates(copy)).toEqual([
      ['Book the kennel', '2028-02-01'],
      ['Rent skis', '2028-02-20'],
      ['Return skis', null],
      ['Renew passes', '2028-01-15'],
    ]);
    expect(copy.todos.every((t) => !t.done)).toBe(true);

    const saved = (
      await api.post<Template>(`/trips/${created.trip.id}/save-as-template`, { name: 'Saved' })
    ).data;
    expect(saved.todos.map((t) => describeRelative(t) || t.date_mode)).toEqual([
      '19 days before the trip starts',
      'The day the trip starts',
      'none',
      '36 days before the trip starts',
    ]);

    await api.del(`/trip-todos/${t0.id}`);
    expect((await api.get<TripDetail>(`/trips/${created.trip.id}`)).data.todos).toHaveLength(3);
    await api.del(`/template-todos/${kennel.id}`);
    expect(
      (await api.get<{ templates: Template[] }>('/state')).data.templates.find(
        (t) => t.id === tpl.id,
      )?.todos,
    ).toHaveLength(3);
  });
});
