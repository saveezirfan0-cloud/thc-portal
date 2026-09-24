import { Content, EmptyState } from '@thc/ui';

/**
 * The Back Office's route-level loading state (Next.js `loading.tsx`).
 *
 * Every screen reads live figures on the server (§9.1 "as of this minute"),
 * so a navigation can take a moment; without this the previous screen just
 * sits there looking current. No chrome: this also covers /login, where an
 * anonymous visitor must not see the admin sidebar, even briefly.
 */
export default function Loading() {
  return (
    <Content>
      <div role="status" aria-live="polite" aria-busy="true">
        <EmptyState>
          <h3>Loading…</h3>
          <div className="sm">Fetching the latest figures.</div>
        </EmptyState>
      </div>
    </Content>
  );
}
