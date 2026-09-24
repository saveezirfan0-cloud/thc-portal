import Link from 'next/link';
import { Content, EmptyState, PageHead } from '@thc/ui';

export const metadata = { title: 'Not found · THC Back Office' };

/**
 * The Back Office's 404 (Next.js `not-found.tsx`): an unknown URL, or a
 * screen that called `notFound()` for a record that does not exist or has
 * been removed (§1.7 keeps history rows, but not every link to them).
 */
export default function NotFound() {
  return (
    <Content>
      <PageHead title="Page not found" />
      <EmptyState>
        <h3>There is nothing at this address</h3>
        <div className="sm">
          The link may be out of date, or the record it pointed to no longer exists.
        </div>
      </EmptyState>
      <div className="row">
        <Link className="btn primary" href="/dashboard">
          Back to the dashboard
        </Link>
      </div>
    </Content>
  );
}
