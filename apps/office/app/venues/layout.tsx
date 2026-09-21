import Link from 'next/link';
import { Shell, Sidebar } from '@thc/ui';

/**
 * The Back Office chrome around /venues.
 *
 * It lives here rather than in a shared `app/layout.tsx` because /venues is
 * the first screen in this app to need it; the second screen to arrive
 * should lift `NAV` and this Shell up a level rather than copy them.
 * Mirrors the sidebar in `wireframes/backoffice/venues.html`.
 */
const NAV = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/events', label: 'Events' },
  { href: '/checkin', label: 'Check-in monitor' },
  { href: '/onboarding', label: 'Onboarding' },
  { href: '/compliance', label: 'Compliance' },
  { href: '/staff', label: 'Staff' },
  { href: '/clients', label: 'Clients', dividerBefore: true },
  { href: '/venues', label: 'Venues' },
  { href: '/roles', label: 'Roles & rates' },
  { href: '/reports', label: 'Reports', dividerBefore: true },
  { href: '/feedback', label: 'Feedback' },
  { href: '/settings', label: 'Settings' },
];

export default function VenuesLayout({ children }: { children: React.ReactNode }) {
  return (
    <Shell
      sidebar={
        <Sidebar
          items={NAV}
          activeHref="/venues"
          renderLink={(item, className, body) => (
            <Link href={item.href} className={className}>
              {body}
            </Link>
          )}
          brand={
            <>
              <span className="logo">THC</span>
              <span>
                <span className="name">The Hospitality Company</span>
                <span className="sub">Back office</span>
              </span>
            </>
          }
        />
      }
    >
      {children}
    </Shell>
  );
}
