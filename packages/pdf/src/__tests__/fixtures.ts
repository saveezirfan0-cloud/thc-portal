/**
 * The Gala Dinner from `wireframes/client/timesheet.html` and
 * `wireframes/CONVENTIONS.md`: Leonardo Hotel St Pauls, Fri 19 Sep 2026,
 * PO 4471-A; Chef 07:00–15:00, Kitchen Porter 09:00–17:00, Waiting Staff
 * 17:00–23:30 (UK time — BST, so an hour ahead of the ISO stamps below).
 */
import type { SheetEvent, SheetPerson } from '../sheet.ts';

export const GALA: SheetEvent = {
  title: 'Gala Dinner',
  clientName: 'Leonardo Hotel St Pauls',
  eventDate: '2026-09-19',
  poNumber: '4471-A',
};

const CHEF = {
  roleName: 'Chef',
  sectionId: 'chef',
  startsAt: '2026-09-19T06:00:00Z',
  endsAt: '2026-09-19T14:00:00Z',
};
const KP = {
  roleName: 'Kitchen Porter',
  sectionId: 'kp',
  startsAt: '2026-09-19T08:00:00Z',
  endsAt: '2026-09-19T16:00:00Z',
};
const WAIT = {
  roleName: 'Waiting Staff',
  sectionId: 'wait',
  startsAt: '2026-09-19T16:00:00Z',
  endsAt: '2026-09-19T22:30:00Z',
};

let seq = 0;
function person(
  section: typeof CHEF,
  firstName: string,
  surname: string,
  employeeId: number,
  extra: Partial<SheetPerson> = {},
): SheetPerson {
  seq += 1;
  return {
    bookingId: `b-${String(seq).padStart(3, '0')}`,
    employeeId,
    name: `${firstName} ${surname}`,
    firstName,
    surname,
    removed: false,
    photoPath: `${employeeId}/selfie.jpg`,
    ...section,
    finishAt: null,
    workedMin: null,
    status: 'scheduled',
    breakMin: 0,
    ...extra,
  };
}

/** Deliberately NOT in sheet order, so the tests prove the ordering. */
export function galaPeople(waitingCount: number): SheetPerson[] {
  seq = 0;
  const waiting = [
    ['Yusuf', 'Yilmaz', 602],
    ['Ben', 'Ashworth', 521],
    ['Priya', 'Sharma', 318],
    ['Chloe', 'Baptiste', 498],
    ['Olivia', 'Nguyen', 571],
    ['Ravi', 'Chandra', 533],
    ['Isla', 'Thornton', 588],
    ['Emily', 'Dawson', 477],
    ['Hugo', 'Ferreira', 540],
    ['Nadia', 'Haddad', 556],
    ['Amara', 'Kalu', 290],
    ['Marcus', 'Bell', 811],
    ['Chen', 'Wei', 960],
    ['Femi', 'Adeyemi', 988],
    ['Lin', 'Ng', 991],
    ['Sofia', 'Rossi', 612],
    ['Jonah', 'Walsh', 633],
    ['Maya', 'Patel', 644],
    ['Oscar', 'Lund', 655],
    ['Zara', 'Khan', 666],
    ['Leo', 'Martin', 677],
    ['Ada', 'Okoro', 688],
  ] as const;
  return [
    ...waiting.slice(0, waitingCount).map(([f, l, id]) => person(WAIT, f, l, id)),
    person(KP, 'Tom', 'Reid', 231),
    person(CHEF, 'Luca', 'Moretti', 412),
    person(KP, 'Aisha', 'Bello', 467),
    person(CHEF, 'Daniel', 'Okafor', 388),
    person(KP, 'Mateusz', 'Nowak', 505),
  ];
}

/** "Deleted account #1042" — anonymised by event_document_data (§1.7). */
export function removedWaiter(): SheetPerson {
  return {
    ...person(WAIT, '', '', 463),
    name: 'Deleted account #1042',
    firstName: null,
    surname: null,
    removed: true,
    photoPath: null,
  };
}

/** The one-page sign-out: the wireframe's Chef + Kitchen Porter rows, filled. */
export function signOutPeople(): SheetPerson[] {
  seq = 100;
  return [
    person(CHEF, 'Luca', 'Moretti', 412, {
      status: 'settled',
      finishAt: '2026-09-19T14:05:00Z',
      workedMin: 450,
      breakMin: 30,
    }),
    person(CHEF, 'Daniel', 'Okafor', 388, {
      status: 'settled',
      finishAt: '2026-09-19T13:40:00Z',
      workedMin: 430,
      breakMin: 30,
    }),
    person(KP, 'Aisha', 'Bello', 467, {
      status: 'settled',
      finishAt: '2026-09-19T16:10:00Z',
      workedMin: 460,
      breakMin: 20,
    }),
    // RULE-02: unresolved No check-out → blank Finish and Hours.
    person(KP, 'Tom', 'Reid', 231, { status: 'pending', breakMin: 20 }),
    person(KP, 'Mateusz', 'Nowak', 505, {
      status: 'no_show',
    }),
  ];
}
