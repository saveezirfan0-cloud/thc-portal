import { PageHead, Panel } from '@thc/ui';
import { OfficeShell } from './_components/OfficeShell';

/**
 * The Back Office root, and the Dashboard until §9.1 is built: that screen
 * belongs to the `reports` bot. The sidebar points here rather than at
 * /dashboard, which does not exist, and marks every other unbuilt route
 * `pending` so none of them 404s either.
 */
export default function Page() {
  return (
    <OfficeShell activeHref="/" title="Dashboard">
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
