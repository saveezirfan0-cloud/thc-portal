import { Content, PageHead, Panel, Shell, Sidebar, Topbar } from '@thc/ui';

/** The Client Portal is read-only and shows no money at all (§11.1–11.2). */
const NAV = [
  { href: '/events', label: 'Events' },
  { href: '/feedback', label: 'Feedback' },
];

export default function Page() {
  return (
    <Shell
      sidebar={
        <Sidebar
          items={NAV}
          activeHref="/events"
          brand={
            <>
              <span className="logo">THC</span>
              <span>
                <span className="name">The Hospitality Company</span>
                <span className="sub">Client portal</span>
              </span>
            </>
          }
        />
      }
    >
      <Topbar title="Events" timezone="All times UK (Europe/London)" />
      <Content>
        <PageHead title="Foundation" description="Phase 0 shell. Built in Phase 6." />
        <Panel title="Scope">
          <p>
            This portal is read-only: confirmed line-up, event details and feedback. It never shows
            a rate, a charge or any other money (§11.1).
          </p>
        </Panel>
      </Content>
    </Shell>
  );
}
