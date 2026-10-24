import Link from 'next/link';
import { Alert, EmptyState, Panel, Pill, Stepper } from '@thc/ui';
import { NotAvailable } from '../../../_components/NotAvailable';
import { OfficeShell } from '../../../_components/OfficeShell';
import { currentOfficeRole } from '../../../_components/officeUser';
import { isReadOnly, officeCan } from '../../../_lib/permissions';
import { supabaseConfigured } from '../_lib/db';
import { ConfirmScreen } from '../_components/ConfirmScreen';
import { ErrorView } from '../_components/ErrorView';
import { GenerateScreen } from '../_components/GenerateScreen';
import { ProcessingView } from '../_components/ProcessingView';
import { ReviewScreen } from '../_components/ReviewScreen';
import { loadJob, loadJobInvoices, loadSources, loadTimesheetClients, loadVatRate } from '../data';
import {
  JOB_STATUS_LABEL,
  JOB_STATUS_TONE,
  STEPS,
  issuedGroupIndexes,
  stepFor,
  todayInUk,
} from '../view-model';
import '../process.css';

export const metadata = { title: 'Process timesheet · THC Back Office' };
export const dynamic = 'force-dynamic';

const STALLED_MS = 10 * 60_000;

/**
 * /invoices/process/[jobId] — always resumes at the right step from the
 * job's status: uploaded / extracting → reading; error → retry; reviewing →
 * Review (or Confirm, with `?step=confirm`); confirmed → Generate;
 * complete → the invoices it made.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ jobId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { jobId } = await params;
  const query = await searchParams;
  const role = await currentOfficeRole();
  if (role && !officeCan(role, 'finance')) {
    return (
      <NotAvailable activeHref="/invoices" title="Process timesheet" role={role} needs="finance" />
    );
  }
  const canAct = !isReadOnly(role) && officeCan(role, 'write');
  const stepParam = typeof query['step'] === 'string' ? query['step'] : null;

  const shell = (children: React.ReactNode, crumbs?: React.ReactNode) => (
    <OfficeShell activeHref="/invoices" title="Process timesheet" crumbs={crumbs}>
      <div className="stack pr-page">{children}</div>
    </OfficeShell>
  );

  if (!supabaseConfigured()) {
    return shell(<Alert tone="coral">This environment has no Supabase project.</Alert>);
  }
  const { detail, problem } = await loadJob(jobId);
  if (!detail) {
    return shell(
      <Panel>
        <EmptyState>
          <p className="strong">
            {problem ? 'This job could not be read.' : 'This job does not exist.'}
          </p>
          {problem ? <p className="sm coral">{problem}</p> : null}
          <p className="sm">
            <Link href="/invoices/process">Back to Process timesheet</Link>
          </p>
        </EmptyState>
      </Panel>,
    );
  }

  const { job, client, files, shifts } = detail;
  const step = stepFor(job.status, stepParam);
  const clientName = client?.name ?? 'No client';
  const fileNames = files.map((f) => f.fileName);

  const head = (
    <>
      <Stepper steps={STEPS.map((s) => ({ key: s.key, label: s.label }))} current={step.current} />
      <div className="pr-job-head">
        <span className="strong">{clientName}</span>
        <Pill tone={JOB_STATUS_TONE[job.status]}>{JOB_STATUS_LABEL[job.status]}</Pill>
        <span className="xs muted pr-job-files" title={fileNames.join(', ')}>
          {fileNames.length === 1 ? fileNames[0] : `${fileNames.length} files`}
        </span>
        <Link className="xs" href="/invoices/process">
          All jobs
        </Link>
      </div>
      {problem ? <Alert tone="coral">{problem}</Alert> : null}
    </>
  );

  switch (step.phase) {
    case 'processing':
      return shell(
        <>
          {head}
          <ProcessingView
            status={job.status === 'uploaded' ? 'uploaded' : 'extracting'}
            clientName={clientName}
            fileNames={fileNames}
            stalled={Date.now() - Date.parse(job.createdAt) > STALLED_MS}
          />
        </>,
      );
    case 'error':
      return shell(
        <>
          {head}
          <ErrorView jobId={job.id} error={job.error} canAct={canAct} />
        </>,
      );
    case 'review': {
      const [{ clients }, sources] = await Promise.all([
        loadTimesheetClients(),
        loadSources(files),
      ]);
      return shell(
        <>
          {head}
          <ReviewScreen
            jobId={job.id}
            client={client}
            clients={clients}
            initialRows={shifts}
            sources={sources}
            canAct={canAct}
          />
        </>,
      );
    }
    case 'confirm': {
      const vatRate = await loadVatRate();
      const rows = shifts.filter((s) => s.status === 'approved' && s.invoiceId === null);
      return shell(
        <>
          {head}
          {client ? (
            <ConfirmScreen
              jobId={job.id}
              client={client}
              rows={rows}
              vatRate={vatRate}
              today={todayInUk()}
              canAct={canAct}
            />
          ) : (
            <Alert tone="coral">This job has no client. Go back to review and choose one.</Alert>
          )}
        </>,
      );
    }
    case 'generate':
    case 'done': {
      const { invoices, problem: invoiceProblem } = await loadJobInvoices(job.id);
      const groups = job.confirmedGroups ?? [];
      const byShift = new Map(
        shifts.filter((s) => s.invoiceId).map((s) => [s.id, s.invoiceId as string]),
      );
      const pendingGroups = groups.length - issuedGroupIndexes(groups, byShift).size;
      return shell(
        <>
          {head}
          {invoiceProblem ? <Alert tone="coral">{invoiceProblem}</Alert> : null}
          <GenerateScreen
            jobId={job.id}
            status={job.status === 'complete' ? 'complete' : 'confirmed'}
            invoices={invoices}
            pendingGroups={job.status === 'complete' ? 0 : pendingGroups}
            canAct={canAct}
          />
        </>,
      );
    }
  }
}
