import type { ReactNode } from 'react';
import Link from 'next/link';
import { Content, Shell, Sidebar, Topbar } from '@thc/ui';

/**
 * The Back Office chrome around the Shift Builder, mirroring the sidebar in
 * `wireframes/backoffice/shift-builder.html`. Scheduling is the active item
 * for every /events route.
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

export function OfficeShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Shell
      sidebar={
        <Sidebar
          items={NAV}
          activeHref="/events"
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
      <Topbar
        title={title}
        crumbs={
          <>
            <Link href="/events">Scheduling</Link> / <b>Shift Builder</b>
          </>
        }
        timezone="Viewer: Europe/London (UK)"
      />
      <Content>{children}</Content>
    </Shell>
  );
}
