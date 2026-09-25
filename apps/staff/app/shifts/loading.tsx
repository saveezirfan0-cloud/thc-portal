import { BodySkeleton } from '../_components/Skeleton';

/** While /shifts's server read runs: the body alone, no chrome (Skeleton.tsx). */
export default function Loading() {
  return <BodySkeleton kind="cards" label="Loading your shifts…" />;
}
