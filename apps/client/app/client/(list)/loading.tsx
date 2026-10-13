import { Skeleton, SkeletonPanel, SkeletonScreen, SkeletonToolbar } from '@thc/ui';

/**
 * /client while the event list is read: the page head, the filters and a
 * list of rows with faces. The top bar is the layout's and stays drawn.
 */
export default function Loading() {
  return (
    <SkeletonScreen label="Loading your events">
      <div className="page-head">
        <Skeleton width="min(100%, 220px)" height="1.6em" />
        <Skeleton shape="pill" width={240} />
      </div>
      <SkeletonToolbar controls={2} />
      <SkeletonPanel rows={5} avatar lines={2} />
    </SkeletonScreen>
  );
}
