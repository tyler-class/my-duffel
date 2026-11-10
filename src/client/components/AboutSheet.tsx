import { useState } from 'react';
import { ABOUT_ICONS, aboutLinks, BUILT_BY, type AboutLinkKind } from '../kit/about';
import { Icon } from './Icon';
import { cx, Sheet } from './ui';

const LINKS = aboutLinks({
  title: 'Duffel',
  repo: 'tyler-class/Duffel',
  email: 'duffel@tylerclass.net',
  coffee: '$0 baggage fees. Buy me a coffee ☕',
});
/** An About link's icon: the kit's shared set, identical in every app. */
function LinkIcon({ kind, className }: { kind: AboutLinkKind; className?: string }) {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: ABOUT_ICONS[kind] }}
    />
  );
}

/** About Duffel: version, what it is, who built it, and links (Selfhost Kit layout). */
export function AboutSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="About Duffel"
      sub={`Version ${__APP_VERSION__}`}
      closeButton
    >
      <div className="flex flex-col gap-3 pt-1">
        <p className="text-base text-ink">
          Duffel is a free, open-source packing list for families: who packs what, which bag it goes
          in, and the to-dos around every trip. It runs on your own Cloudflare account, so your data
          stays yours.
        </p>
        <p className="text-sm text-soft">{BUILT_BY}</p>
      </div>
      <div className="pt-3 pb-2">
        {LINKS.map((l) => (
          <a
            key={l.href}
            href={l.href}
            {...(l.external ? { target: '_blank', rel: 'noreferrer' } : {})}
            className="group flex w-full items-center gap-3 border-t border-line py-3.5 text-base text-ink"
          >
            <LinkIcon kind={l.kind} className="flex-none text-accent" />
            <span className="flex-1 underline-offset-4 group-hover:underline">{l.label}</span>
            <Icon name="chevRight" size={16} className="flex-none text-faint" />
          </a>
        ))}
      </div>
    </Sheet>
  );
}

/**
 * "About Duffel" and its sheet. `nav` looks like a sidebar item; `header` is a small pill
 * for the top right of a page.
 */
export function AboutButton({
  variant,
  className,
}: {
  variant: 'nav' | 'header';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cx(
          variant === 'nav'
            ? 'flex items-center gap-3 rounded-full px-3.5 py-2.5 text-left text-[15px] text-soft hover:bg-line/60'
            : 'inline-flex flex-none items-center gap-1.5 rounded-full bg-chip px-3.5 py-2 text-sm text-soft',
          className,
        )}
      >
        <Icon name="info" size={variant === 'nav' ? 20 : 16} />
        About Duffel
      </button>
      <AboutSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}
