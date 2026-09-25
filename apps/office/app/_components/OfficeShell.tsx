import { Content, Logo, ModeSwitch, Shell, SignOut, Topbar } from '@thc/ui';
import type { NavItem } from '@thc/ui';
import { NAV_ICONS } from './navIcons';
import { OfficeSidebar } from './OfficeSidebar';
import { SignedInAs } from './SignedInAs';
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
 * `/settings` is in none of the wireframes' sidebars, so it hangs last,
 * below a divider, where it does not disturb their order — and the three
 * account screens (`/users`, `/activity`, `/account`, ADR-0035) hang
 * under it for the same reason. It is the
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
 * The counters (§4.1's Compliance "Needs review" number) are not here: the
 * root layout reads them once and `OfficeSidebar` applies them from context,
 * for the same reason the sidebar foot's name arrives that way.
 *
 * On a phone (below 760px) the sidebar is replaced by `PhoneNav`: the four
 * `primary` items are tabs — the day-of-operations screens a manager opens
 * from a phone — and everything else, with the sign-out and the appearance
 * switch, is one tap away under More.
 */
const ITEMS: readonly NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', primary: true },
  { href: '/onboarding', label: 'Onboarding' },
  { href: '/events', label: 'Scheduling', primary: true },
  { href: '/compliance', label: 'Compliance', primary: true },
  { href: '/checkin', label: 'Check In / Out', short: 'Check-in', primary: true },
  { href: '/staff', label: 'Staff', dividerBefore: true },
  { href: '/clients', label: 'Clients' },
  { href: '/roles', label: 'Roles' },
  { href: '/reports', label: 'Reports' },
  { href: '/feedback', label: 'Feedback' },
  { href: '/venues', label: 'Venues' },
  { href: '/settings', label: 'Settings', dividerBefore: true },
  { href: '/users', label: 'Users & access', short: 'Users' },
  { href: '/activity', label: 'Activity log', short: 'Activity' },
  { href: '/inbox', label: 'Inbox', short: 'Inbox' },
  { href: '/account', label: 'My profile', short: 'Profile' },
];

export const NAV: readonly NavItem[] = ITEMS.map((item) => ({
  ...item,
  icon: NAV_ICONS[item.href],
}));

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
  children: ReactNode;
}

export function OfficeShell({
  activeHref,
  title,
  crumbs,
  timezone = 'All times UK (Europe/London)',
  actions,
  children,
}: OfficeShellProps) {
  return (
    <Shell
      sidebar={
        <OfficeSidebar
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
          footer={
            <>
              <SignedInAs />
              {/* `ml-auto xs` text link, as every backoffice wireframe's
                  `.foot` draws it — a pill here was ADR-0012's last piece
                  of drift, waiting on a `link` tone to exist. */}
              <SignOut tone="link" size="md" className="ml-auto xs" />
            </>
          }
          phoneFooter={
            <>
              <div className="row">
                <SignedInAs />
                <SignOut className="ml-auto" />
              </div>
              <ModeSwitch small />
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
            {/* Below 760px the switch moves into the phone menu's More
                sheet with the sign-out, so the top bar keeps one row. */}
            <span className="hide-phone">
              <ModeSwitch small />
            </span>
          </>
        }
      />
      <Content>{children}</Content>
    </Shell>
  );
}
