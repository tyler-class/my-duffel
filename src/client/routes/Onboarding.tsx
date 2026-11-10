import { useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../lib/api';
import { useSave } from '../lib/useSave';
import { useAppState } from '../lib/queries';
import { Icon } from '../components/Icon';
import { ErrorText, GhostButton, PersonDot, PrimaryButton } from '../components/ui';

/** First run: add the people you pack for, or load a sample household. */
export function Onboarding() {
  const nav = useNavigate();
  const state = useAppState();
  const { run, busy, error } = useSave();
  const [name, setName] = useState('');
  const people = state.data?.people ?? [];

  async function add() {
    const n = name.trim();
    if (!n) return;
    await run(() => api.post('/people', { name: n }));
    setName('');
  }

  return (
    <div className="flex flex-col gap-8 px-5 pt-10 pb-10">
      <div className="flex flex-col gap-3">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-accent-tint text-accent">
          <Icon name="bag" size={24} />
        </span>
        <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.025em]">
          Welcome to Duffel
        </h1>
        <p className="max-w-[40ch] text-[15px] text-soft">
          Start by adding the people you pack for. You can add your catalog, bags and trips after.
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs tracking-[0.08em] text-soft uppercase">Who’s traveling</h2>
        {people.map((p) => (
          <div
            key={p.id}
            className="flex items-center gap-2.5 border-b border-line py-2.5 text-base"
          >
            <PersonDot person={p} />
            {p.name}
          </div>
        ))}
        <form
          className="flex items-center gap-2 border-b border-line py-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <input
            aria-label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Add a name"
            className="flex-1 bg-transparent py-1.5 text-base focus:outline-none"
          />
          <GhostButton type="submit" icon="plus" disabled={!name.trim() || busy}>
            Add
          </GhostButton>
        </form>
        <ErrorText>{error}</ErrorText>
      </section>

      <div className="flex flex-col gap-3">
        {people.length > 0 && (
          <PrimaryButton icon="plus" onClick={() => nav('/trips/new')}>
            Plan your first trip
          </PrimaryButton>
        )}
        <div className="flex flex-col gap-1 rounded-xl bg-chip p-4">
          <p className="text-sm font-medium">Just looking around?</p>
          <p className="text-sm text-soft">
            Load a sample family with a catalog, two templates and one trip. You can delete it
            later.
          </p>
          <GhostButton
            className="-ml-3 self-start text-accent"
            disabled={busy || people.length > 0}
            onClick={() => run(() => api.post('/sample-data'))}
          >
            Load sample data
          </GhostButton>
        </div>
      </div>
    </div>
  );
}
