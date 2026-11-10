// Keeps the installed app (iOS home screen especially) on the latest deploy.
//
// iOS resumes a home-screen app from memory instead of reloading it, so a new deploy is never
// noticed on its own. Three things fix that:
// 1. The page itself (HTML) is fetched network-first in the service worker (vite.config.ts), so
//    any real load gets the newest build when online. Hashed JS/CSS stay cached; they never change.
// 2. Whenever the app comes back to the foreground (and every 30 minutes while open) we ask the
//    browser to check for a new service worker. When one is ready we switch to it and reload,
//    but never while a sheet or menu is open or someone is typing, so nothing half-done is lost.
// 3. About Duffel has "Check for updates" for doing it by hand.
import { registerSW } from 'virtual:pwa-register';

let reg: ServiceWorkerRegistration | undefined;
let pending = false;
let updateSW: ((reload?: boolean) => Promise<void>) | undefined;

/** A sheet or menu is open, or a field has focus: reloading now could lose what was typed. */
function busy(): boolean {
  if (document.querySelector('[role="dialog"], [role="menu"]')) return true;
  const el = document.activeElement;
  return !!el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
}

function applyIfIdle(force = false) {
  if (pending && updateSW && (force || !busy())) void updateSW(true);
}

function check() {
  void reg?.update().catch(() => {
    /* Offline: try again next time. */
  });
}

export function startPwa() {
  updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      pending = true;
      applyIfIdle();
    },
    onRegisteredSW(_url, r) {
      reg = r;
    },
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    check();
    applyIfIdle();
  });
  // Waiting on an open sheet: apply as soon as it closes.
  setInterval(() => applyIfIdle(), 3000);
  setInterval(() => document.visibilityState === 'visible' && check(), 30 * 60 * 1000);
}

/** For the "Check for updates" button. Reloads into a new version if there is one. */
export async function checkForUpdate(): Promise<'updating' | 'latest'> {
  if (!reg) {
    // No service worker (dev, private mode): a plain reload already gets the newest build.
    window.location.reload();
    return 'updating';
  }
  if (pending || reg.waiting) {
    pending = true;
    applyIfIdle(true);
    return 'updating';
  }
  await reg.update();
  const sw = reg.installing ?? reg.waiting;
  if (!sw) return 'latest';
  if (sw.state !== 'installed') {
    await new Promise<void>((done) => {
      const on = () => (sw.state === 'installed' || sw.state === 'redundant') && done();
      sw.addEventListener('statechange', on);
      setTimeout(done, 15000);
    });
  }
  pending = true;
  applyIfIdle(true);
  return 'updating';
}

/** Running as the installed app (home screen), not in a browser tab. */
export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches ||
  (navigator as { standalone?: boolean }).standalone === true;
