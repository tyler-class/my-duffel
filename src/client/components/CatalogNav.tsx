import { useLocation, useNavigate } from 'react-router';
import { Icon } from './Icon';
import { cx, PageHeader } from './ui';

const TABS: [string, string][] = [
  ['/catalog', 'Items'],
  ['/catalog/bags', 'Bags'],
  ['/catalog/people', 'People'],
];

/** Header for the Catalog tab: title, action, and a sliding Items / Bags / People switch. */
export function CatalogHeader({ addLabel, onAdd }: { addLabel: string; onAdd: () => void }) {
  const { pathname } = useLocation();
  const nav = useNavigate();
  const index = Math.max(
    0,
    TABS.findIndex(([to]) => to === pathname),
  );
  return (
    <>
      <PageHeader title="Catalog" icon="grid" />
      <div className="flex items-center gap-2 px-5 pt-1 pb-2">
        <div
          role="tablist"
          aria-label="Catalog sections"
          className="relative grid min-w-0 flex-1 grid-cols-3 rounded-full bg-chip p-1"
        >
          <span
            aria-hidden="true"
            className="absolute inset-y-1 left-1 rounded-full bg-surface shadow-[0_1px_3px_rgba(0,0,0,.12)] transition-transform duration-200 ease-out"
            style={{ width: 'calc((100% - 0.5rem) / 3)', transform: `translateX(${index * 100}%)` }}
          />
          {TABS.map(([to, label], i) => (
            <button
              key={to}
              role="tab"
              aria-selected={i === index}
              onClick={() => nav(to)}
              className={cx(
                'relative z-10 rounded-full py-1.5 text-sm transition-colors',
                i === index ? 'font-semibold text-accent' : 'text-soft',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          onClick={onAdd}
          className="inline-flex h-[38px] flex-none items-center gap-1 rounded-full bg-accent px-3.5 text-sm font-medium text-accent-ink"
        >
          <Icon name="plus" size={15} />
          {addLabel}
        </button>
      </div>
    </>
  );
}
