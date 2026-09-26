import Link from 'next/link';
import { Alert } from '@thc/ui';
import { StaffShell } from '../_components/StaffShell';
import { DocumentsOnlyNotice } from '../_components/DocumentsLock';
import { DocumentsHub } from './_components/DocumentsHub';
import { PullToRefresh } from './_components/PullToRefresh';
import { RefreshWhileChecking } from '../_components/RefreshWhileChecking';
import { loadMyRtwChecks } from '../_lib/rtwCheck';
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
 * The one screen lock case 1 leaves open (§10.1): a worker blocked on an
 * expired document, or while a declaration is reviewed, lands here with the
 * reason at the top and the Upload beside the row that caused it. Every
 * other lock is the shell's to draw.
 *
 * It lives under the Profile tab (ADR-0041) — hence "‹ Profile" above the
 * title and Profile lit in the nav — but keeps its own URL, because every
 * §8 deep link about a document points here.
 */
const HEADING = (
  <>
    <Link className="back-link" href="/profile">
      ‹ Profile
    </Link>
    Documents
  </>
);

const FLASH: Record<string, string> = {
  '1': 'Sent to the office for review. Nothing changes on your account until they verify it.',
  // A share code filed while the automated check is on (ADR-0025).
  share: 'Checking your share code with gov.uk. The result appears here in a minute or two.',
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
      <StaffShell title={HEADING} active="/profile">
        <Alert tone="coral">
          This environment has no Supabase project, so your documents cannot be read. See
          docs/04-setup-github-vercel-supabase.md.
        </Alert>
      </StaffShell>
    );
  }

  const [loaded, rtwChecks] = gate.open
    ? await Promise.all([loadDocuments(), loadMyRtwChecks()])
    : [null, {}];
  const data = loaded ? { ...loaded, rtwChecks } : null;
  const view = data ? buildDocumentsView(data) : null;
  const locked = gate.lock === 'documents';
  // The instant of this read; PullToRefresh words it in the phone's own
  // zone (§1.8: an actual stamp is viewer-local only).
  const updatedAt = new Date().toISOString();

  return (
    <StaffShell title={HEADING} active="/profile" ignoreLock={gate.ignoreLock}>
      <RefreshWhileChecking active={view?.checking ?? false} />
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
