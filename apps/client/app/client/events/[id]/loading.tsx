import { Skeleton, SkeletonPanel, SkeletonScreen, SkeletonText } from '@thc/ui';

/**
 * One event while it is read: the header card, then a role section of
 * faces. The top bar is the layout's and stays drawn.
 */
export default function Loading() {
  return (
    <SkeletonScreen label="Loading the event">
      <div className="ehead">
        <Skeleton width="min(100%, 320px)" height="1.6em" />
        <SkeletonText lines={2} />
      </div>
      <SkeletonPanel rows={4} avatar lines={2} />
    </SkeletonScreen>
  );
}
