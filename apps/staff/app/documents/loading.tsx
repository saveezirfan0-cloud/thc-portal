import { BodySkeleton } from '../_components/Skeleton';

/** While /documents's server read runs: the body alone, no chrome (Skeleton.tsx). */
export default function Loading() {
  return <BodySkeleton kind="documents" label="Loading your documents…" />;
}
