import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type ReactNode } from 'react';
import type { AutoPackFallback } from '@shared/lookups';
import { api, errorMessage } from '../lib/api';
import { useAppState } from '../lib/queries';
import { useSave } from '../lib/useSave';
import { useTheme, type Theme } from '../lib/theme';
import { Icon } from '../components/Icon';
import {
  cx,
  ErrorText,
  GhostButton,
  InfoTip,
  PageHeader,
  PrimaryButton,
  SectionLabel,
  SlideToggle,
  Sheet,
  Switch,
} from '../components/ui';
import { useToast } from '../components/Toast';
import { ConnectAISection } from './ConnectAI';
import { NotificationsSection } from './NotificationsSection';
import { InstallHint } from '../components/InstallHint';
import { isStandalone } from '../lib/pwa';
import { isSourceRepo, runUrl, setupUrl, UPSTREAM, useLatestVersion } from '../lib/updates';
import {
  autoUpdatesInfo,
  howUpdatesWork,
  UPDATE_TEXT,
  updateStatus,
  whatsShared,
  workflowFileUrl,
} from '../kit/updates';
import { buildFlags } from '@shared/kit/build';

/** What the usage counts count, in words (matches USAGE_TABLES in the worker). */
const USAGE_COUNTED = 'trips, items, bags and to-dos';
import { AboutButton } from '../components/AboutSheet';

export function Settings() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data } = useAppState();
  const { run, busy, error } = useSave();
  const [theme, setTheme] = useTheme();
  const [restore, setRestore] = useState<{ file: File; data: unknown } | null>(null);
  const [restoreError, setRestoreError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  if (!data) return null;

  async function pickFile(f: File | undefined) {
    if (!f) return;
    setRestoreError('');
    try {
      setRestore({ file: f, data: JSON.parse(await f.text()) });
    } catch {
      setRestoreError('That file isn’t a Duffel backup.');
    }
    if (fileRef.current) fileRef.current.value = '';
  }

  return (
    <div className="pb-12">
      <PageHeader
        title="Settings"
        icon="settings"
        action={<AboutButton variant="header" className="md:hidden" />}
      />

      <SectionLabel icon="palette">Appearance</SectionLabel>
      <div className="px-6 pt-4 pb-2">
        <SlideToggle<Theme>
          label="Appearance"
          value={theme}
          onChange={setTheme}
          options={[
            ['light', 'Light'],
            ['dark', 'Dark'],
            ['system', 'System'],
          ]}
        />
      </div>

      <SectionLabel
        icon="bag"
        trailing={
          <InfoTip label="How auto pack works">
            <div className="flex flex-col gap-3">
              <p>
                Each catalog item says where it packs: their luggage, their carry-on, a type of bag
                (like diapers into a diaper bag), or no bag (a stroller, a car seat). Set it on the
                item in the Catalog; a template can change it for its trips. Bag types are set under
                Catalog → Bags.
              </p>
              <AutoPackList title="When it happens">
                <li>Making a trip from a template, or copying a trip.</li>
                <li>Adding catalog items to a trip, one or several.</li>
                <li>
                  Selecting items and assigning them to someone: anything not in a bag they share
                  moves to theirs.
                </li>
                <li>Adding a bag to a trip: Duffel offers to move the items waiting for it.</li>
              </AutoPackList>
              <AutoPackList title="Where things go">
                <li>A bag type: that person’s bag of that type, else the trip’s shared one.</li>
                <li>Carry-on: that person’s carry-on bag, else a shared carry-on.</li>
                <li>
                  Luggage: that person’s suitcase, else their duffel, backpack or tote, else a
                  shared bag if one clearly fits best. A diaper bag or cooler is used last, only
                  when it’s their only bag.
                </li>
                <li>No bag: the No bag group.</li>
                <li>Nowhere that fits: No bag yet, to sort out by hand.</li>
              </AutoPackList>
              <AutoPackList title="It never">
                <li>Moves something you put in a bag yourself.</li>
                <li>Places items typed in by name that aren’t in the catalog.</li>
              </AutoPackList>
            </div>
          </InfoTip>
        }
      >
        Auto pack
      </SectionLabel>
      <div className="flex flex-col gap-3 px-6 pt-4 pb-2 text-sm text-soft">
        <p>Catalog items go into the right bag when they’re added to a trip.</p>
        <span className="pt-1 text-ink">When someone has no bag of an item’s type</span>
        <SlideToggle<AutoPackFallback>
          label="When someone has no bag of an item’s type"
          value={data.settings.autopack_fallback}
          onChange={(autopack_fallback) => run(() => api.patch('/settings', { autopack_fallback }))}
          options={[
            ['unplaced', 'Leave in No bag yet'],
            ['main', 'Use their luggage'],
          ]}
        />
        <p className="text-xs text-faint">
          {data.settings.autopack_fallback === 'main'
            ? 'It goes in their luggage instead, so nothing is left without a bag.'
            : 'It waits in No bag yet, so you notice. Add a bag of that type and Duffel offers to move it in.'}
        </p>
        <ErrorText>{error}</ErrorText>
      </div>

      <NotificationsSection />

      <ConnectAISection />

      {/* Already installed: nothing to do here, so no section. */}
      {!isStandalone() && (
        <>
          <div id="install" className="scroll-mt-14 md:scroll-mt-0">
            <SectionLabel icon="phone">Install on your phone</SectionLabel>
          </div>
          <div className="px-6 py-4">
            <InstallHint />
          </div>
        </>
      )}

      <SectionLabel icon="archive">Backup</SectionLabel>
      <p className="px-6 pt-4 text-sm text-soft">
        Everything: people, catalog, templates and trips.
      </p>
      <div className="flex flex-col px-6 pt-1">
        <a
          href="/api/export"
          download
          className="flex items-center gap-3 border-b border-line py-3.5 text-base text-ink"
        >
          <Icon name="download" size={18} className="text-accent" />
          <span className="flex-1">Download backup</span>
          <Icon name="chevRight" className="text-faint" />
        </a>
        <button
          onClick={() => fileRef.current?.click()}
          className="flex items-center gap-3 border-b border-line py-3.5 text-left text-base text-ink"
        >
          <Icon name="upload" size={18} className="text-accent" />
          <span className="flex-1">Restore from backup…</span>
          <Icon name="chevRight" className="text-faint" />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => pickFile(e.target.files?.[0])}
        />
        <ErrorText>{restoreError}</ErrorText>
      </div>

      <UpdatesSection
        setUp={buildFlags().updatesOn || data.settings.updates_set_up}
        onSetUp={() => run(() => api.patch('/settings', { updates_set_up: true }))}
        telemetry={data.settings.telemetry}
        onTelemetry={(telemetry) => run(() => api.patch('/settings', { telemetry }))}
      />

      <SectionLabel icon="user">Account</SectionLabel>
      <div className="px-6 pt-2">
        <button
          className="flex w-full items-center gap-3 border-y border-line py-3.5 text-left text-base text-ink"
          onClick={async () => {
            try {
              await api.post('/logout');
            } finally {
              qc.clear();
              window.location.href = '/';
            }
          }}
        >
          <Icon name="logout" size={18} className="text-accent" />
          <span className="flex-1">Sign out of this device</span>
        </button>
      </div>

      <Sheet
        open={!!restore}
        onClose={() => setRestore(null)}
        title="Replace everything?"
        footer={
          <>
            <GhostButton onClick={() => setRestore(null)}>Cancel</GhostButton>
            <PrimaryButton
              tone="danger"
              disabled={busy}
              onClick={async () => {
                if (!restore) return;
                try {
                  await api.post('/import', restore.data);
                  await qc.invalidateQueries();
                  setRestore(null);
                  toast({ text: 'Backup restored' });
                } catch (e) {
                  setRestoreError(errorMessage(e));
                  setRestore(null);
                }
              }}
            >
              Restore
            </PrimaryButton>
          </>
        }
      >
        <p className="py-2 text-sm text-soft">
          Everything in this Duffel is replaced with the contents of {restore?.file.name}. This
          can’t be undone, so download a backup first if you might need it.
        </p>
      </Sheet>
    </div>
  );
}

function AutoPackList({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="font-medium text-ink">{title}</p>
      <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-5 marker:text-faint">{children}</ul>
    </div>
  );
}

const LINK_BUTTON =
  'inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-2.5 text-[15px] font-medium';

/**
 * Updates: is a newer Duffel out, and links into this copy's own GitHub repo to add the
 * update workflow (once) or run it. Updates go Duffel → their repo → their Cloudflare.
 */
function UpdatesSection({
  setUp,
  onSetUp,
  telemetry,
  onTelemetry,
}: {
  setUp: boolean;
  onSetUp: () => void;
  telemetry: boolean;
  onTelemetry: (on: boolean) => void;
}) {
  const latest = useLatestVersion();
  const repo = __SOURCE_REPO__;
  const isSource = isSourceRepo(repo, UPSTREAM);
  const auto = autoUpdatesInfo('Duffel');
  const status = updateStatus('Duffel', __APP_VERSION__, latest.data, latest.isError);
  const how = howUpdatesWork('Duffel');
  const shared = whatsShared('Duffel', USAGE_COUNTED, false);

  return (
    <>
      <SectionLabel
        icon="download"
        trailing={
          !isSource && (
            <InfoTip label={UPDATE_TEXT.howUpdatesWork}>
              <div className="flex flex-col gap-2">
                <p>{how.intro}</p>
                <ol className="flex list-decimal flex-col gap-1 pl-5 marker:text-faint">
                  {how.steps.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ol>
                <p>{how.outro}</p>
              </div>
            </InfoTip>
          )
        }
      >
        {UPDATE_TEXT.heading}
      </SectionLabel>
      <div className="flex flex-col gap-3 px-6 pt-4 pb-2 text-sm text-soft">
        <p className={cx(status.newer && 'text-ink')}>{status.text}</p>
        {setUp && repo && !isSource && (
          <div className="flex items-center gap-1.5 text-ink">
            <Icon name="check" size={16} className="text-accent" />
            {UPDATE_TEXT.autoOn}
            <InfoTip label={UPDATE_TEXT.aboutAutoOn}>
              <div className="flex flex-col gap-2">
                <p>{auto.what}</p>
                <ul className="flex list-disc flex-col gap-1 pl-5 marker:text-faint">
                  {auto.how.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
                <p>{auto.off}</p>
                <a
                  href={workflowFileUrl(repo, __SOURCE_BRANCH__)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent underline underline-offset-2"
                >
                  {auto.fileLink}
                </a>
              </div>
            </InfoTip>
          </div>
        )}
        {isSource ? null : !repo ? (
          <p className="text-xs text-faint">{UPDATE_TEXT.byHand}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {setUp ? (
                <a
                  href={runUrl(repo)}
                  target="_blank"
                  rel="noreferrer"
                  className={cx(
                    LINK_BUTTON,
                    status.newer ? 'bg-accent text-accent-ink' : 'bg-chip text-ink',
                  )}
                >
                  <Icon name="reset" size={16} />
                  {UPDATE_TEXT.updateNow}
                </a>
              ) : (
                <a
                  href={setupUrl(repo, __SOURCE_BRANCH__)}
                  target="_blank"
                  rel="noreferrer"
                  onClick={onSetUp}
                  className={cx(LINK_BUTTON, 'bg-accent text-accent-ink')}
                >
                  <Icon name="github" size={16} />
                  {UPDATE_TEXT.setUp}
                </a>
              )}
              <a
                href={`https://github.com/${repo}`}
                target="_blank"
                rel="noreferrer"
                className="px-1 text-[13px] text-soft underline-offset-2 hover:underline"
              >
                {repo}
              </a>
            </div>
            <p className="text-xs text-faint">
              {setUp ? (
                <>
                  {UPDATE_TEXT.updateNowHint}{' '}
                  <a
                    href={workflowFileUrl(repo, __SOURCE_BRANCH__)}
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-2"
                  >
                    {UPDATE_TEXT.updateFile}
                  </a>
                </>
              ) : (
                UPDATE_TEXT.setUpHint
              )}
            </p>
          </>
        )}
        <div className="flex items-center gap-3 border-t border-line pt-3">
          <span className="flex flex-1 items-center gap-1.5 text-ink">
            {UPDATE_TEXT.telemetry}
            <InfoTip label={UPDATE_TEXT.whatsShared}>
              <div className="flex flex-col gap-2">
                <p>{shared.intro}</p>
                <ul className="flex list-disc flex-col gap-0.5 pl-5 marker:text-faint">
                  {shared.items.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
                <p>{shared.outro}</p>
              </div>
            </InfoTip>
          </span>
          <Switch on={telemetry} onChange={onTelemetry} label={UPDATE_TEXT.telemetry} />
        </div>
      </div>
    </>
  );
}
