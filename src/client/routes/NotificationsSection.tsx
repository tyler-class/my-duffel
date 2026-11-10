// Settings → Notifications: this device's own choices (Selfhost Kit layout and words).
import { useEffect, useState } from 'react';
import { BADGE_MEANS, NOTIFY_KINDS } from '@shared/logic';
import {
  disablePush,
  enablePush,
  getState,
  installSteps,
  pushBlocker,
  pushInfo,
  PUSH_TEXT,
  sendTest,
  setPrefs,
  type PushState,
} from '../kit/push';
import { ErrorText, GhostButton, InfoTip, SectionLabel, Switch } from '../components/ui';
import { useToast } from '../components/Toast';
import { errorMessage } from '../lib/api';

const KINDS = NOTIFY_KINDS.map((k) => k.id);

export function NotificationsSection() {
  const toast = useToast();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    getState()
      .then((s) => live && setState(s))
      .catch((e) => live && setError(errorMessage(e)));
    return () => {
      live = false;
    };
  }, []);

  async function act(fn: () => Promise<void>) {
    setError('');
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const info = pushInfo({ badge: BADGE_MEANS });
  const blocker = state && pushBlocker(state, 'Duffel');
  const on = !!state?.on;

  return (
    <>
      <SectionLabel
        icon="bell"
        trailing={
          <InfoTip label={PUSH_TEXT.about}>
            <ul className="flex list-disc flex-col gap-1 pl-5 marker:text-faint">
              {info.lines.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </InfoTip>
        }
      >
        {PUSH_TEXT.heading}
      </SectionLabel>
      <div className="flex flex-col gap-3 px-6 pt-4 pb-2 text-sm text-soft">
        {!state ? (
          <p className="h-6" />
        ) : blocker ? (
          <>
            <div className="flex items-center gap-1.5">
              <p className="text-ink">{blocker.text}</p>
              {blocker.install && (
                <InfoTip label={PUSH_TEXT.howToInstall}>
                  <div className="flex flex-col gap-3">
                    {installSteps('Duffel').map((g) => (
                      <div key={g.label}>
                        <p className="font-medium text-ink">{g.label}</p>
                        <ol className="mt-1 flex list-decimal flex-col gap-0.5 pl-5 marker:text-faint">
                          {g.steps.map((t) => (
                            <li key={t}>{t}</li>
                          ))}
                        </ol>
                      </div>
                    ))}
                  </div>
                </InfoTip>
              )}
            </div>
            {blocker.install && !state.standalone && (
              <GhostButton
                icon="phone"
                className="-ml-3 self-start text-accent"
                onClick={() =>
                  document
                    .getElementById('install')
                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }
              >
                {PUSH_TEXT.installLink}
              </GhostButton>
            )}
          </>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <span className="flex flex-1 items-center gap-1.5 text-base text-ink">
                {PUSH_TEXT.master}
                {state.standalone && (
                  <InfoTip label={PUSH_TEXT.whyItWorks}>
                    <p>{PUSH_TEXT.installed('Duffel')}</p>
                  </InfoTip>
                )}
              </span>
              <Switch
                on={on}
                disabled={busy}
                label={PUSH_TEXT.master}
                // Straight from the tap: the permission prompt needs it.
                onChange={(v) =>
                  act(async () => setState(await (v ? enablePush(KINDS) : disablePush())))
                }
              />
            </div>
            {on &&
              NOTIFY_KINDS.map((k) => (
                <div key={k.id} className="flex items-center gap-3 border-t border-line pt-3">
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-ink">{k.label}</span>
                    <span className="text-xs text-faint">{k.description}</span>
                  </span>
                  <Switch
                    on={state.device?.prefs[k.id] !== false}
                    label={k.label}
                    onChange={(v) =>
                      act(async () => {
                        // Show it now; the server agrees or the error says why.
                        setState((s) =>
                          s?.device
                            ? {
                                ...s,
                                device: { ...s.device, prefs: { ...s.device.prefs, [k.id]: v } },
                              }
                            : s,
                        );
                        const device = await setPrefs({ [k.id]: v });
                        if (device) setState((s) => s && { ...s, device });
                      })
                    }
                  />
                </div>
              ))}
            {on && (
              <div className="border-t border-line pt-2">
                <GhostButton
                  icon="bell"
                  className="-ml-3 text-accent"
                  disabled={busy}
                  onClick={() =>
                    act(async () => {
                      await sendTest();
                      toast({ text: PUSH_TEXT.testSent });
                    })
                  }
                >
                  {PUSH_TEXT.test}
                </GhostButton>
              </div>
            )}
          </>
        )}
        <ErrorText>{error}</ErrorText>
      </div>
    </>
  );
}
