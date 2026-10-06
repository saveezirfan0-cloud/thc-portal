'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Modal } from '@thc/ui';
import type { MonthCellModel } from '../view-model';
import { ChipStatus } from './ChipStatus';

const classes = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(' ');

/**
 * A month cell's events (ADR-0094): a few chips, same-named events collapsed
 * into one, and "+N more". A collapsed group and "+N more" both open a popup
 * that lists every event of the day at full size, so nothing scrolls inside a
 * cell and nothing needs a page change to read. A single event is still a
 * link to its board.
 */
export function MonthCellEvents({
  model,
  heading,
  dayHref,
}: {
  model: MonthCellModel;
  /** "Tue 13 October · 5 ev · 18 open", written on the server. */
  heading: string;
  /** The Day view of this date, offered from inside the popup. */
  dayHref: string | null;
}) {
  const [open, setOpen] = useState(false);
  const { chips, hiddenEvents, hiddenOpen, events } = model;

  return (
    <div className="scroll">
      {chips.map((chip) => {
        const className = classes(
          'evchip',
          chip.cancelled && 'cancelled',
          chip.ongoing && 'ongoing',
          chip.full && 'full',
        );
        const body = (
          <>
            <span className="t">{chip.startLabel}</span>
            {chip.label}
            {/* §3.2: the status pill appears on the calendar as on the list. */}
            {chip.status ? <ChipStatus status={chip.status} /> : null}
            {chip.fill ? <span className="f">{chip.fill}</span> : null}
          </>
        );
        return chip.href ? (
          <Link key={chip.key} className={className} href={chip.href} title={chip.tooltip}>
            {body}
          </Link>
        ) : (
          <button
            key={chip.key}
            type="button"
            className={className}
            title={chip.tooltip}
            aria-haspopup="dialog"
            onClick={() => setOpen(true)}
          >
            {body}
          </button>
        );
      })}
      {hiddenEvents > 0 ? (
        <button
          type="button"
          className="evmore"
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
        >
          +{hiddenEvents} more{hiddenOpen > 0 ? ` · ${hiddenOpen} open` : ''}
        </button>
      ) : null}

      <Modal
        open={open}
        title={heading}
        wide
        onClose={() => setOpen(false)}
        footer={
          <>
            {dayHref ? (
              <Link className="btn" href={dayHref}>
                Open day view
              </Link>
            ) : null}
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              Close
            </button>
          </>
        }
      >
        <div className="daypop">
          {events.map((event) => (
            <Link
              key={event.id}
              href={`/events/${event.id}`}
              className={classes(
                'wchip',
                event.status === 'cancelled' && 'cancelled',
                event.status === 'ongoing' && 'ongoing',
                event.status !== 'cancelled' && event.tone === 'green' && 'full',
              )}
            >
              <span className="w">
                {event.windowLabel}
                <ChipStatus status={event.status} />
                {event.fill ? <span className="f">{event.fill}</span> : null}
              </span>
              <span className="n">{event.title}</span>
              <span className="m">
                {event.clientName} · {event.venueName}
              </span>
            </Link>
          ))}
        </div>
      </Modal>
    </div>
  );
}
