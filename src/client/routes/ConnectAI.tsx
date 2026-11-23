import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { EXAMPLE_PROMPTS } from '@shared/examples';
import { ALWAYS_ON_PROMPTS } from '../alwaysOn';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';
import { load, save } from '../lib/storage';
import {
  Collapse,
  FoldChevron,
  ErrorText,
  GhostButton,
  SectionLabel,
  SlideToggle,
  SubHeading,
  cx,
} from '../components/ui';
import { assistants, ASSISTANT_INTRO, CONNECTED_TEXT, signInNote } from '../kit/assistants';

function Copy({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <GhostButton
      icon={done ? 'check' : 'copy'}
      className="py-1 text-accent"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard blocked: the text is selectable */
        }
      }}
    >
      {done ? 'Copied' : label}
    </GhostButton>
  );
}

function Code({ children }: { children: string }) {
  return (
    <code className="block overflow-x-auto rounded-lg bg-chip px-3 py-2.5 font-mono text-[13px] whitespace-nowrap text-ink select-all">
      {children}
    </code>
  );
}

/** The “Connect an AI assistant” part of Settings (Selfhost Kit layout: src/client/kit/assistants.ts). */
export function ConnectAISection() {
  const url = `${window.location.origin}/mcp`;
  const list = assistants('Duffel', 'duffel', url);
  const [open, setOpen] = useState<string | null>(null);
  // Whether the examples are open, remembered on this device.
  const [examples, setExamples] = useState(() => load('aiExamplesOpen', false));
  const toggleExamples = () =>
    setExamples((v) => {
      save('aiExamplesOpen', !v);
      return !v;
    });
  const shown = list.find((a) => a.id === open);
  return (
    <div>
      <SectionLabel icon="sparkle">Connect an AI assistant</SectionLabel>
      <div className="flex flex-col gap-3 px-6 pt-4 text-sm text-soft">
        <p>{ASSISTANT_INTRO('packing lists')}</p>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-soft">{CONNECTED_TEXT.urlLabel('Duffel')}</span>
          <div className="flex items-center gap-1">
            <div className="min-w-0 flex-1">
              <Code>{url}</Code>
            </div>
            <Copy text={url} />
          </div>
          <span className="text-xs text-faint">{signInNote('Duffel')}</span>
        </div>
      </div>

      <SubHeading icon="link">{CONNECTED_TEXT.heading}</SubHeading>
      <Connections />

      <SubHeading icon="ai">{CONNECTED_TEXT.setUp}</SubHeading>
      <div className="flex flex-col gap-3 px-6 text-sm">
        <SlideToggle
          label="AI assistant"
          value={open}
          allowClear
          onChange={setOpen}
          options={list.map((a) => [a.id, a.name])}
        />
        {shown && (
          <div className="flex flex-col gap-2 text-ink">
            {shown.steps.length > 0 && (
              <ol className="flex list-decimal flex-col gap-1.5 pl-5">
                {shown.steps.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ol>
            )}
            {shown.commandIntro && <p className="text-soft">{shown.commandIntro}</p>}
            {shown.command && (
              <div className="flex items-center gap-1">
                <div className="min-w-0 flex-1">
                  <Code>{shown.command}</Code>
                </div>
                <Copy text={shown.command} />
              </div>
            )}
            {shown.after && <p className="text-soft">{shown.after}</p>}
          </div>
        )}
      </div>

      <button
        type="button"
        aria-expanded={examples}
        onClick={toggleExamples}
        className="flex w-full items-center gap-2 px-6 pt-5 pb-2 text-left text-sm font-semibold text-ink"
      >
        <Icon name="compose" size={15} className="text-accent" />
        {CONNECTED_TEXT.examples}
        <FoldChevron open={examples} size={14} />
      </button>
      <Collapse open={examples}>
        <TryAsking />
      </Collapse>
      <AlwaysOn />
    </div>
  );
}

/**
 * "Always-on agent prompts" (kit layout 5): collapsed; each prompt a row that opens to the full
 * text, what the agent needs connected, and Copy prompt. One open at a time.
 */
function AlwaysOn() {
  const [shown, setShown] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        aria-expanded={shown}
        onClick={() => setShown((v) => !v)}
        className="flex w-full items-center gap-2 px-6 pt-5 pb-2 text-left text-sm font-semibold text-ink"
      >
        <Icon name="sparkle" size={15} className="text-accent" />
        {CONNECTED_TEXT.alwaysOn}
        <FoldChevron open={shown} size={14} />
      </button>
      <Collapse open={shown}>
        <div className="flex flex-col gap-2 px-6 pb-2">
          <p className="text-xs text-faint">{CONNECTED_TEXT.alwaysOnHint}</p>
          {ALWAYS_ON_PROMPTS.map((a) => {
            const on = open === a.id;
            return (
              <div key={a.id} className="rounded-xl border border-line bg-surface">
                <button
                  type="button"
                  aria-expanded={on}
                  onClick={() => setOpen(on ? null : a.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left"
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-sm font-semibold text-ink">{a.title}</span>
                    <span className="text-xs text-soft">{a.summary}</span>
                  </span>
                  <Icon
                    name="chevDown"
                    size={14}
                    className={cx('flex-none text-faint transition-transform', on && 'rotate-180')}
                  />
                </button>
                {on && (
                  <div className="px-4 pb-4">
                    <pre className="max-h-80 overflow-auto rounded-lg bg-bg p-3 font-sans text-xs leading-relaxed whitespace-pre-wrap text-ink">
                      {a.prompt}
                    </pre>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs text-soft">{CONNECTED_TEXT.needs(a.needs)}</span>
                      <Copy text={a.prompt} label={CONNECTED_TEXT.copyPrompt} />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Collapse>
    </>
  );
}

function Connections() {
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);
  const q = useQuery({
    queryKey: ['connections'],
    queryFn: () =>
      api.get<{ connections: { id: string; name: string; created_at: string | null }[] }>(
        '/connections',
      ),
  });
  const list = q.data?.connections ?? [];
  return (
    <div className="flex flex-col gap-1 px-6 text-sm">
      {q.isPending && <p className="text-soft">Loading…</p>}
      {!q.isPending && !list.length && <p className="text-soft">{CONNECTED_TEXT.none}</p>}
      {list.map((c) => (
        <div key={c.id} className="flex items-center gap-2 border-b border-line py-2.5 text-ink">
          <Icon name="sparkle" size={16} className="text-soft" />
          <span className="flex-1">{c.name}</span>
          {c.created_at && (
            <span className="text-xs text-faint">
              {new Date(c.created_at).toLocaleDateString()}
            </span>
          )}
        </div>
      ))}
      {list.length > 0 && (
        <GhostButton
          icon="x"
          className="-ml-3 self-start text-danger"
          onClick={async () => {
            if (!confirm) {
              setConfirm(true);
              setTimeout(() => setConfirm(false), 3000);
              return;
            }
            setConfirm(false);
            setError('');
            try {
              await api.post('/connections/revoke-all');
              await qc.invalidateQueries({ queryKey: ['connections'] });
            } catch (e) {
              setError(errorMessage(e));
            }
          }}
        >
          {confirm ? CONNECTED_TEXT.confirm : CONNECTED_TEXT.disconnectAll}
        </GhostButton>
      )}
      <ErrorText>{error || (q.error ? errorMessage(q.error) : '')}</ErrorText>
    </div>
  );
}

/** Example requests, tap to copy. */
function TryAsking() {
  const toast = useToast();
  return (
    <>
      <div className="px-6">
        <p className="pb-1 text-xs text-faint">{CONNECTED_TEXT.examplesHint}</p>
        {EXAMPLE_PROMPTS.slice(0, 6).map((e) => (
          <button
            key={e.prompt}
            type="button"
            title="Copy"
            className="flex w-full items-start gap-3 border-b border-line py-3 text-left text-sm text-ink"
            onClick={() =>
              void navigator.clipboard
                ?.writeText(e.prompt)
                .then(() => toast({ text: 'Copied.' }))
                .catch(() => {})
            }
          >
            <span className="flex-1">“{e.prompt}”</span>
            <Icon name="copy" size={15} className="mt-0.5 flex-none text-faint" />
          </button>
        ))}
        <p className="pt-2.5 text-xs text-faint">
          Claude also lists ready-made Duffel prompts in its + menu. Connect your email (Gmail,
          Outlook, Fastmail) to the same assistant and it can fill in the itinerary from your
          booking confirmations.
        </p>
      </div>
    </>
  );
}
