import { loadBoard } from './data';
import { OnboardingBoard } from './OnboardingBoard';

export const metadata = { title: 'Onboarding · THC Back Office' };
export const dynamic = 'force-dynamic';

/**
 * /onboarding — the candidate pipeline (§2.2, §2.12),
 * `wireframes/backoffice/onboarding.html` (BO3).
 *
 * Read on the server; the toggle, search and role filter are the
 * client's. The reference instant for "N d in stage" is taken here once,
 * so the whole board is judged against the same moment.
 */
export default async function Page() {
  const data = await loadBoard();
  return <OnboardingBoard data={data} now={new Date().toISOString()} applyUrl={applyUrl()} />;
}

/**
 * The public /apply form lives on the Staff App, a different deployment, so
 * its origin is configuration (NEXT_PUBLIC_STAFF_URL) — the same guard as
 * `staffOrigin()` in ./actions.ts. Unset in production means no button,
 * not a button to 127.0.0.1 on the manager's own machine.
 */
function applyUrl(): string | null {
  const explicit = process.env['NEXT_PUBLIC_STAFF_URL'];
  if (explicit) return `${explicit.replace(/\/$/, '')}/apply`;
  if (process.env.NODE_ENV === 'production') return null;
  return 'http://127.0.0.1:3001/apply';
}
