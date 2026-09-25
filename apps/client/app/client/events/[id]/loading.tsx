import { Skeleton, SkeletonPanel, SkeletonScreen } from '@thc/ui';

/**
 * One event while its line-up is read: the title and download, the facts,
 * then a panel per role with its people.
 */
export default function Loading() {
  return (
    <SkeletonScreen label="Loading the event">
      <div className="stack tight" aria-hidden="true">
        <Skeleton width="min(70%, 360px)" height="1.8em" />
        <Skeleton width="min(50%, 240px)" />
      </div>
      <Skeleton shape="block" width="min(100%, 320px)" />
      <SkeletonPanel rows={4} avatar />
      <SkeletonPanel rows={2} avatar />
    </SkeletonScreen>
  );
}
