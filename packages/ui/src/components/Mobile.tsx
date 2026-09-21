'use client';

import { clsx } from 'clsx';
import { Fragment, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

/** Staff App chrome (§10.1). These components are only used by apps/staff. */

/**
 * The frame every Staff App screen sits in. It carries the two background
 * radial glows (cyan + purple on dark, clay + amber on the warm ground) and
 * clips them. Depth in this design comes from glows and frosted surfaces —
 * there are no drop shadows anywhere.
 */
export function AppFrame({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('app-frame', className)}>{children}</div>;
}

/** The gallery mock of a handset, 390×844. Only used by /design-system. */
export function PhoneFrame({
  caption,
  short,
  children,
}: {
  caption?: ReactNode;
  short?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="phone-wrap">
      {caption ? <span className="cap">{caption}</span> : null}
      <div className={clsx('phone', short && 'short')}>{children}</div>
    </div>
  );
}

export function StatusBar({ time = '09:41', right = '5G ▮▮▮ 84%' }: { time?: string; right?: string }) {
  return (
    <div className="statusbar" aria-hidden="true">
      <span>{time}</span>
      <span className="r">{right}</span>
    </div>
  );
}

export interface AppHeaderProps {
  title: ReactNode;
  sub?: ReactNode;
  /** Brand tile. Stays left when the header collapses (§10.1). */
  brand?: ReactNode;
  /** Worker avatar or menu button. Stays right when the header collapses. */
  actions?: ReactNode;
  /** Frosted control strip under the title, e.g. My shifts / Open shifts. */
  below?: ReactNode;
  collapsed?: boolean;
}

/**
 * Frosted top bar: rgba(panel, .6) + backdrop-filter, 1px divider. It
 * collapses on scroll — the logo stays left, the profile stays right, only
 * the title shrinks.
 */
export function AppHeader({ title, sub, brand, actions, below, collapsed }: AppHeaderProps) {
  return (
    <header className={clsx('app-header', collapsed && 'collapsed')}>
      {brand}
      <div className="title">
        {title}
        {sub ? <div className="sub">{sub}</div> : null}
      </div>
      {actions ? <div className="actions">{actions}</div> : null}
      {below ? <div className="below">{below}</div> : null}
    </header>
  );
}

/**
 * True once the page has scrolled past `threshold`. Drives `AppHeader`'s
 * collapsed state without every screen writing its own listener.
 */
export function useCollapsedHeader(threshold = 24): boolean {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    const onScroll = () => setCollapsed(window.scrollY > threshold);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [threshold]);
  return collapsed;
}

export function AppBody({ children, className }: { children: ReactNode; className?: string }) {
  return <main className={clsx('app-body', className)}>{children}</main>;
}

export interface BottomNavItem {
  href: string;
  label: string;
  icon?: ReactNode;
  count?: number;
  /** Compliance auto-block leaves only Documents reachable (§10.1). */
  locked?: boolean;
}

/** Frosted bottom navigation: Documents · Shifts · Invites · Radar. */
export function BottomNav({
  items,
  activeHref,
  renderLink,
}: {
  items: BottomNavItem[];
  activeHref?: string;
  renderLink?: (item: BottomNavItem, className: string, children: ReactNode) => ReactNode;
}) {
  return (
    <nav className="bottom-nav">
      {items.map((item) => {
        const className = clsx(item.href === activeHref && 'active', item.locked && 'locked');
        const body = (
          <>
            {item.icon ? <span className="ico">{item.icon}</span> : null}
            <span>{item.label}</span>
            {item.count ? <span className="n">{item.count}</span> : null}
          </>
        );
        return renderLink ? (
          <Fragment key={item.href}>{renderLink(item, className, body)}</Fragment>
        ) : (
          <a key={item.href} href={item.href} className={className}>
            {body}
          </a>
        );
      })}
    </nav>
  );
}

export function Sheet({
  open,
  onClose,
  label,
  children,
}: {
  open: boolean;
  onClose: () => void;
  label?: string;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <>
      <div className="sheet-back" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={label}>
        <span className="grab" />
        {children}
      </div>
    </>
  );
}

export type MobileCardTone = 'today' | 'needs' | 'live' | 'applied' | 'muted';

export interface MobileCardProps {
  title?: ReactNode;
  meta?: ReactNode;
  /** Right-aligned status chip in the card header. */
  badge?: ReactNode;
  tone?: MobileCardTone;
  children?: ReactNode;
}

export function MobileCard({ title, meta, badge, tone, children }: MobileCardProps) {
  return (
    <div className={clsx('mcard', tone)}>
      {title || badge ? (
        <div className="h">
          <div>
            {title ? <div className="t">{title}</div> : null}
            {meta ? <div className="m">{meta}</div> : null}
          </div>
          {badge}
        </div>
      ) : (
        meta && <div className="m">{meta}</div>
      )}
      {children}
    </div>
  );
}

export function MobileList({ children }: { children: ReactNode }) {
  return <div className="mlist">{children}</div>;
}

export function MobileRow({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mrow">
      <span className="grow">{children}</span>
      {right ? <span className="right">{right}</span> : null}
    </div>
  );
}

/** Geofence state on the on-shift screen (§5). */
export function GpsChip({ inside, children }: { inside: boolean; children: ReactNode }) {
  return (
    <span className={clsx('gps', inside ? 'ok' : 'bad')}>
      <i className="dot" />
      {children}
    </span>
  );
}

/** The chargeable-so-far counter. Tabular numerals so it does not jitter. */
export function Timer({ children }: { children: ReactNode }) {
  return <span className="timer mono">{children}</span>;
}
