import { Suspense, cache } from 'react';
import { notFound } from 'next/navigation';
import { Alert } from '@thc/ui';
import { OfficeShell } from '../../_components/OfficeShell';
import { currentOfficeRole } from '../../_components/officeUser';
import { canCorrectLetters, canMarkInterviewComplete, officeCan } from '../../_lib/permissions';
import type { OfficeRole } from '../../_lib/permissions';
import { loadCandidate } from '../data';
import { loadCandidateHead } from '../head';
import { CandidateCrumbs, CandidateSkeleton } from '../chrome';
import { CandidateScreen } from '../CandidateScreen';
import '../onboarding.css';

export const metadata = { title: 'Candidate · THC Back Office' };
export const dynamic = 'force-dynamic';

/** The whole record, once per request: started by the page, read by the body. */
const candidateView = cache(loadCandidate);

/**
 * /onboarding/:id — the candidate profile by phase (§2.3),
 * `wireframes/backoffice/candidate.html` (BO4).
 *
 * A person who does not exist (or was removed under §1.7, which the view
 * excludes) is a 404. One who cannot be read is a message.
 *
 * Streaming (ADR-0161). The record is sixteen reads (`loadCandidate`); the
 * page starts them, waits only for one row of the same view, and answers
 * the 404 there, before anything streams. The shell and the name paint at
 * once; the record streams in behind a skeleton of its header. Nothing on
 * the screen navigates by query.
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Started now, so the record's reads run while the head is read below.
  // The body awaits the same promise; a failure is its to show.
  candidateView(id).catch(() => undefined);
  const [head, role] = await Promise.all([loadCandidateHead(id), currentOfficeRole()]);

  if (head.problem) {
    return (
      <OfficeShell activeHref="/onboarding" title="Candidate">
        <Alert tone="coral">{head.problem}</Alert>
      </OfficeShell>
    );
  }
  // Decided before the Suspense below, so the answer is a real 404.
  if (!head.candidate) notFound();

  return (
    <OfficeShell
      activeHref="/onboarding"
      title="Candidate"
      crumbs={<CandidateCrumbs name={head.candidate.display_name} />}
    >
      <Suspense fallback={<CandidateSkeleton />}>
        <Candidate id={id} role={role} />
      </Suspense>
    </OfficeShell>
  );
}

async function Candidate({ id, role }: { id: string; role: OfficeRole | null }) {
  const data = await candidateView(id);
  if (data.problem) return <Alert tone="coral">{data.problem}</Alert>;
  // Read a moment ago by the head; gone now (a removal in between).
  if (!data.candidate) {
    return (
      <Alert tone="coral">This candidate can no longer be found. Go back to the pipeline.</Alert>
    );
  }
  return (
    <CandidateScreen
      bare
      data={data}
      now={new Date().toISOString()}
      canCorrectDob={officeCan(role, 'identity')}
      canMarkInterview={canMarkInterviewComplete(role)}
      canCorrectLetters={canCorrectLetters(role)}
      canGrantQuizAttempts={officeCan(role, 'write')}
    />
  );
}
