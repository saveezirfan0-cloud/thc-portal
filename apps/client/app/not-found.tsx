import Link from 'next/link';
import { AuthCard } from '@thc/ui';

export const metadata = { title: 'Not found · THC Client Portal' };

/**
 * The Client Portal's 404 (Next.js `not-found.tsx`): an unknown URL, or an
 * event page that called `notFound()` because the event is not this
 * client's or is not visible to the portal (`client_portal_visible()`).
 * Deliberately the same answer for both: "not yours" and "does not exist"
 * must not be told apart, or the page confirms another client's event ids.
 */
export default function NotFound() {
  return (
    <AuthCard product="Client Portal" heading="Page not found">
      <p className="muted">
        There is nothing at this address. The link may be out of date, or the event is no longer
        shown in the portal.
      </p>
      <div className="row">
        <Link className="btn primary" href="/client">
          Back to your events
        </Link>
      </div>
    </AuthCard>
  );
}
