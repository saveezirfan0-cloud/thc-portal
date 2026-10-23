'use client';

import { useEffect, useState } from 'react';
import { runningTimer } from '../tickets/actions';
import type { RunningTimer } from '../tickets/types';
import { RunningClock } from '../tickets/TicketTracking';
import { TIMER_CHANGED } from '../tickets/timerEvents';

/**
 * The top bar's running timer (ADR-0202): for the one login that tracks
 * time, "TK-12 · 00:12:30" with a link to the ticket, so a timer left
 * running is never out of sight. Nothing at all for anyone else — the
 * database answers `allowed: false` — and nothing while no timer runs.
 */
export function TimerChip() {
  const [timer, setTimer] = useState<RunningTimer | null>(null);

  useEffect(() => {
    let live = true;
    const read = () =>
      void runningTimer()
        .then((r) => live && setTimer(r.allowed ? r.timer : null))
        .catch(() => undefined);
    read();
    // Starting or stopping happens on another screen; look again now and then.
    const t = setInterval(read, 30000);
    window.addEventListener('focus', read);
    // The ticket screen announces a start or a stop, so the chip never lags.
    window.addEventListener(TIMER_CHANGED, read);
    return () => {
      live = false;
      clearInterval(t);
      window.removeEventListener('focus', read);
      window.removeEventListener(TIMER_CHANGED, read);
    };
  }, []);

  if (!timer) return null;
  return (
    <a className="tk-chip hide-phone" href={`/tickets/${timer.ticket_id}`} title={timer.title}>
      <span aria-hidden="true">⏱</span> TK-{timer.ticket_no} ·{' '}
      <RunningClock startedAt={timer.started_at} />
    </a>
  );
}
