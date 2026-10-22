'use client';

import Link from 'next/link';
import { formatPhone } from '../staff/[id]/additions';

/**
 * A worker's name and mobile on the §9.5 board: the name opens their profile
 * (§9.6), the number rings them. Both sit inside rows that open something
 * themselves (the violation log's row opens its detail window), so a press
 * here is the link's own and does not reach the row.
 *
 * No `staffId` (a row built elsewhere) leaves the name as text; no phone
 * leaves the line out — a removed worker's number is retired (§1.7).
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

export function StaffPhone({ phone }: { phone?: string | null }) {
  return phone ? (
    <div className="s mono">
      <a
        href={`tel:${phone.replace(/[^\d+]/g, '')}`}
        className="staff-phone"
        onClick={(e) => e.stopPropagation()}
      >
        {formatPhone(phone)}
      </a>
    </div>
  ) : null;
}
