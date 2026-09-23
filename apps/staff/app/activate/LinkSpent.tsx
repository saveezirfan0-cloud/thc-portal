import Link from 'next/link';
import { Alert } from '@thc/ui';
import { EXPIRED_MESSAGE, HELP_EMAIL } from './copy';

/**
 * The spent / expired link — wireframes/public/activate.html ("This link is
 * personal to you and works once. Expired? Write to admin@…"). No "send me
 * a new one" here, unlike A3: an activation link is issued by the office
 * on Accept, so the office is who re-issues it.
 */
export function LinkSpent({ message }: { message?: string | null }) {
  return (
    <>
      <Alert tone="coral">{message ?? EXPIRED_MESSAGE}</Alert>
      <a className="btn primary block lg" href={`mailto:${HELP_EMAIL}?subject=Activation%20link`}>
        Write to {HELP_EMAIL}
      </a>
      <p className="sm muted" style={{ textAlign: 'center' }}>
        Already set your password? <Link href="/login">Sign in</Link>
      </p>
    </>
  );
}
