import { BodySkeleton } from '../_components/Skeleton';

/**
 * While a wizard step (or the hub) is read on the server. Each step's Continue
 * saves, then navigates: without this the button is live again before the
 * next step arrives, and a second tap looks needed (Skeleton.tsx).
 */
export default function Loading() {
  return <BodySkeleton kind="documents" label="Loading your onboarding…" />;
}
