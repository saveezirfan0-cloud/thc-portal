'use client';

import { Avatar } from '@thc/ui';
import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

/**
 * What the Back Office chrome knows about this request that no screen
 * passed it: the Needs-review queue size for the Compliance counter
 * (§4.1: "A counter in the menu — so the manager can see the queue is not
 * empty") and the signed-in operator for the sidebar foot
 * (`wireframes/backoffice/dashboard.html`: avatar, name, role).
 *
 * The root layout reads both once per request (`chrome.ts`) and hands them
 * down through this context rather than through props, because five screens
 * render `OfficeShell` from a client component and a `next/headers` read
 * anywhere in the shell's import graph fails their build. A context reaches
 * the shell whichever side it renders on, and every page carries the badge
 * without knowing it exists — which is the point: the wireframes show the
 * count on every screen, not on /compliance alone.
 */
export interface ChromeData {
  /** Rows in the Needs-review queue (`compliance_review_queue_v`). */
  complianceCount: number;
  /** The signed-in operator, or null outside a session. */
  user: { name: string; role?: string } | null;
}

export const EMPTY_CHROME: ChromeData = { complianceCount: 0, user: null };

const ChromeContext = createContext<ChromeData>(EMPTY_CHROME);

export function ChromeProvider({ value, children }: { value: ChromeData; children: ReactNode }) {
  return <ChromeContext.Provider value={value}>{children}</ChromeContext.Provider>;
}

export function useChrome(): ChromeData {
  return useContext(ChromeContext);
}

/** Which nav item carries a badge, and from which figure. */
const NAV_COUNTS: Record<string, (chrome: ChromeData) => number> = {
  '/compliance': (c) => c.complianceCount,
};

/**
 * The sidebar count badge for one nav item. Danger-coloured (`alert`) because
 * the wireframes paint the Compliance count coral and the screen's own tab
 * badge is `n alert` for the same number (ComplianceScreen). Nothing renders
 * at zero: the counter exists so the manager can see the queue is NOT empty.
 */
export function NavCount({ href }: { href: string }) {
  const chrome = useChrome();
  const n = NAV_COUNTS[href]?.(chrome) ?? 0;
  return n > 0 ? <span className="count alert">{n}</span> : null;
}

/**
 * The sidebar foot's operator line. A screen that passes `user` to the shell
 * still wins; otherwise the layout's read fills it, so the foot is no longer
 * blank on every page (none passed it).
 */
export function OperatorFoot({ user }: { user?: { name: string; role?: string } }) {
  const chrome = useChrome();
  const who = user ?? chrome.user;
  if (!who) return null;
  return (
    <>
      <Avatar name={who.name} size="sm" />
      <div>
        <div className="sm strong">{who.name}</div>
        {who.role ? <div className="xs muted">{who.role}</div> : null}
      </div>
    </>
  );
}
