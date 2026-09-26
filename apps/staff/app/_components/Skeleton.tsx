import type { CSSProperties } from 'react';
import { AppFrame } from '@thc/ui';
import '../chrome.css';

/**
 * Loading placeholders for the Staff App's route `loading.tsx` files.
 *
 * The shell (header, nav) is drawn by each page's `StaffShell`, which is
 * itself behind the data it waits on, so the loading state is the body
 * alone: the same frame and gutters, grey shapes where the content will be.
 * Token colours only (`.skel` in chrome.css), and no pulse for anyone with
 * reduced motion on. One "Loading …" status for screen readers; the shapes
 * themselves are hidden from them.
 */
export function Skeleton({
  kind = 'line',
  width,
}: {
  kind?: 'line' | 'title' | 'block' | 'avatar';
  width?: CSSProperties['width'];
}) {
  return (
    <span
      className={`skel ${kind}`}
      aria-hidden="true"
      {...(width !== undefined ? { style: { width } } : {})}
    />
  );
}

function CardSkeleton() {
  return (
    <div className="skel-card" aria-hidden="true">
      <Skeleton kind="line" width="35%" />
      <Skeleton kind="title" width="70%" />
      <Skeleton kind="line" width="85%" />
      <Skeleton kind="line" width="55%" />
    </div>
  );
}

function RowsSkeleton({ rows }: { rows: number }) {
  return (
    <div className="skel-card" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div className="skel-row" key={i}>
          <div className="grow">
            <Skeleton kind="line" width="40%" />
            <Skeleton kind="line" width="70%" />
          </div>
        </div>
      ))}
    </div>
  );
}

export type BodySkeletonKind = 'cards' | 'radar' | 'profile' | 'documents';

/** The chrome-less page body a route shows while its server read runs. */
export function BodySkeleton({ kind, label }: { kind: BodySkeletonKind; label: string }) {
  return (
    <AppFrame>
      <main className="app-body skel-body" aria-busy="true">
        <span className="skel-sr" role="status">
          {label}
        </span>
        {kind === 'cards' ? (
          <>
            <Skeleton kind="title" />
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
          </>
        ) : null}
        {kind === 'radar' ? (
          <>
            <Skeleton kind="block" />
            <Skeleton kind="line" width="60%" />
            <CardSkeleton />
            <CardSkeleton />
          </>
        ) : null}
        {kind === 'profile' ? (
          <>
            <div className="skel-row" aria-hidden="true">
              <Skeleton kind="avatar" />
              <div className="grow">
                <Skeleton kind="title" width="70%" />
                <Skeleton kind="line" width="50%" />
              </div>
            </div>
            <RowsSkeleton rows={5} />
          </>
        ) : null}
        {kind === 'documents' ? (
          <>
            <Skeleton kind="line" width="50%" />
            <RowsSkeleton rows={4} />
            <Skeleton kind="line" width="40%" />
          </>
        ) : null}
      </main>
    </AppFrame>
  );
}
