'use client';

import { ScheduledWindow as Shared } from '@thc/ui';

/**
 * A scheduled window on the /events screens (§1.8): UK time, plus a second
 * "your time" line when the reader is not in Europe/London.
 *
 * The component itself is `ScheduledWindow` in packages/ui, shared with the
 * dashboard and the reports; this keeps the /events conventions in one
 * place. `suffix` is for places whose column header does not already say
 * the zone (the event board writes "07:00 – 15:00 UK time · 8h"), and is
 * shown whenever given; `lineClass` is the second line's class in its
 * context (`sub` in a table, `l2` on the board); `separator` lets a dense
 * column drop the spaces ("17:00–23:30", the list's role lines).
 */
export function ScheduledWindow({
  startsAt,
  endsAt,
  suffix = '',
  separator,
  className,
  lineClass = 'sub',
}: {
  startsAt: string;
  endsAt: string;
  suffix?: string;
  separator?: string;
  className?: string;
  lineClass?: string;
}) {
  return (
    <Shared
      startsAt={startsAt}
      endsAt={endsAt}
      suffix={suffix}
      separator={separator}
      suffixWhen="always"
      className={className}
      lineClass={lineClass}
    />
  );
}
