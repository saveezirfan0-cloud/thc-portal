'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  DEFAULT_TIME_FORMAT,
  TIME_FORMAT_COOKIE,
  TIME_FORMAT_COOKIE_MAX_AGE,
  clockLabel,
  parseClock,
} from '@thc/domain';
import type { TimeFormat } from '@thc/domain';
import { Input } from './Input';
import type { InputProps } from './Input';

/**
 * ADR-0085: which clock this person reads times on. 24-hour unless they
 * switched to 12-hour in their settings.
 *
 * The server reads the choice (cookie, else profile — `@thc/db/time-format`)
 * and gives it to the provider as a prop, so the first paint already has the
 * right clock and there is no flash. Components below ask `useTimeFormat()`,
 * the way they ask `useViewerZone()` for the zone.
 */
const TimeFormatContext = createContext<TimeFormat>(DEFAULT_TIME_FORMAT);

export function TimeFormatProvider({
  format,
  remember = false,
  children,
}: {
  format: TimeFormat;
  /**
   * The server found the choice on the profile because this device had no
   * cookie yet. A server component cannot set one, so it is written here,
   * once, and every later request reads it for free.
   */
  remember?: boolean;
  children: ReactNode;
}) {
  useEffect(() => {
    if (remember) writeTimeFormatCookie(format);
  }, [remember, format]);
  return <TimeFormatContext.Provider value={format}>{children}</TimeFormatContext.Provider>;
}

export function useTimeFormat(): TimeFormat {
  return useContext(TimeFormatContext);
}

function writeTimeFormatCookie(format: TimeFormat): void {
  try {
    const secure = location.protocol === 'https:' ? '; secure' : '';
    document.cookie = `${TIME_FORMAT_COOKIE}=${format}; path=/; max-age=${TIME_FORMAT_COOKIE_MAX_AGE}; samesite=lax${secure}`;
  } catch {
    /* cookies blocked — the page still reads the right clock from the profile */
  }
}

export interface TimeFieldProps extends Omit<
  InputProps,
  'value' | 'onChange' | 'type' | 'inputMode' | 'reveal'
> {
  /** "HH:MM" on the 24-hour clock — what the platform stores and posts — or "" for none. */
  value: string;
  /** Called with "HH:MM", or "" while what is typed is not (yet) a time. */
  onChange: (value: string) => void;
  /** Override the viewer's clock, for previews and tests. */
  format?: TimeFormat;
  /**
   * True while what is typed is text that is not a time. `onChange` reports
   * that as "" too, the same as an empty field, so a form that treats an
   * empty time as "not given" (or "now") must also ask this, or a typo
   * silently becomes "not given".
   */
  onInvalidChange?: (invalid: boolean) => void;
}

/**
 * A time the person TYPES, on the clock they chose (ADR-0085).
 *
 * It replaces the browser's `<input type="time">`, which a browser draws on
 * the DEVICE's clock — so on a 12-hour phone or laptop it showed "5:00 PM"
 * whatever the platform wanted, and no attribute can change that. This is a
 * plain text field with a forgiving reader (`parseClock`): "17:00", "1700",
 * "5pm" and "5:30 pm" all land as "HH:MM". Its value is always "HH:MM", in
 * both clocks, so nothing downstream (the UK-time rule §1.8, `ukInstant`,
 * the server actions) can tell which one the person prefers.
 *
 * What is typed is kept while the field has focus; on blur it is rewritten
 * as the clock's own label ("17:00" / "5:00 pm"), or flagged if it is not a
 * time. The numeric keypad opens on a 24-hour phone ("1700" is accepted); a
 * 12-hour person gets the full keyboard, for "pm".
 */
export function TimeField({
  value,
  onChange,
  format: override,
  hint,
  error,
  placeholder,
  onBlur,
  onInvalidChange,
  ...rest
}: TimeFieldProps) {
  const viewer = useTimeFormat();
  const format = override ?? viewer;
  // What the person has typed, while they are typing; null shows the stored value.
  const [draft, setDraft] = useState<string | null>(null);
  const [flagged, setFlagged] = useState(false);

  // A draft only stands while it still means `value`: if the form resets the
  // value from outside, the field shows the new value and forgets the stale
  // text and its error (adjusting state while rendering, React's own pattern
  // for state derived from a prop).
  const typing = draft !== null && (parseClock(draft) ?? '') === value;
  if (draft !== null && !typing) {
    setDraft(null);
    setFlagged(false);
  }
  const shown = typing ? draft : clockLabel(value, format);
  const invalid = typing && draft.trim() !== '' && parseClock(draft) === null;

  useEffect(() => {
    onInvalidChange?.(invalid);
  }, [invalid, onInvalidChange]);

  return (
    <Input
      {...rest}
      type="text"
      mono
      autoComplete="off"
      spellCheck={false}
      maxLength={8}
      inputMode={format === '24h' ? 'numeric' : 'text'}
      placeholder={placeholder ?? (format === '24h' ? 'HH:MM' : 'h:mm am/pm')}
      value={shown}
      hint={hint}
      error={
        error ??
        (flagged ? <>Enter a time like {format === '24h' ? '17:00' : '5:00 pm'}.</> : undefined)
      }
      onChange={(event) => {
        const raw = event.target.value;
        setDraft(raw);
        setFlagged(false);
        onChange(parseClock(raw) ?? '');
      }}
      onBlur={(event) => {
        if (draft !== null && draft.trim() !== '' && parseClock(draft) === null) {
          setFlagged(true);
        } else {
          setDraft(null);
        }
        onBlur?.(event);
      }}
    />
  );
}
