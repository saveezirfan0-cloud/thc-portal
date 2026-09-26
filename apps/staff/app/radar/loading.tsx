import { BodySkeleton } from '../_components/Skeleton';

/** While /radar's server read runs: the body alone, no chrome (Skeleton.tsx). */
export default function Loading() {
  return <BodySkeleton kind="radar" label="Loading shifts near you…" />;
}
