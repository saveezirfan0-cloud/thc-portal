import Link from 'next/link';
import { Content, Shell, Sidebar, Topbar } from '@thc/ui';
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
        <Sidebar
          items={NAV}
          activeHref={activeHref}
          brand={
            <>
              <span className="logo">THC</span>
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
        />
      }
    >
      <Topbar title={title} crumbs={crumbs} timezone={timezone} actions={actions} />
      <Content>{children}</Content>
    </Shell>
  );
}
