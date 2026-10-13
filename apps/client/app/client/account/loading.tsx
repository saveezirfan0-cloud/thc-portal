import { SkeletonPanel, SkeletonScreen } from '@thc/ui';

/** /client/account while the customer's details are read. */
export default function Loading() {
  return (
    <SkeletonScreen label="Loading your account">
      <SkeletonPanel rows={3} lines={2} />
      <SkeletonPanel rows={2} lines={1} />
    </SkeletonScreen>
  );
}
