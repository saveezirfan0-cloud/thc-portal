'use client';

import Link from 'next/link';

/**
 * A worker's name on the §9.5 board: it opens their profile (§9.6). The
 * violation log's row opens its detail window on a click, so a press on the
 * link is the link's own and does not reach the row.
 *
 * No `staffId` (a row built elsewhere, or a late row whose booking could not
 * be read) leaves the name as text.
 */
export function StaffName({ staffId, name }: { staffId?: string; name: string }) {
  return staffId ? (
    <Link href={`/staff/${staffId}`} className="staff-link" onClick={(e) => e.stopPropagation()}>
      {name}
    </Link>
  ) : (
    <>{name}</>
  );
}
