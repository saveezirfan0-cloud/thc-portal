'use client';

import { clsx } from 'clsx';
import { useEffect, useId, useState } from 'react';
import type { ReactNode } from 'react';
import type { NavItem } from './Shell';

export interface PhoneNavProps {
  items: readonly NavItem[];
  activeHref?: string;
  /** Shown at the top of the More sheet: the product name. */
  brand?: ReactNode;
  /**
   * The sidebar foot (who is signed in, sign out) plus anything else that
   * lives in the chrome rather than on a screen — the appearance switch.
   * Below 760px the sidebar is gone, so this sheet is where they live.
   */
  footer?: ReactNode;
  /** Renders each item; apps pass their router's Link. */
  renderLink?: (
    item: NavItem,
    className: string,
    children: ReactNode,
    onNavigate: () => void,
  ) => ReactNode;
}

/** The sidebar's dividers, as groups: the sheet draws them as separate grids. */
function groups(items: readonly NavItem[]): NavItem[][] {
  const out: NavItem[][] = [];
  for (const item of items) {
    if (item.dividerBefore || out.length === 0) out.push([]);
    out[out.length - 1]!.push(item);
  }
  return out;
}

/**
 * The Back Office menu on a phone (§1.2): a frosted tab bar with the items
 * marked `primary` plus More, and a sheet holding the whole menu.
 *
 * It replaces what the sidebar used to become below 760px — a single
 * sideways-scrolling row of all twelve items, where half the menu sat off
 * the right edge with nothing to say it was there, and the sign-out and
 * appearance switch had to be squeezed into every screen's top bar.
 *
 * More carries the sum of the counters it hides, so a queue that needs
 * someone (Compliance's "Needs review") is never invisible behind it.
 */
export function PhoneNav({ items, activeHref, brand, footer, renderLink }: PhoneNavProps) {
  const [open, setOpen] = useState(false);
  const sheetId = useId();
  const close = () => setOpen(false);

  // The sheet is a menu, not a page: a route change or Escape dismisses it.
  useEffect(() => setOpen(false), [activeHref]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const primary = items.filter((item) => item.primary);
  const hidden = items.filter((item) => !item.primary);
  const hiddenCount = hidden.reduce((sum, item) => sum + (item.count ?? 0), 0);
  const hiddenAlert = hidden.some((item) => item.count && item.alert);
  const moreActive = hidden.some((item) => item.href === activeHref);

  const link = (item: NavItem, className: string, label: ReactNode) => {
    const body = (
      <>
        {item.icon ? <span className="ico">{item.icon}</span> : null}
        <span className="l">{label}</span>
        {item.count ? (
          <span className={clsx('count', item.alert && 'alert')}>{item.count}</span>
        ) : null}
        {item.pending ? <span className="soon">soon</span> : null}
      </>
    );
    if (item.pending) {
      return (
        <span key={item.href} className={clsx(className, 'pending')} aria-disabled="true">
          {body}
        </span>
      );
    }
    return renderLink ? (
      <span key={item.href} className="pnav-slot">
        {renderLink(item, className, body, close)}
      </span>
    ) : (
      <a key={item.href} href={item.href} className={className} onClick={close}>
        {body}
      </a>
    );
  };

  return (
    <div className="phone-nav">
      {open ? (
        <>
          <div className="sheet-back" onClick={close} aria-hidden="true" />
          <div className="sheet pnav-sheet" id={sheetId} role="dialog" aria-label="Menu">
            <span className="grab" />
            {brand ? <div className="pnav-brand">{brand}</div> : null}
            <nav className="pnav-groups" aria-label="All sections">
              {groups(items).map((group) => (
                <div key={group[0]!.href} className="pnav-grid">
                  {group.map((item) =>
                    link(item, clsx('pnav-item', item.href === activeHref && 'active'), item.label),
                  )}
                </div>
              ))}
            </nav>
            {footer ? <div className="pnav-foot">{footer}</div> : null}
          </div>
        </>
      ) : null}
      <nav className="pnav-bar" aria-label="Main">
        {primary.map((item) =>
          link(
            item,
            clsx('pnav-tab', item.href === activeHref && 'active'),
            item.short ?? item.label,
          ),
        )}
        <button
          type="button"
          className={clsx('pnav-tab', (open || moreActive) && 'active')}
          aria-expanded={open}
          aria-controls={sheetId}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="ico">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </span>
          <span className="l">More</span>
          {hiddenCount > 0 ? (
            <span className={clsx('count', hiddenAlert && 'alert')}>{hiddenCount}</span>
          ) : null}
        </button>
      </nav>
    </div>
  );
}
