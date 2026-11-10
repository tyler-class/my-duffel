import { describe, expect, it } from 'vitest';
import type { AppState } from '../../src/shared/types';
import { session } from './helpers';

describe('backup and sample data', () => {
  it('loads sample data once, exports, and restores', async () => {
    const api = await session();
    expect((await api.post('/sample-data')).status).toBe(201);
    expect((await api.post('/sample-data')).status).toBe(409);
    const state = (await api.get<AppState>('/state')).data;
    expect(state.people.map((p) => p.name)).toEqual(['Sam', 'Alex', 'Mia', 'Leo']);
    const trip = state.trips[0]!;
    expect(trip.start_date! > new Date().toISOString().slice(0, 10)).toBe(true);

    const backup = (await api.get<{ tables: Record<string, unknown[]> }>('/export')).data;
    expect(backup.tables.trip_items!.length).toBe(trip.item_count);
    expect(JSON.stringify(backup.tables.settings)).not.toMatch(/session_salt/);

    await api.del(`/trips/${trip.id}`);
    expect((await api.get<AppState>('/state')).data.trips).toHaveLength(0);
    expect((await api.post('/import', backup)).status).toBe(200);
    const restored = (await api.get<AppState>('/state')).data;
    expect(restored.trips[0]!.item_count).toBe(trip.item_count);
    // still signed in: the salt survived the restore
    expect((await api.get('/session')).status).toBe(200);

    expect((await api.post('/import', { hello: 1 })).status).toBe(400);
  });
});
