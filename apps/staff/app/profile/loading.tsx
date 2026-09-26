import { BodySkeleton } from '../_components/Skeleton';

/** While /profile's server read runs: the body alone, no chrome (Skeleton.tsx). */
export default function Loading() {
  return <BodySkeleton kind="profile" label="Loading your profile…" />;
}
