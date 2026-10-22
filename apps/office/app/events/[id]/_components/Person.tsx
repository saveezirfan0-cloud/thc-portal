import type { ReactNode } from 'react';
import Link from 'next/link';
import { Avatar } from '@thc/ui';
import { appliedAgo } from '@thc/domain';
import { formatPhone } from '../../../staff/[id]/additions';
import type { BoardBooking } from '../board-data';
import type { UnavailableEntry } from '../board-model';

/**
 * A board row's face and name, with its second line (§3.3) and the worker's
 * phone. The face and the name open the worker's profile, so the office can
 * go from the event to the person without searching the directory.
 */
export function Person({
  person,
  sub,
}: {
  person: BoardBooking | UnavailableEntry;
  sub: ReactNode;
}) {
  return (
    <>
      <ProfileLink staffId={person.staffId} name={person.name} tabIndex={-1} aria-hidden>
        <Avatar
          name={person.name}
          src={person.photoUrl ?? undefined}
          deleted={person.name.startsWith('Deleted account')}
        />
      </ProfileLink>
      <div className="who">
        <div className="n">
          <ProfileLink staffId={person.staffId} name={person.name}>
            {person.name}
          </ProfileLink>
        </div>
        <div className="s">{sub}</div>
      </div>
      <PersonPhone phone={person.phone} />
    </>
  );
}

/**
 * The worker's mobile on a board row, a `tel:` link so the manager can ring
 * a late or unconfirmed worker without opening their profile. "—" for a
 * removed worker (§1.7) or none on record; nothing for a worker the read did
 * not name.
 */
export function PersonPhone({ phone }: { phone: string | null | undefined }) {
  if (phone === undefined) return null;
  return (
    <span className="board-phone mono sm">
      {phone ? (
        <a href={`tel:${phone.replace(/[^\d+]/g, '')}`}>{formatPhone(phone)}</a>
      ) : (
        <span className="muted" title="No phone number on record">
          —
        </span>
      )}
    </span>
  );
}

/** A link to a worker's profile in the staff directory. */
export function ProfileLink({
  staffId,
  name,
  children,
  ...rest
}: {
  staffId: string;
  name: string;
  children: ReactNode;
  tabIndex?: number;
  'aria-hidden'?: boolean;
}) {
  return (
    <Link
      href={`/staff/${staffId}`}
      className="person-link"
      title={`Open ${name}'s profile`}
      {...rest}
    >
      {children}
    </Link>
  );
}

/** "Applied 2h ago" (§3.3), computed on each render — never a snapshot. */
export function appliedMarker(booking: BoardBooking): string {
  return booking.appliedAt ? appliedAgo(new Date(booking.appliedAt)) : 'Applied';
}
