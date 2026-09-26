import Link from 'next/link';
import type { ReactNode } from 'react';
import '../chrome.css';

/**
 * The frosted bottom navigation — §10.1, as ADR-0042 reorders it:
 * Shifts · Invites · Radar · Profile (`STAFF_TABS` in profile/lock.ts).
 *
 * Why this is not `BottomNav` from packages/ui
 * -------------------------------------------
 * It is the same markup and the same `.bottom-nav` styles; what differs is
 * how the links are produced. `BottomNav` takes a `renderLink` CALLBACK so
 * each app can supply its own router link — and `packages/ui/Mobile.tsx`
 * is `'use client'`, so passing that callback from a server component
 * throws:
 *
 *   Functions cannot be passed directly to Client Components unless you
 *   explicitly expose it by marking it with "use server".
 *
 * Which is exactly what the shell was doing, so every screen that rendered
 * it answered 500. (It went unseen because the e2e suite skips those
 * screens when the page has no cards on it, and a 500 has no cards on it.)
 *
 * This component is the same nav with the decision inverted: it takes data
 * and decides what a link is itself, so nothing crosses the server/client
 * boundary but strings. `packages/ui` is another session's to change
 * (docs/10 §3), hence a local component rather than a new prop on theirs.
 */
export interface Tab {
  href: string;
  label: string;
  count?: number;
  /** §10.1 case 1: locked tabs are not pressable, not just greyed. */
  locked?: boolean;
  /** The route does not exist yet, so it renders as text. */
  pending?: boolean;
}

export function BottomTabs({ tabs, active }: { tabs: Tab[]; active?: string }) {
  // Named, so a screen reader's landmark list reads "Main, navigation"
  // rather than a bare "navigation" beside the header's own links; and the
  // lit tab says so in words (`aria-current="page"`), not only in cyan.
  return (
    <nav className="bottom-nav" aria-label="Main">
      {tabs.map((tab) => {
        const isActive = tab.href === active;
        // No `clsx` here: it is a dependency of packages/ui, not of this
        // app, and three booleans do not justify adding one.
        const className =
          [isActive && 'active', tab.locked && 'locked', tab.pending && 'pending']
            .filter(Boolean)
            .join(' ') || undefined;
        const current = isActive ? ('page' as const) : undefined;
        const icon = TAB_ICONS[tab.href];
        const body = (
          <>
            {icon ? (
              <span className="ico" aria-hidden="true">
                {icon}
              </span>
            ) : null}
            <span className="l">
              {tab.label}
              {tab.count ? <span className="n">{tab.count}</span> : null}
            </span>
          </>
        );

        // A locked tab (§10.1) and an unbuilt one are both un-pressable,
        // and for the worker that is the same thing: nothing happens. They
        // are told apart by the class, which is what colours them.
        return tab.locked || tab.pending ? (
          <span key={tab.href} className={className} aria-disabled="true" aria-current={current}>
            {body}
          </span>
        ) : (
          <Link key={tab.href} href={tab.href} className={className} aria-current={current}>
            {body}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * One glyph per tab, in the wireframe's `.i` slot (`.ico` in packages/ui,
 * 20 px). Drawn like the header's sun/moon (ModeSwitch): 24-unit box,
 * `currentColor` stroke at 1.8, round caps — so a tab's icon takes the
 * tab's colour (muted, active cyan, locked faded) with nothing restated.
 * `aria-hidden`: the label is the accessible name, and "calendar Shifts"
 * would be a worse one.
 */
function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

const TAB_ICONS: Record<string, ReactNode> = {
  // Calendar.
  '/shifts': (
    <Glyph>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </Glyph>
  ),
  // Envelope.
  '/invites': (
    <Glyph>
      <rect x="3" y="5.5" width="18" height="13" rx="2.5" />
      <path d="M3.5 7.5l8.5 6 8.5-6" />
    </Glyph>
  ),
  // Radar: rings and a sweep.
  '/radar': (
    <Glyph>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 12l5.5-5.5" />
      <circle cx="12" cy="12" r="0.8" />
    </Glyph>
  ),
  // Person.
  '/profile': (
    <Glyph>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" />
    </Glyph>
  ),
};
