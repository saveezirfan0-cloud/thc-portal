'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { MenuButton } from '@thc/ui';

/**
 * The right-hand end of the portal's top bar.
 *
 * On a desktop its contents sit in the bar as they always have: who is
 * signed in, the appearance switch, sign out. On a phone they did not fit —
 * the bar wrapped into three ragged rows — so below 760px they fold behind a
 * menu button into a panel under the bar. Same elements either way; only the
 * presentation changes, so nothing is dropped (§1.2) and there is one
 * appearance switch, not two that could disagree.
 */
const MENU_ID = 'client-account';

export function AccountMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <MenuButton
        open={open}
        controls={MENU_ID}
        label="Account menu"
        onClick={() => setOpen(!open)}
      />
      <div id={MENU_ID} className={open ? 'ctop-menu open' : 'ctop-menu'}>
        {children}
      </div>
      {open ? (
        <div className="nav-scrim" aria-hidden="true" onClick={() => setOpen(false)} />
      ) : null}
    </>
  );
}
