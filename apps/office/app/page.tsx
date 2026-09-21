import { Content, PageHead, Panel, Shell, Sidebar, Topbar } from '@thc/ui';

/**
 * Phase 0 shell. `pending` marks a route the owning bot has not built yet:
 * it renders as text rather than a link, because a sidebar that 404s reads
 * as broken rather than unfinished. Drop the flag when the route lands.
 * See docs/08-screen-inventory.md for route → wireframe → § → owner.
 */
const NAV = [
  { href: '/', label: 'Dashboard' },
  { href: '/events', label: 'Events', pending: true },
  { href: '/checkin', label: 'Check-in monitor', pending: true },
  { href: '/onboarding', label: 'Onboarding', pending: true },
  { href: '/compliance', label: 'Compliance', pending: true },
  { href: '/staff', label: 'Staff', pending: true },
  { href: '/clients', label: 'Clients', dividerBefore: true, pending: true },
  { href: '/venues', label: 'Venues' },
  { href: '/roles', label: 'Roles & rates', pending: true },
  { href: '/reports', label: 'Reports', dividerBefore: true, pending: true },
  { href: '/feedback', label: 'Feedback', pending: true },
  { href: '/settings', label: 'Settings', pending: true },
];

export default function Page() {
  return (
    <Shell
      sidebar={
        <Sidebar
          items={NAV}
          activeHref="/"
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
