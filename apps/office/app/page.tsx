import { redirect } from 'next/navigation';

/**
 * The Back Office root.
 *
 * §9.1 is "the first screen after login", and it now exists at its own
 * route, so this redirects rather than standing in for it. `HOME_PATH.admin`
 * names the same screen; it is written out here so a change to the shared
 * table can never turn this root into a redirect to itself.
 */
export default function Page() {
  redirect('/dashboard');
}
