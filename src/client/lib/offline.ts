// Packed check-offs made while offline wait here and replay when the connection returns.
import type { QueryClient } from '@tanstack/react-query';
import { api, ApiError } from './api';
import { load, save } from './storage';

interface Pending {
  id: string;
  tripId: string;
  packed: boolean;
}

const KEY = 'offlineQueue';

export function queuedPacks(): Pending[] {
  return load<Pending[]>(KEY, []);
}

export function enqueuePack(p: Pending) {
  // Only the latest state per row matters.
  save(KEY, [...queuedPacks().filter((q) => q.id !== p.id), p]);
}

export function isOffline(e: unknown): boolean {
  return e instanceof ApiError && e.status === 0;
}

let flushing = false;
export async function flushQueue(qc: QueryClient) {
  if (flushing) return;
  const queue = queuedPacks();
  if (!queue.length) return;
  flushing = true;
  const left: Pending[] = [];
  for (const p of queue) {
    try {
      await api.patch(`/trip-items/${p.id}`, { packed: p.packed });
    } catch (e) {
      // Still offline: keep it. Row deleted elsewhere (404) or other errors: drop it.
      if (isOffline(e)) left.push(p);
    }
  }
  save(KEY, left);
  flushing = false;
  await qc.invalidateQueries();
}

export function startOfflineSync(qc: QueryClient) {
  const flush = () => void flushQueue(qc);
  window.addEventListener('online', flush);
  document.addEventListener(
    'visibilitychange',
    () => document.visibilityState === 'visible' && flush(),
  );
  flush();
}
