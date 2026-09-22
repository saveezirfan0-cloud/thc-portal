import Link from 'next/link';
import type { ReactNode } from 'react';
import { AppBody, AppFrame, AppHeader, BottomNav, SignOut } from '@thc/ui';

/**
 * The Staff App chrome (§10.1): frosted header, body, frosted bottom nav.
 *
 * The four tabs are the ones §10.4 names, in the wireframes' order. Counts
 * are passed in rather than fetched here so the nav badge and the list it
 * points at can never disagree.
 *
 * Sign out sits in the header's action slot, which is an INTERIM placement:
 * `wireframes/staff/profile.html` puts it in the profile sheet behind the
 * avatar, above the help line (§10.1, §10.6). That sheet is the staff-pwa
 * bot's and does not exist yet, and a worker with no way out of the app at
 * all is the worse of the two deviations. Move it into the sheet — and drop
 * it from here — when /profile lands.
 */
export function StaffShell({
  title,
  sub,
  active,
  shifts,
  invites,
  below,
  children,
}: {
  title: ReactNode;
  sub?: ReactNode;
  active: '/shifts' | '/invites' | '/radar' | '/documents';
  shifts?: number;
  invites?: number;
  below?: ReactNode;
  children: ReactNode;
}) {
  const items = [
    // Documents is the compliance domain's screen (§10.4, §4.2). Until it
    // exists the tab renders as text rather than a link to a 404 — and it is
    // deliberately still shown, because it is the one tab an auto-blocked
    // worker keeps (§10.1).
    { href: '/documents', label: 'Documents', pending: true },
    { href: '/shifts', label: 'Shifts', ...(shifts ? { count: shifts } : {}) },
    { href: '/invites', label: 'Invites', ...(invites ? { count: invites } : {}) },
    { href: '/radar', label: 'Radar' },
  ];

  return (
    <AppFrame>
      <AppHeader
        title={title}
        {...(sub ? { sub } : {})}
        brand={<span className="logo round">🥂</span>}
        actions={<SignOut />}
        {...(below ? { below } : {})}
      />
      <AppBody>{children}</AppBody>
      <BottomNav
        items={items}
        activeHref={active}
        renderLink={(item, className, body) => (
          <Link href={item.href} className={className}>
            {body}
          </Link>
        )}
      />
    </AppFrame>
  );
}
