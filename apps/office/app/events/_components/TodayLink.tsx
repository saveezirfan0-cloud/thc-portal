'use client';

import Link from 'next/link';
import { TODAY_ANCHOR } from '../calendar';

/**
 * The toolbar's Today (§3.1).
 *
 * Off today's period it is a plain link to it. On it — where /events opens,
 * so the usual case — a link to the same period changed nothing a manager
 * could see, and Today read as broken; so instead it scrolls today's cell,
 * column or row into view and flashes it once (`.landed`, events.css).
 */
export function TodayLink({ href, onToday }: { href: string; onToday: boolean }) {
  return (
    <Link
      className="btn sm"
      href={`${href}#${TODAY_ANCHOR}`}
      onClick={(event) => {
        if (!onToday) return;
        event.preventDefault();
        const target = document.getElementById(TODAY_ANCHOR);
        if (!target) return;
        const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        target.scrollIntoView({ block: 'start', behavior: still ? 'auto' : 'smooth' });
        // Off and on again, so a second click flashes again.
        target.classList.remove('landed');
        void target.offsetWidth;
        target.classList.add('landed');
      }}
    >
      Today
    </Link>
  );
}
