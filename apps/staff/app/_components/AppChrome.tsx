'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { AppHeader, Avatar, Logo, useCollapsedHeader } from '@thc/ui';

/**
 * The Staff App's top bar — §10.1, wireframes/staff/profile.html.
 *
 * Frosted, and collapsing: on scroll the title shrinks while the logo
 * stays left and the profile avatar stays right, so the way out of any
 * screen is always in the same place. `useCollapsedHeader` is the shared
 * scroll listener, and the state has to live in a client component, which
 * is why the header sits here rather than in the server shell.
 *
 * The avatar opens the profile (§10.1). Since ADR-0035 the Profile tab
 * does too — the tabs are Shifts · Invites · Radar · Profile, with
 * Documents inside Profile — and the avatar stays because §10.1 and every
 * worker's habit put it there. It LINKS to /profile rather than opening a
 * sheet of its own: one profile screen, reached two ways, cannot drift.
 */
export interface ChromeWorker {
  name: string;
  photoUrl: string | null;
}

export function AppChrome({
  title,
  sub,
  below,
  worker,
}: {
  title: ReactNode;
  sub?: ReactNode;
  below?: ReactNode;
  worker: ChromeWorker | null;
}) {
  const collapsed = useCollapsedHeader();

  return (
    <AppHeader
      title={title}
      {...(sub ? { sub } : {})}
      collapsed={collapsed}
      brand={<Logo size="sm" label="The Hospitality Company" />}
      {...(below ? { below } : {})}
      actions={
        worker ? (
          <Link href="/profile" className="avatar-btn" aria-label="Your profile">
            <Avatar
              name={worker.name}
              {...(worker.photoUrl ? { src: worker.photoUrl } : {})}
              className="photo"
            />
          </Link>
        ) : null
      }
    />
  );
}
