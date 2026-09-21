import { Content, PageHead, Panel, Shell, Sidebar, Topbar } from '@thc/ui';

/**
 * Phase 0 shell. Every route below is a placeholder the owning bot fills in:
 * see docs/08-screen-inventory.md for route → wireframe → § → owner.
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

export default function Page() {
  return (
    <Shell
      sidebar={
        <Sidebar
          items={NAV}
          activeHref="/dashboard"
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
      <Topbar title="Dashboard" timezone="All times UK (Europe/London)" />
      <Content>
        <PageHead
          title="Foundation"
          description="Phase 0 shell. Screens are built per docs/02-build-plan.md."
        />
        <Panel title="Next">
          <p>
            Each route in the sidebar is owned by a domain bot. Open
            <code> docs/08-screen-inventory.md</code> for the route → wireframe → section → owner
            table, and <code>docs/10-working-with-agents.md</code> for how to run them.
          </p>
        </Panel>
      </Content>
    </Shell>
  );
}
