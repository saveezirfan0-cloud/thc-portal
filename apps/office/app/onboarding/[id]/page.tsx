import { notFound } from 'next/navigation';
import { Alert } from '@thc/ui';
import { OfficeShell } from '../../_components/OfficeShell';
import { loadCandidate } from '../data';
import { CandidateScreen } from '../CandidateScreen';

export const metadata = { title: 'Candidate · THC Back Office' };
export const dynamic = 'force-dynamic';

/**
 * /onboarding/:id — the candidate profile by phase (§2.3),
 * `wireframes/backoffice/candidate.html` (BO4).
 *
 * A person who does not exist (or was removed under §1.7, which the view
 * excludes) is a 404. One who cannot be read is a message.
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await loadCandidate(id);

  if (data.problem) {
    return (
      <OfficeShell activeHref="/onboarding" title="Candidate">
        <Alert tone="coral">{data.problem}</Alert>
      </OfficeShell>
    );
  }
  if (!data.candidate) notFound();

  return <CandidateScreen data={data} now={new Date().toISOString()} />;
}
