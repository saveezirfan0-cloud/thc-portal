import Link from 'next/link';
import { Content, Logo, ModeSwitch, Shell, Sidebar, SignOut, Topbar } from '@thc/ui';
import type { ReactNode } from 'react';
import { NavCount, OperatorFoot } from './ChromeContext';

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
 * `/settings` is in none of the wireframes' sidebars, so it hangs last,
 * below a divider, where it does not disturb their order. It is the
 * Django-Admin replacement (§9.11, §9.12) and without a link an admin could
 * only reach it by typing the URL.
 *
 * `pending` marks a route its owning bot has not built yet: the item keeps
 * its place, so the sidebar still shows the shape of the product, but it
 * renders as text rather than a link. A sidebar that 404s reads as broken
 * rather than unfinished. Drop the flag when the route lands.
 *
 * Dashboard points at `/dashboard` now that §9.1 is built; `/` redirects
 * there, so an old link still lands in the right place. (Until this branch
 * it pointed at `/`, which stood in for the Dashboard.)
 *
 * The appearance switch is added to whatever the screen passes as actions,
 * not passed by the screen: ADR-0007 makes it part of the chrome, and one
 * screen forgetting it is how it ended up living only on /design-system.
 *
 * The Compliance counter (§4.1: "A counter in the menu — so the manager can
 * see the queue is not empty"; every `wireframes/backoffice/*.html` carries
 * `Compliance <span class="count">7</span>`) is the same kind of thing: a
 * screen cannot be asked to pass it, because the badge belongs to every
 * screen. The root layout reads the queue size once per request and
 * `NavCount` picks it up through `ChromeContext`, whichever side of the
 * client boundary this shell renders on. The sidebar foot's operator comes
 * the same way, unless a screen passes `user` itself.
 */
const NAV = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/onboarding', label: 'Onboarding' },
  { href: '/events', label: 'Scheduling' },
  { href: '/compliance', label: 'Compliance' },
  { href: '/checkin', label: 'Check In / Out' },
  { href: '/staff', label: 'Staff', dividerBefore: true },
  { href: '/clients', label: 'Clients' },
  { href: '/roles', label: 'Roles' },
  { href: '/reports', label: 'Reports' },
  { href: '/feedback', label: 'Feedback' },
  { href: '/venues', label: 'Venues' },
  { href: '/settings', label: 'Settings', dividerBefore: true },
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
   * read anywhere in the shell's import graph fails their build. Optional:
   * when no screen passes it, the root layout's read (`chrome.ts`, via
   * `ChromeContext`) fills the foot, so it is never blank inside a session.
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
              {/* Last inside the link, where the wireframe's `.count` sits;
                  `margin-left: auto` pushes it to the rail's edge. */}
              <NavCount href={item.href} />
            </Link>
          )}
          footer={
            <>
              <OperatorFoot user={user} />
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
            <ModeSwitch small />
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
