import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Alert } from '@thc/ui';
import { LoadProblem } from '../../_components/LoadProblem';
import { StaffShell } from '../../_components/StaffShell';
import { loadBookings, openInvites, shiftsBadge } from '../../data';
import { readProfile } from '../../profile/data';
import { ClientQuiz } from './ClientQuiz';
import { loadClientQuiz } from './data';
import '../../staff-app.css';
import '../../onboarding/onboarding.css';
import './quiz.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Quiz · THC Staff' };

/**
 * `/quiz/:id` — a client's quiz before the worker's first shift on one of
 * its roles (ADR-0109). Reached from the /shifts card, the shift screen,
 * and the CR1 push.
 *
 * Rendered through `StaffShell`, so the §10.1 app lock stands in front of
 * it as it does for every working screen. The material and the questions
 * come from `staff_client_quiz()`, which answers only for a quiz one of
 * the caller's own bookings names: anyone else's id is a 404.
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const back = <Link href="/shifts">‹ Shifts</Link>;

  const [{ quiz, problem, notFound: missing }, { rows: bookings, problem: listProblem }, me] =
    await Promise.all([loadClientQuiz(id), loadBookings(), readProfile()]);

  if (problem) {
    return (
      <StaffShell title="Quiz" sub={back} active="/shifts">
        <LoadProblem what="this quiz" />
      </StaffShell>
    );
  }
  if (missing || !quiz) {
    if (missing) notFound();
    return (
      <StaffShell title="Quiz" sub={back} active="/shifts">
        <Alert tone="coral">
          This environment has no Supabase project, so the quiz cannot be read. See
          docs/04-setup-github-vercel-supabase.md.
        </Alert>
      </StaffShell>
    );
  }

  return (
    <StaffShell
      title={quiz.title}
      sub={back}
      active="/shifts"
      {...(listProblem
        ? {}
        : { shifts: shiftsBadge(bookings), invites: openInvites(bookings).length })}
    >
      <ClientQuiz quiz={quiz} firstName={me.kind === 'ok' ? me.profile.firstName || null : null} />
    </StaffShell>
  );
}
