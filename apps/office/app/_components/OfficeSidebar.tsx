'use client';

import Link from 'next/link';
import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { Sidebar } from '@thc/ui';
import type { NavItem } from '@thc/ui';

/**
 * The menu counters (§4.1: "A counter in the menu — so the manager can see
 * the queue is not empty"), keyed by the nav item's href.
 *
 * Context rather than a prop on `OfficeShell`, for the reason
 * `SignedInAs.tsx` gives: the shell is rendered from client components on
 * several screens and from server pages on the rest, so the root layout
 * reads the numbers once (`navCounts.ts`) and provides them here. Outside
 * the provider — the component tests — there are simply no counters.
 */
export type NavCounts = Readonly<Record<string, number>>;

const NavCountsContext = createContext<NavCounts>({});

export function NavCountsProvider({
  counts,
  children,
}: {
  counts: NavCounts;
  children: ReactNode;
}) {
  return <NavCountsContext.Provider value={counts}>{children}</NavCountsContext.Provider>;
}

/**
 * The menu items with their counters applied. A counter is a queue that
 * needs someone, so a non-zero one is painted as the wireframe paints
 * Compliance's (coral); zero draws nothing.
 */
export function withCounts(items: readonly NavItem[], counts: NavCounts): NavItem[] {
  return items.map((item) => {
    const count = counts[item.href];
    return count && count > 0 ? { ...item, count, alert: true } : item;
  });
}

export function OfficeSidebar({
  items,
  activeHref,
  brand,
  footer,
}: {
  items: readonly NavItem[];
  activeHref: string;
  brand: ReactNode;
  footer: ReactNode;
}) {
  const counts = useContext(NavCountsContext);
  return (
    <Sidebar
      items={withCounts(items, counts)}
      activeHref={activeHref}
      brand={brand}
      renderLink={(item, className, body) => (
        <Link href={item.href} className={className}>
          {body}
        </Link>
      )}
      footer={footer}
    />
  );
}
