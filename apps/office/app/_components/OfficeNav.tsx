'use client';

import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { MenuButton } from '@thc/ui';

/**
 * The Back Office menu on a phone (§1.2).
 *
 * Below 760px the sidebar leaves the grid and becomes a drawer that slides in
 * from the left, opened by the button at the start of the top bar. It used
 * to become a bottom strip of twelve labels scrolled sideways, which showed
 * three of them at a time and hid the sign-out with the rest of the foot.
 * The drawer is the same `<aside>` with the same links, brand and foot — one
 * nav, two presentations — so nothing about the destinations can drift.
 *
 * It closes on navigation, on Escape and on a tap outside, and holds the
 * page still while it is open.
 */
export const OFFICE_NAV_ID = 'office-nav';

interface NavState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const NavContext = createContext<NavState>({ open: false, setOpen: () => {} });

export function useOfficeNav(): NavState {
  return useContext(NavContext);
}

export function OfficeNavProvider({ children }: { children: ReactNode }) {
  const [open, setOpenState] = useState(false);
  const pathname = usePathname();
  const setOpen = useCallback((next: boolean) => setOpenState(next), []);

  useEffect(() => setOpenState(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenState(false);
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [open]);

  const value = useMemo(() => ({ open, setOpen }), [open, setOpen]);
  return (
    <NavContext.Provider value={value}>
      {children}
      {open ? (
        <div className="nav-scrim" aria-hidden="true" onClick={() => setOpen(false)} />
      ) : null}
    </NavContext.Provider>
  );
}

export function OfficeNavButton() {
  const { open, setOpen } = useOfficeNav();
  return <MenuButton open={open} controls={OFFICE_NAV_ID} onClick={() => setOpen(!open)} />;
}
