'use client';

import Link from 'next/link';
import { createContext, use, useContext } from 'react';
import type { ReactNode } from 'react';
import { Avatar } from '@thc/ui';
import type { OfficeUser } from './officeUser';

/**
 * Who is signed in, for the sidebar foot
 * (`wireframes/backoffice/dashboard.html`: avatar, name, role).
 *
 * Context rather than a prop on `OfficeShell`, because the shell is rendered
 * from client components on seven screens as well as from fourteen server
 * pages. A prop would have to be threaded through all twenty-one, and the
 * one place someone forgot it would be a screen whose foot silently lost its
 * name. The root layout reads the operator once and provides it here, so
 * every screen gets the same answer without asking.
 *
 * The default is null, so a tree rendered outside the provider — the
 * component tests do exactly this — shows the foot without a name rather
 * than throwing.
 */
/**
 * The root layout hands over a PROMISE, not a value, so it can return at
 * once and the page below it can start its own reads in parallel rather
 * than after the profile lookup. Whoever reads the context resolves it with
 * `use()` inside a `<Suspense>` of its own (`OfficeShell` puts one around
 * the sidebar and the read-only banner). A plain value still works — the
 * component tests, and anything rendered outside the layout.
 */
export type OfficeUserSource = OfficeUser | null | Promise<OfficeUser | null>;

/**
 * A promise that crossed the server/client boundary is React's own thenable,
 * not necessarily a `Promise` instance, so ask for `.then` rather than the class.
 */
export function isThenable<T>(value: T | PromiseLike<T>): value is PromiseLike<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

const SignedInAsContext = createContext<OfficeUserSource>(null);

export function SignedInAsProvider({
  user,
  children,
}: {
  user: OfficeUserSource;
  children: ReactNode;
}) {
  return <SignedInAsContext.Provider value={user}>{children}</SignedInAsContext.Provider>;
}

/**
 * The signed-in operator for any client component under the root layout —
 * the menu reads the office role from here (ADR-0056). Null outside the
 * provider (the component tests) and when nobody is signed in.
 */
export function useOfficeUser(): OfficeUser | null {
  const source = useContext(SignedInAsContext);
  return isThenable(source) ? use(source) : source;
}

/** The identity half of the foot. Renders nothing when nobody is signed in. */
export function SignedInAs() {
  const user = useOfficeUser();
  if (!user) return null;

  return (
    <>
      <Avatar name={user.name} size="sm" />
      {/* The name opens the signed-in user's own profile (/account). */}
      <Link href="/account" className="signed-in-as" title="My profile">
        <div className="sm strong">{user.name}</div>
        {user.role ? <div className="xs muted">{user.role}</div> : null}
      </Link>
    </>
  );
}
