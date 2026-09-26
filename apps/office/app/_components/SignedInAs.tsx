'use client';

import Link from 'next/link';
import { createContext, useContext } from 'react';
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
const SignedInAsContext = createContext<OfficeUser | null>(null);

export function SignedInAsProvider({
  user,
  children,
}: {
  user: OfficeUser | null;
  children: ReactNode;
}) {
  return <SignedInAsContext.Provider value={user}>{children}</SignedInAsContext.Provider>;
}

/**
 * The signed-in operator for any client component under the root layout —
 * the menu reads the office role from here (ADR-0050). Null outside the
 * provider (the component tests) and when nobody is signed in.
 */
export function useOfficeUser(): OfficeUser | null {
  return useContext(SignedInAsContext);
}

/** The identity half of the foot. Renders nothing when nobody is signed in. */
export function SignedInAs() {
  const user = useContext(SignedInAsContext);
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
