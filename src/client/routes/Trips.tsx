import { useNavigate } from 'react-router';
import { localToday, splitTrips } from '@shared/logic';
import type { Trip } from '@shared/types';
import { useAppState } from '../lib/queries';
import { Onboarding } from './Onboarding';
import { formatRange } from '../lib/format';
import { Icon, tripIcon } from '../components/Icon';
import {
  cx,
  Empty,
  GhostButton,
  IconButton,
  PageHeader,
  PrimaryButton,
  SectionLabel,
  Sheet,
} from '../components/ui';
import { SwipeRow } from '../components/SwipeRow';
import { useSave } from '../lib/useSave';
import { api } from '../lib/api';
import { useState } from 'react';

export function Trips() {
  const nav = useNavigate();
  const { data } = useAppState();
  const { run, busy } = useSave();
  const [toDelete, setToDelete] = useState<Trip | null>(null);
  if (!data) return null;
  if (!data.trips.length && !data.people.length && !data.items.length) return <Onboarding />;
  const { active, archived } = splitTrips(data.trips, localToday());
  const row = (t: Trip, highlight: boolean) => (
    <SwipeRow
      key={t.id}
      id={t.id}
      onDelete={() => setToDelete(t)}
      className="mx-6 border-b border-line"
    >
      <div className="flex items-center">
        <button
          className="flex min-w-0 flex-1 items-center gap-3.5 py-3.5 text-left"
          onClick={() => {
            nav(`/trips/${t.id}`);
          }}
        >
          <span
            className={cx(
              'grid h-10 w-10 flex-none place-items-center rounded-[10px]',
              highlight ? 'bg-accent-tint text-accent' : 'bg-chip text-soft',
            )}
          >
            <Icon name={tripIcon(t.trip_type)} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="truncate text-base">{t.name}</span>
            <span className="flex items-center gap-2.5 text-[13px] text-soft">
              {(t.start_date || t.end_date) && (
                <span className="inline-flex items-center gap-1">
                  <Icon name="cal" size={13} />
                  {formatRange(t.start_date, t.end_date)}
                </span>
              )}
              <span className="inline-flex items-center gap-1 tnum">
                <Icon name="check" size={13} />
                {t.packed_count}/{t.item_count}
              </span>
            </span>
            <span className="h-0.5 w-full overflow-hidden rounded bg-track">
              <span
                className="block h-full bg-accent"
                style={{
                  width: `${t.item_count ? Math.round((t.packed_count / t.item_count) * 100) : 0}%`,
                }}
              />
            </span>
          </span>
        </button>
        <IconButton
          icon="settings"
          label={`${t.name} details`}
          className="-mr-2 ml-2"
          onClick={() => nav(`/trips/${t.id}/details`)}
        />
      </div>
    </SwipeRow>
  );
  return (
    <div>
      <PageHeader
        title="Trips"
        icon="map"
        action={
          <PrimaryButton icon="plus" onClick={() => nav('/trips/new')}>
            New trip
          </PrimaryButton>
        }
      />
      {!data.trips.length && (
        <Empty title="No trips yet">
          Plan one from a template, copy a past trip, or start blank.
        </Empty>
      )}
      {active.length > 0 && (
        <>
          <SectionLabel icon="clock">Upcoming</SectionLabel>
          {active.map((t, i) => row(t, i === 0))}
        </>
      )}
      {archived.length > 0 && (
        <>
          <SectionLabel icon="archive">Past</SectionLabel>
          {archived.map((t) => row(t, false))}
        </>
      )}
      <Sheet
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        title={`Delete ${toDelete?.name ?? 'trip'}?`}
        footer={
          <>
            <GhostButton onClick={() => setToDelete(null)}>Cancel</GhostButton>
            <PrimaryButton
              tone="danger"
              disabled={busy}
              onClick={async () => {
                if (toDelete && (await run(() => api.del(`/trips/${toDelete.id}`))))
                  setToDelete(null);
              }}
            >
              Delete
            </PrimaryButton>
          </>
        }
      >
        <p className="py-2 text-sm text-soft">
          The trip, its bags and its packing list are removed. Templates and the catalog stay.
        </p>
      </Sheet>
    </div>
  );
}
