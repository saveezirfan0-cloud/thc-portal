'use client';

import { clsx } from 'clsx';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ModeSwitch } from './ModeSwitch';

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

export function StatusBar({
  time = '09:41',
  right = '5G ▮▮▮ 84%',
}: {
  time?: string;
  right?: string;
}) {
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
 *
 * The appearance switch (ADR-0007) is part of the header rather than
 * something each screen passes in `actions`. Every Staff App screen builds
 * its own header — `StaffShell` for the four tabs, a hand-rolled one on the
 * shift screen and on its no-project fallback — so a switch that screens
 * opt into is a switch that is missing from whichever screen lands next.
 *
 * It is the icon-only form on purpose: this header is designed at 390px and
 * §10.1 fixes what it may spend width on (logo left, profile right, title
 * in between). A labelled Light/Dark pair does not fit beside a title like
 * "Corporate Summer Party".
 */
export function AppHeader({ title, sub, brand, actions, below, collapsed }: AppHeaderProps) {
  return (
    <header className={clsx('app-header', collapsed && 'collapsed')}>
      {brand}
      <div className="title">
        {title}
        {sub ? <div className="sub">{sub}</div> : null}
      </div>
      <div className="actions">
        {actions}
        <ModeSwitch compact />
      </div>
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
  /** Phase 0: the route does not exist yet, so it renders as text. */
  pending?: boolean;
}

/**
 * Frosted bottom navigation: Documents · Shifts · Invites · Radar.
 *
 * There is deliberately NO `renderLink` callback (O15). This file carries a
 * file-level `'use client'`, so a function prop cannot reach it from a server
 * component — React refuses to serialise one and the page answers 500, not a
 * warning. That prop existed here until 23.09 and crashed the Staff App twice
 * in a day: `StaffShell` took out /shifts, /invites and /radar (#35), and
 * `ProfileShell` took out the whole §10.1 profile sheet (#42). Both shipped
 * green, because a 500 page carries none of the markers the specs skipped on.
 *
 * It was easy to write because the Back Office's `Sidebar` takes an
 * identical-looking `renderLink` and is perfectly safe — `Shell.tsx` has no
 * `'use client'`. The two are indistinguishable at the call site, so copying
 * the Office pattern into the Staff App wrote a 500 that built clean.
 *
 * `PhoneNav` (the Back Office's phone tab bar) is the exception that proves
 * it: it IS `'use client'` and does take a `renderLink`, which is safe only
 * because its one caller, `OfficeSidebar`, is a client component too. From
 * a server component it would be this same 500.
 *
 * A caller that needs `next/link`, or needs a locked tab to be an unpressable
 * span rather than a styled anchor, passes DATA to
 * `apps/staff/app/_components/BottomTabs.tsx` instead: only strings cross the
 * boundary, and it owns the decision about what a link is.
 */
export function BottomNav({ items, activeHref }: { items: BottomNavItem[]; activeHref?: string }) {
  return (
    <nav className="bottom-nav">
      {items.map((item) => {
        const className = clsx(
          item.href === activeHref && 'active',
          item.locked && 'locked',
          item.pending && 'pending',
        );
        const body = (
          <>
            {item.icon ? <span className="ico">{item.icon}</span> : null}
            <span className="l">
              {item.label}
              {item.count ? <span className="n">{item.count}</span> : null}
            </span>
          </>
        );
        if (item.pending) {
          return (
            <span key={item.href} className={className} aria-disabled="true">
              {body}
            </span>
          );
        }
        return (
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

/** A row of phone mocks in the gallery. */
export function PhoneRow({ children }: { children: ReactNode }) {
  return <div className="phones">{children}</div>;
}

/**
 * A terminal, centred screen with no way forward. Three of the four app-lock
 * cases use it (§10.1): manual block, quiz failed three times, and the P45
 * leaver screen.
 */
export function StaticScreen({
  title,
  children,
  actions,
}: {
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="static-screen">
      <h2>{title}</h2>
      {children ? <p>{children}</p> : null}
      {actions}
    </div>
  );
}

/** Wizard step header: "1 / 11", the step title and the progress track. */
export function WizardHeader({
  step,
  total,
  title,
  sub,
}: {
  step: number;
  total: number;
  title: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <div className="wizard-top">
      <span className="n">
        {step} / {total}
      </span>
      <h2>{title}</h2>
      {sub ? <p className="muted">{sub}</p> : null}
    </div>
  );
}
