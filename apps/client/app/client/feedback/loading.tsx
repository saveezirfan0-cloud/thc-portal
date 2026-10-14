import { Skeleton, SkeletonPanel, SkeletonScreen } from '@thc/ui';

/**
 * /client/feedback while the entries are read (ADR-0134 N4). This route has
 * no not-found of its own, so a route `loading.tsx` costs it nothing (the
 * event page's reason for having none, docs/08, does not apply here).
 */
export default function Loading() {
  return (
    <SkeletonScreen label="Loading your feedback">
      <div className="page-head">
        <Skeleton width="min(100%, 260px)" height="1.6em" />
      </div>
      <SkeletonPanel rows={5} lines={2} />
    </SkeletonScreen>
  );
}
