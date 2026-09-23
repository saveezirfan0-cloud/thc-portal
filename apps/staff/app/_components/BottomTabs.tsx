import Link from 'next/link';

/**
 * The frosted bottom navigation — §10.1, Documents · Shifts · Invites ·
 * Radar.
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
  return (
    <nav className="bottom-nav">
      {tabs.map((tab) => {
        // No `clsx` here: it is a dependency of packages/ui, not of this
        // app, and three booleans do not justify adding one.
        const className =
          [tab.href === active && 'active', tab.locked && 'locked', tab.pending && 'pending']
            .filter(Boolean)
            .join(' ') || undefined;
        const body = (
          <span className="l">
            {tab.label}
            {tab.count ? <span className="n">{tab.count}</span> : null}
          </span>
        );

        // A locked tab (§10.1) and an unbuilt one are both un-pressable,
        // and for the worker that is the same thing: nothing happens. They
        // are told apart by the class, which is what colours them.
        return tab.locked || tab.pending ? (
          <span key={tab.href} className={className} aria-disabled="true">
            {body}
          </span>
        ) : (
          <Link key={tab.href} href={tab.href} className={className}>
            {body}
          </Link>
        );
      })}
    </nav>
  );
}
