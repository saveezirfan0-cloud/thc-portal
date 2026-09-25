import { Alert } from '@thc/ui';
import { StaffShell } from '../_components/StaffShell';
import { loadRtwCheckLine } from '../_lib/rtwCheckLine';
import { DocumentsOnlyNotice } from '../_components/DocumentsLock';
import { DocumentsHub } from './_components/DocumentsHub';
import { PullToRefresh } from './_components/PullToRefresh';
import { loadDocuments, supabaseConfigured } from './data';
import { documentsGate } from './gate';
import { buildDocumentsView } from './model';
import '../staff-app.css';
import './documents.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Documents · THC Staff' };

/**
 * Documents — §10.4, §4.1–4.5, §10.7, `wireframes/staff/documents.html`.
 *
 * The one tab lock case 1 leaves open (§10.1): a worker blocked on an
 * expired document, or while a declaration is reviewed, lands here with the
 * reason at the top and the Upload beside the row that caused it. Every
 * other lock is the shell's to draw.
 */
const FLASH: Record<string, string> = {
  '1': 'Sent to the office for review. Nothing changes on your account until they verify it.',
  completion:
    'Completion letter received. Your weekly limit does not change until the office approves it.',
  optout: 'Opt-out signed. The office has been told.',
  'optout-cancel': 'Notice given. The 48-hour limit returns at the end of your notice period.',
};

export default async function Page({ searchParams }: { searchParams: Promise<{ sent?: string }> }) {
  const { sent } = await searchParams;
  const gate = await documentsGate();

  if (!supabaseConfigured()) {
    return (
      <StaffShell title="Documents" active="/documents">
        <Alert tone="coral">
          This environment has no Supabase project, so your documents cannot be read. See
          docs/04-setup-github-vercel-supabase.md.
        </Alert>
      </StaffShell>
    );
  }

  // The gov.uk check line (ADR-0025) beside the tab's own read; null on any
  // failure, and the share code row reads as it did without the job.
  const [data, rtwCheck] = gate.open
    ? await Promise.all([loadDocuments(), loadRtwCheckLine()])
    : [null, null];
  const view = data ? buildDocumentsView(data, rtwCheck) : null;
  const locked = gate.lock === 'documents';
  const updatedAt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date());

  return (
    <StaffShell title="Documents" active="/documents" ignoreLock={gate.ignoreLock}>
      {view ? (
        <DocumentsHub
          view={view}
          locked={locked}
          flash={sent ? (FLASH[sent] ?? null) : null}
          refresh={<PullToRefresh updatedAt={updatedAt} />}
          notice={
            locked && gate.profile ? (
              <DocumentsOnlyNotice
                blockers={gate.profile.blockers}
                blockKind={gate.profile.blockKind}
                onboarding={false}
              />
            ) : null
          }
        />
      ) : (
        <Alert tone="coral">
          We couldn’t load your documents. Pull down or reload to try again.
        </Alert>
      )}
    </StaffShell>
  );
}
