import type { ReactNode } from 'react';
import { Avatar } from '@thc/ui';
import { appliedAgo } from '@thc/domain';
import type { BoardBooking } from '../board-data';
import type { UnavailableEntry } from '../board-model';

/** A board row's face and name, with its second line (§3.3). */
export function Person({
  person,
  sub,
}: {
  person: BoardBooking | UnavailableEntry;
  sub: ReactNode;
}) {
  return (
    <>
      <Avatar
        name={person.name}
        src={person.photoUrl ?? undefined}
        deleted={person.name.startsWith('Deleted account')}
      />
      <div className="who">
        <div className="n">{person.name}</div>
        <div className="s">{sub}</div>
      </div>
    </>
  );
}

/** "Applied 2h ago" (§3.3), computed on each render — never a snapshot. */
export function appliedMarker(booking: BoardBooking): string {
  return booking.appliedAt ? appliedAgo(new Date(booking.appliedAt)) : 'Applied';
}
