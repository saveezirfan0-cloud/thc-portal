'use client';

import { useEffect, useState } from 'react';
import { canReviewCriminalRecords } from './declarationActions';

/**
 * Whether the signed-in office user may decide a criminal declaration
 * (ADR-0180) — `null` until the answer arrives, then the database's
 * `can_review_criminal_records()`. One request per page load, shared by
 * every declaration on the screen; the buttons stay hidden until it says
 * yes, so a user who may not decide never sees one flash.
 */
let asked: Promise<boolean> | null = null;

export function useCriminalRecordsReviewer(): boolean | null {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    asked ??= canReviewCriminalRecords().catch(() => false);
    void asked.then((answer) => {
      if (live) setAllowed(answer);
    });
    return () => {
      live = false;
      // The next page load asks again: a permission changed on /users
      // applies on the next screen, as the database's check does.
      asked = null;
    };
  }, []);
  return allowed;
}
