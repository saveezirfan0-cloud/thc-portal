import { PageHead, Panel } from '@thc/ui';
import { OfficeShell } from './_components/OfficeShell';

/**
 * The Back Office root. Still the Phase 0 placeholder: `/dashboard` (§9.1)
 * belongs to the `reports` bot and does not exist yet, so this stands in
 * rather than 404ing the one route every admin lands on after sign-in.
 */
export default function Page() {
  return (
    <OfficeShell activeHref="/dashboard" title="Dashboard">
      <PageHead title="Foundation" description="Screens are built per docs/02-build-plan.md." />
      <Panel title="Next">
        <p>
          Each route in the sidebar is owned by a domain bot. Open
          <code> docs/08-screen-inventory.md</code> for the route → wireframe → section → owner
          table, and <code>docs/10-working-with-agents.md</code> for how to run them.
        </p>
      </Panel>
    </OfficeShell>
  );
}
