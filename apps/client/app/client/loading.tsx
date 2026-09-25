import { Skeleton, SkeletonPanel, SkeletonScreen } from '@thc/ui';

/**
 * "Your events" while the line-ups are read. The portal's top bar is the
 * layout's, so only the page is drawn here: the heading and its filter,
 * then the list of events.
 */
export default function Loading() {
  return (
    <SkeletonScreen label="Loading your events">
      <div className="page-head" aria-hidden="true">
        <div className="stack tight" style={{ flex: 1 }}>
          <Skeleton width="min(60%, 240px)" height="1.6em" />
          <Skeleton width="min(80%, 320px)" />
        </div>
      </div>
      <Skeleton shape="block" width="min(100%, 360px)" />
      <SkeletonPanel rows={4} avatar lines={3} />
    </SkeletonScreen>
  );
}
