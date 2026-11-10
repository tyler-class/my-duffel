import { useLayoutEffect } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { AboutButton } from '../components/AboutSheet';
import { GlassTabBar, type GlassTab } from '../components/GlassTabBar';
import { Icon } from '../components/Icon';
import { cx } from '../components/ui';
import { useTabSwipe } from '../lib/tabSwipe';
import { useNotifications } from '../lib/notifications';

const TABS: GlassTab[] = [
  ['/', 'Trips', 'map'],
  ['/catalog', 'Catalog', 'grid'],
  ['/templates', 'Templates', 'tmpl'],
  ['/settings', 'Settings', 'settings'],
];

const TAB_PATHS = TABS.map(([to]) => to);

/** The tab whose main page this is (swiping between tabs works there), or null deeper in. */
function tabRoot(path: string): string | null {
  const p = path.replace(/\/+$/, '') || '/';
  if (p === '/trips') return '/';
  return TAB_PATHS.includes(p) ? p : null;
}

function activeTab(path: string): string {
  for (const p of ['/catalog', '/templates', '/settings']) if (path.startsWith(p)) return p;
  return '/';
}

export function Layout() {
  const { pathname } = useLocation();
  // Every change of screen, Back included, opens at the top, never at the old scroll position.
  useLayoutEffect(() => {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    window.scrollTo(0, 0);
  }, [pathname]);
  const active = activeTab(pathname);
  useTabSwipe(TAB_PATHS, tabRoot(pathname));
  useNotifications();
  return (
    // min-h-lvh: on a page too short to scroll, iOS home-screen apps size the viewport without the
    // safe areas and the fixed tab bar floats above the bottom. Filling the large viewport avoids it.
    // (The same setup as HSA Locker and Ratio.)
    <div className="min-h-full min-h-lvh md:pl-60 md:pt-safe">
      {/* Phones: a solid app bar pinned at the top, so nothing blurs under the iPhone status bar. */}
      <header className="sticky top-0 z-20 mb-2 flex h-[calc(env(safe-area-inset-top,0px)+48px)] items-center justify-center gap-2 border-b border-line bg-bg pt-[env(safe-area-inset-top,0px)] md:hidden">
        <Link to="/" aria-label="Duffel home" className="flex h-full items-center gap-2 px-3">
          <img src="/favicon.svg" alt="" className="h-7 w-7 rounded-lg" />
          <span className="text-[17px] font-semibold">Duffel</span>
        </Link>
      </header>
      {/* Tablet and desktop: a sidebar on the left. */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-line bg-chip px-3 pt-[calc(20px+env(safe-area-inset-top,0px))] pb-5 md:flex">
        <div className="flex items-center gap-2.5 px-3 pb-6">
          <img src="/favicon.svg" alt="" className="h-8 w-8 rounded-lg" />
          <span className="truncate text-[15px] font-semibold">Duffel</span>
        </div>
        <nav className="flex flex-col gap-1" aria-label="Main">
          {TABS.map(([to, label, icon]) => (
            <NavLink
              key={to}
              to={to}
              className={cx(
                'flex items-center gap-3 rounded-full px-3.5 py-2.5 text-[15px]',
                active === to
                  ? 'bg-accent-tint font-semibold text-accent'
                  : 'text-soft hover:bg-line/60',
              )}
              aria-current={active === to ? 'page' : undefined}
            >
              <Icon name={icon} />
              {label}
            </NavLink>
          ))}
        </nav>
        <AboutButton variant="nav" className="mt-auto" />
      </aside>

      <main className="mx-auto w-full max-w-2xl pb-[calc(var(--tabbar-clear)+16px)] md:max-w-3xl md:px-6 md:pt-4 md:pb-10">
        <Outlet />
      </main>

      {/* Phones: tabs in a floating glass capsule along the bottom. */}
      <GlassTabBar tabs={TABS} active={active} />
    </div>
  );
}
