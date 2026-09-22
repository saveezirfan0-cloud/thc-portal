import Link from 'next/link';
import { Avatar, Content, Logo, Shell, Sidebar, SignOut, Topbar } from '@thc/ui';
import type { ReactNode } from 'react';

/**
 * The Back Office chrome: sidebar, topbar and content well.
 *
 * One copy, because there were three. `/venues` carried its own layout and
 * `/events` its own `OfficeShell`, each with a different set of nav labels,
 * so the same menu read differently depending on which screen you were on.
 * The labels and the order below are the wireframes' — every
 * `wireframes/backoffice/*.html` has the same sidebar, and that is the
 * visual contract (CLAUDE.md).
 *
 * `/settings` is deliberately absent: it is in the screen inventory but in
 * none of the wireframes' sidebars. It is the Django-Admin replacement
 * (§9.11, §9.12) and where it hangs is platform's call, not this file's.
 *
 * `pending` marks a route its owning bot has not built yet: the item keeps
 * its place, so the sidebar still shows the shape of the product, but it
 * renders as text rather than a link. A sidebar that 404s reads as broken
 * rather than unfinished. Drop the flag when the route lands.
 *
 * Dashboard points at `/`, not `/dashboard`: §9.1 belongs to the `reports`
 * bot and until it exists the index stands in for it.
 */
const NAV = [
  { href: '/', label: 'Dashboard' },
  { href: '/onboarding', label: 'Onboarding', pending: true },
  { href: '/events', label: 'Scheduling' },
  { href: '/compliance', label: 'Compliance', pending: true },
  { href: '/checkin', label: 'Check In / Out' },
  { href: '/staff', label: 'Staff', dividerBefore: true },
  { href: '/clients', label: 'Clients' },
  { href: '/roles', label: 'Roles' },
  { href: '/reports', label: 'Reports', pending: true },
  { href: '/feedback', label: 'Feedback', pending: true },
  { href: '/venues', label: 'Venues' },
];

export interface OfficeShellProps {
  /** Which nav item is lit. Use the section's root, e.g. `/events` for `/events/new`. */
  activeHref: string;
  title: ReactNode;
  crumbs?: ReactNode;
  /**
   * The topbar's right-hand zone note (§1.8). Screens that show scheduled
   * times pass `<ViewerZone />`, which names the reader's own zone; screens
   * with no times keep the plain UK statement.
   */
  timezone?: ReactNode;
  actions?: ReactNode;
  /**
   * The signed-in operator, for the sidebar foot
   * (`wireframes/backoffice/dashboard.html`: avatar, name, role).
   *
   * A prop rather than a lookup in here, because five screens render this
   * shell from a client component (`StaffScreen`, `RolesScreen`,
   * `ClientsScreen`, `ClientCard`, `ProfileScreen`), and a `next/headers`
   * read anywhere in the shell's import graph fails their build. Server
   * pages pass it; the sign-out button below does not wait for it.
   */
  user?: { name: string; role?: string };
  children: ReactNode;
}

export function OfficeShell({
  activeHref,
  title,
  crumbs,
  timezone = 'All times UK (Europe/London)',
  actions,
  user,
  children,
}: OfficeShellProps) {
  return (
    <Shell
      sidebar={
        <Sidebar
          items={NAV}
          activeHref={activeHref}
          brand={
            <>
              <Logo />
              <div>
                <div className="name">The Hospitality Company</div>
                <div className="sub">Back Office</div>
              </div>
            </>
          }
          renderLink={(item, className, body) => (
            <Link href={item.href} className={className}>
              {body}
            </Link>
          )}
          footer={
            <>
              {user ? (
                <>
                  <Avatar name={user.name} size="sm" />
                  <div>
                    <div className="sm strong">{user.name}</div>
                    {user.role ? <div className="xs muted">{user.role}</div> : null}
                  </div>
                </>
              ) : null}
              <SignOut className="ml-auto" />
            </>
          }
        />
      }
    >
      <Topbar
        title={title}
        crumbs={crumbs}
        timezone={timezone}
        actions={
          <>
            {actions}
            {/* The sidebar foot is `display: none` below 760px, where the rail
                becomes a bottom bar — so on a phone the button above is gone
                and this is the only sign-out left. */}
            <span className="only-phone">
              <SignOut />
            </span>
          </>
        }
      />
      <Content>{children}</Content>
    </Shell>
  );
}
