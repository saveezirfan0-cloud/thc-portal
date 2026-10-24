import Link from 'next/link';
import { Alert, EmptyState, Panel, Stepper } from '@thc/ui';
import { NotAvailable } from '../../_components/NotAvailable';
import { OfficeShell } from '../../_components/OfficeShell';
import { currentOfficeRole } from '../../_components/officeUser';
import { isReadOnly, officeCan } from '../../_lib/permissions';
import { supabaseConfigured } from './_lib/db';
import { JobsList } from './_components/JobsList';
import { UploadForm } from './_components/UploadForm';
import { loadHome } from './data';
import { STEPS } from './view-model';
import './process.css';

export const metadata = { title: 'Process timesheet · THC Back Office' };
export const dynamic = 'force-dynamic';

/**
 * /invoices/process — ADR-0210, `wireframes/backoffice/invoice-process.html`.
 * Step 1 of the old tool's four: upload a client's timesheet, and see every
 * job still waiting for review so none is forgotten (audit §10.12).
 */
export default async function Page() {
  const role = await currentOfficeRole();
  if (role && !officeCan(role, 'finance')) {
    return (
      <NotAvailable activeHref="/invoices" title="Process timesheet" role={role} needs="finance" />
    );
  }
  const canAct = !isReadOnly(role) && officeCan(role, 'write');

  const home = supabaseConfigured()
    ? await loadHome()
    : {
        clients: [],
        needsReview: [],
        recent: [],
        problem: 'This environment has no Supabase project.',
      };
  const now = Date.now();

  return (
    <OfficeShell
      activeHref="/invoices"
      title="Process timesheet"
      crumbs={<>Upload and process client timesheets through the 4-step workflow</>}
    >
      <div className="stack pr-page">
        <Stepper steps={STEPS.map((s) => ({ key: s.key, label: s.label }))} current={0} />

        {home.problem ? <Alert tone="coral">{home.problem}</Alert> : null}

        {home.clients.length === 0 && !home.problem ? (
          <Panel>
            <EmptyState>
              <p className="strong">No client is set up for timesheet invoicing yet.</p>
              <p className="sm muted">
                Set a client’s invoicing to “Timesheet” on its client card, with its rate card, and
                it appears here.
              </p>
              <p className="sm">
                <Link href="/clients">Go to Clients</Link>
              </p>
            </EmptyState>
          </Panel>
        ) : (
          <UploadForm clients={home.clients} canAct={canAct} />
        )}

        <JobsList
          title={`Needs review${home.needsReview.length > 0 ? ` (${home.needsReview.length})` : ''}`}
          empty="Nothing is waiting for review."
          jobs={home.needsReview}
          canAct={canAct}
          now={now}
          showAge
        />
        <JobsList
          title="Recent jobs"
          empty="No other jobs yet."
          jobs={home.recent}
          canAct={canAct}
          now={now}
        />
      </div>
    </OfficeShell>
  );
}
