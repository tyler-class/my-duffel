import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import type { AppState, TripDetail, TripItem } from '@shared/types';
import { api } from './api';
import { enqueuePack, isOffline } from './offline';

export const keys = {
  state: ['state'] as const,
  trip: (id: string) => ['trip', id] as const,
};

export function useAppState() {
  return useQuery({
    queryKey: keys.state,
    queryFn: () => api.get<AppState>('/state'),
    staleTime: 15_000,
  });
}

/** The open trip polls every 15s so two phones packing at once stay in sync. */
export function useTrip(id: string | null) {
  return useQuery({
    queryKey: keys.trip(id ?? 'none'),
    queryFn: () => api.get<TripDetail>(`/trips/${id}`),
    enabled: !!id,
    refetchInterval: 15_000,
    staleTime: 5_000,
  });
}

/** Mutation that refreshes the given queries afterwards. */
export function useApi<TVars, TResult = unknown>(
  fn: (vars: TVars) => Promise<TResult>,
  invalidate: (vars: TVars, result?: TResult) => QueryKey[],
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: (result, _err, vars) =>
      Promise.all(invalidate(vars, result).map((k) => qc.invalidateQueries({ queryKey: k }))),
  });
}

/** Optimistic edits to a trip's rows: the UI updates instantly and rolls back on error. */
export function usePatchTripItem(tripId: string) {
  const qc = useQueryClient();
  const key = keys.trip(tripId);
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<TripItem> }) =>
      api.patch<TripItem>(`/trip-items/${id}`, patch),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<TripDetail>(key);
      if (prev) {
        qc.setQueryData<TripDetail>(key, {
          ...prev,
          items: prev.items.map((r) => {
            if (r.id !== id) return r;
            const next = { ...r, ...patch };
            if (patch.no_bag) next.trip_bag_id = null;
            if (patch.trip_bag_id) next.no_bag = false;
            return next;
          }),
        });
      }
      return { prev };
    },
    onError: (e, vars, ctx) => {
      // Offline check-offs stay checked and sync later.
      const keys = Object.keys(vars.patch);
      if (isOffline(e) && keys.length === 1 && keys[0] === 'packed') {
        enqueuePack({ id: vars.id, tripId, packed: !!vars.patch.packed });
        return;
      }
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
    onSettled: (_d, e) => {
      if (isOffline(e)) return;
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: keys.state });
    },
  });
}
