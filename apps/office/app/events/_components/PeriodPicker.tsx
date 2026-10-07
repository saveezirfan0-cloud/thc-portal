'use client';

import { useRouter } from 'next/navigation';
import { useRef } from 'react';
import { type EventQuery, eventsHref, isIsoDate } from '../_lib/filters';

/**
 * The period label between the arrows, as a date picker (ADR-0104).
 *
 * The arrows step one day, week or month; a manager who wants "Thu 15 Oct"
 * or "March" had to click there. The label now opens the browser's own date
 * picker, the same `<input type="date">` the Shift Builder uses, and the
 * chosen day becomes the period's anchor: the Day view opens on it, the
 * Week view on its week, the Month view and the List on its month.
 *
 * The label stays a button with the label's own text, so it reads as the
 * period it names; the input is only the picker's anchor, visually hidden
 * and out of the tab order, because the button is the control. Navigating
 * is `router.push` to the same `eventsHref` every other control uses, so the
 * result is a link a manager can bookmark and the back button undoes it.
 */
export function PeriodPicker({ query, label }: { query: EventQuery; label: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);

  function open() {
    const field = input.current;
    if (!field) return;
    try {
      field.showPicker();
    } catch {
      // No showPicker (older Safari) or no user gesture: focusing and
      // clicking the input is the fallback that still opens it.
      field.focus();
      field.click();
    }
  }

  return (
    <>
      <button
        type="button"
        className="lbl period-pick"
        aria-haspopup="dialog"
        title="Choose a date"
        aria-label={`${label} — choose a date`}
        onClick={open}
      >
        {label}
      </button>
      <input
        ref={input}
        type="date"
        className="period-pick-input"
        value={query.date}
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const date = event.target.value;
          // Clearing the field gives '' — not a date, so stay where we are.
          if (!isIsoDate(date) || date === query.date) return;
          router.push(eventsHref({ ...query, date }));
        }}
      />
    </>
  );
}
