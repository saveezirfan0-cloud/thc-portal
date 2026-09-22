import Link from 'next/link';
import type { ReactNode } from 'react';
import { AppBody, AppFrame, AppHeader, Avatar, BottomNav } from '@thc/ui';
import { reachableTabs, showsBottomNav } from '../lock';
import type { AppLock } from '../lock';

/**
 * Chrome for the profile screens (§10.1).
 *
 * Not `StaffShell`: these screens are reached from the avatar rather than
 * from a tab, so none of the four tabs is active, and the wireframe gives
 * them a collapsed header carrying a "‹ Profile" back link where the tab
 * screens carry a title. The primitives are the same ones — the frosted
 * header, body and bottom nav from packages/ui — so the two read as one
 * app.
 *
 * The nav it renders is lock-aware. §10.1's four cases differ precisely in
 * which tabs exist, and `reachableTabs()` is the single answer: an
 * auto-blocked worker keeps Documents and loses the other three; a
 * manually blocked worker, a rejected candidate and a leaver get no
 * navigation at all, because there is nothing behind it for them.
 */
export function ProfileShell({
  title,
  back,
  lock,
  name,
  photoUrl,
  children,
}: {
  title: ReactNode;
  /** The "‹ Profile" line above the title. Omitted on the sheet itself. */
  back?: { href: string; label: string };
  lock: AppLock;
  name: string;
  photoUrl?: string | null;
  children: ReactNode;
}) {
  const reachable = reachableTabs(lock);
  const tabs = [
    { href: '/documents', label: 'Documents' },
    { href: '/shifts', label: 'Shifts' },
    { href: '/invites', label: 'Invites' },
    { href: '/radar', label: 'Radar' },
  ].map((tab) => ({ ...tab, locked: !reachable.includes(tab.href) }));

  return (
    <AppFrame>
      <AppHeader
        collapsed={Boolean(back)}
        brand={<span className="logo round">🥂</span>}
        title={
          back ? (
            <>
              <Link className="xs cyan" href={back.href}>
                ‹ {back.label}
              </Link>
              <div>{title}</div>
            </>
          ) : (
            title
          )
        }
        actions={<Avatar name={name} {...(photoUrl ? { src: photoUrl } : {})} size="sm" />}
      />
      <AppBody>{children}</AppBody>
      {showsBottomNav(lock) ? (
        <BottomNav
          items={tabs}
          renderLink={(item, className, body) =>
            item.locked ? (
              <span className={className} aria-disabled="true">
                {body}
              </span>
            ) : (
              <Link href={item.href} className={className}>
                {body}
              </Link>
            )
          }
        />
      ) : null}
    </AppFrame>
  );
}
