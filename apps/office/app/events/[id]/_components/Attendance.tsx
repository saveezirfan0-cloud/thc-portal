'use client';

import Link from 'next/link';
import { Pill } from '@thc/ui';
import { formatTimeIn } from '@thc/domain';
import { type BookingAttendance, attendancePills } from '../board-model';
import { useViewerZone } from '../../_components/useViewerZone';

/**
 * A Confirmed row's attendance — the wireframe's "in 18:52 · out 01:34"
 * stamp and its On shift / Checked out / Late / Left early / No check-out
 * pills (§3.3, §5, §9.5).
 *
 * Actual check-in and check-out stamps show in the VIEWER's zone only
 * (§1.8), which the server cannot know: the first paint is UK and the
 * browser's zone takes over once mounted (`useViewerZone`).
 */
export function AttendanceStamp({ attendance }: { attendance: BookingAttendance }) {
  const zone = useViewerZone();
  if (!attendance.checkInAt) return null;
  const at = (iso: string) => formatTimeIn(new Date(iso), zone);
  return (
    <span className="stamp">
      in <b>{at(attendance.checkInAt)}</b>
      {attendance.checkOutAt || attendance.noCheckout ? (
        <>
          {' '}
          · out <b>{attendance.checkOutAt ? at(attendance.checkOutAt) : '—'}</b>
        </>
      ) : null}
    </span>
  );
}

export function AttendancePills({ attendance }: { attendance: BookingAttendance }) {
  const zone = useViewerZone();
  return (
    <>
      {attendancePills(attendance).map((pill) => (
        <span key={pill.kind} className="row" style={{ gap: 6 }}>
          <Pill tone={pill.tone}>
            {pill.label}
            {pill.at ? ` ${formatTimeIn(new Date(pill.at), zone)}` : ''}
          </Pill>
          {pill.href ? (
            <Link className="btn sm outline" href={pill.href}>
              Resolve in Violation log
            </Link>
          ) : null}
        </span>
      ))}
    </>
  );
}
