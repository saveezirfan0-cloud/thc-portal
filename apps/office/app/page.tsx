import { redirect } from 'next/navigation';

/**
 * The Back Office root.
 *
 * §9.1 is "the first screen after login", and it now exists at its own
 * route, so this redirects rather than standing in for it. The redirect
 * stays because `HOME_PATH.admin` in `packages/db` still points here and
 * that file belongs to another domain: sending `/` somewhere real is this
 * app's job, not the shared package's.
 */
export default function Page() {
  redirect('/dashboard');
}
