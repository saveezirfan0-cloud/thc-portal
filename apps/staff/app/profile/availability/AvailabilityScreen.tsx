'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Alert,
  Button,
  EmptyState,
  Input,
  Modal,
  Pill,
  SegToggle,
  Sheet,
  Switch,
  Toast,
} from '@thc/ui';
import { ShiftTime, yourTimeLine } from '../../_components/ShiftTime';
import { useViewerZone } from '../../_components/useViewerZone';
import { addUnavailability, removeUnavailability } from './actions';
import type { ConflictWire } from './actions';
import {
  CONFLICT_COPY,
  EMPTY_COPY,
  INTRO_COPY,
  MAX_REPEAT_WEEKS,
  addSheetYourTime,
  entrySub,
  entryTitle,
  groupByWeek,
  remainingInSeries,
  repeatHint,
  saveLabel,
  toInput,
  ukTodayIso,
} from './model';
import type { AddForm, UnavailabilityEntry } from './model';

/** An entry as the server page hands it over: instants as ISO strings. */
export type EntryWire = Omit<UnavailabilityEntry, 'startsAt' | 'endsAt'> & {
  startsAt: string;
  endsAt: string;
};

/**
 * Availability — `wireframes/staff/availability.html` (ADR-0042).
 *
 * The list by week, the Add sheet, the warning when a new entry lands on a
 * confirmed shift, and Delete (one, or the rest of a series). Times are
 * typed and shown in UK time with a "your time" line when the phone is
 * elsewhere (§1.8). Nothing on this screen ever cancels a booking: the
 * warning says so, and points at the shift.
 */
export function AvailabilityScreen({ entries: wire }: { entries: EntryWire[] }) {
  const router = useRouter();
  const zone = useViewerZone();
  const entries = useMemo<UnavailabilityEntry[]>(
    () => wire.map((e) => ({ ...e, startsAt: new Date(e.startsAt), endsAt: new Date(e.endsAt) })),
    [wire],
  );
  const groups = groupByWeek(entries);

  const [adding, setAdding] = useState(false);
  const [conflicts, setConflicts] = useState<ConflictWire[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<UnavailabilityEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function remove(entry: UnavailabilityEntry, wholeSeries: boolean) {
    setError(null);
    start(async () => {
      const result = await removeUnavailability(entry.id, wholeSeries);
      setDeleting(null);
      if (!result.ok) setError(result.message);
      else {
        setToast(result.removed > 1 ? `${result.removed} entries deleted` : 'Entry deleted');
        router.refresh();
      }
    });
  }

  return (
    <div className="avail">
      {conflicts.length > 0 ? (
        <div className="avail-conf" role="alert">
          <b>
            {conflicts.length === 1
              ? 'You’re booked on a shift at this time'
              : 'You’re booked on shifts at these times'}
          </b>
          {conflicts.map((c) => (
            <div className="mcard" key={c.bookingId}>
              <div className="h">
                <Pill tone="green">Confirmed</Pill>
                <span className="ml-auto sm">
                  <ShiftTime
                    startsAt={new Date(c.startsAt)}
                    endsAt={new Date(c.endsAt)}
                    withDate
                    withMonth
                  />
                </span>
              </div>
              <div className="t">
                {c.event} · {c.role}
              </div>
              <div className="m">{c.venue}</div>
              <Link className="btn outline sm" href={`/shifts/${c.bookingId}`}>
                Open the shift
              </Link>
            </div>
          ))}
          <div>{CONFLICT_COPY}</div>
        </div>
      ) : null}

      {entries.length > 0 ? <p className="sm muted">{INTRO_COPY}</p> : null}

      {entries.length === 0 ? (
        <EmptyState>
          <h3>No days marked</h3>
          {EMPTY_COPY}
        </EmptyState>
      ) : null}

      <Button tone="primary" block onClick={() => setAdding(true)}>
        + Add days you can’t work
      </Button>

      {error ? <Alert tone="coral">{error}</Alert> : null}

      {groups.map((group) => (
        <section key={group.weekOf} className="avail-week" aria-label={group.label}>
          <div className="avail-grp">{group.label}</div>
          {group.entries.map((entry) => {
            const second = entry.allDay ? null : yourTimeLine(entry.startsAt, entry.endsAt, zone);
            return (
              <div className="avail-row" key={entry.id}>
                <div className="avail-copy">
                  <div className="t">
                    {entryTitle(entry)}
                    {entry.allDay ? null : <span className="xs muted"> UK time</span>}
                  </div>
                  {second ? <div className="xs muted mono">{second}</div> : null}
                  <div className="s">{entrySub(entry, entries)}</div>
                </div>
                <Button
                  tone="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => setDeleting(entry)}
                  aria-label={`Delete ${entryTitle(entry)}`}
                >
                  Delete
                </Button>
              </div>
            );
          })}
        </section>
      ))}

      {toast ? <Toast tone="green">{toast}</Toast> : null}

      <AddSheet
        open={adding}
        zone={zone}
        onClose={() => setAdding(false)}
        onSaved={(saved, found) => {
          setAdding(false);
          setConflicts(found);
          setToast(saved > 1 ? `${saved} entries saved` : 'Saved');
          router.refresh();
        }}
      />

      <DeleteDialog
        entry={deleting}
        count={deleting ? remainingInSeries(deleting, entries) : 0}
        pending={pending}
        onClose={() => setDeleting(null)}
        onDelete={remove}
      />
    </div>
  );
}

function blankForm(): AddForm {
  const today = ukTodayIso();
  return {
    mode: 'day',
    fromDate: today,
    toDate: today,
    allDay: true,
    fromTime: '18:00',
    toTime: '23:00',
    repeatWeeks: 0,
  };
}

/** The Add sheet — "Days you can't work". */
function AddSheet({
  open,
  zone,
  onClose,
  onSaved,
}: {
  open: boolean;
  zone: string;
  onClose: () => void;
  onSaved: (saved: number, conflicts: ConflictWire[]) => void;
}) {
  const [form, setForm] = useState<AddForm>(blankForm);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = <K extends keyof AddForm>(key: K, value: AddForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));
  const yourTime = addSheetYourTime(form, zone);
  const today = ukTodayIso();

  function save() {
    setError(null);
    start(async () => {
      const result = await addUnavailability(toInput(form));
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setForm(blankForm());
      onSaved(result.saved, result.conflicts);
    });
  }

  return (
    <Sheet open={open} onClose={onClose} label="Days you can't work">
      <div className="sheet-title">Days you can’t work</div>
      <SegToggle<AddForm['mode']>
        block
        options={[
          { value: 'day', label: 'One day' },
          { value: 'range', label: 'Date range' },
        ]}
        value={form.mode}
        onChange={(mode) => set('mode', mode)}
        aria-label="One day or a date range"
      />
      {form.mode === 'day' ? (
        <Input
          label="Date"
          type="date"
          min={today}
          value={form.fromDate}
          onChange={(event) => set('fromDate', event.target.value)}
        />
      ) : (
        <div className="row avail-pair">
          <Input
            label="From"
            type="date"
            min={today}
            value={form.fromDate}
            onChange={(event) => set('fromDate', event.target.value)}
          />
          <Input
            label="To"
            type="date"
            min={form.fromDate || today}
            value={form.toDate}
            onChange={(event) => set('toDate', event.target.value)}
          />
        </div>
      )}
      <Switch checked={form.allDay} onChange={(on) => set('allDay', on)} label="All day" />
      {form.allDay ? null : (
        <>
          <div className="row avail-pair">
            <Input
              label="From (UK time)"
              type="time"
              mono
              value={form.fromTime}
              onChange={(event) => set('fromTime', event.target.value)}
            />
            <Input
              label="To (UK time)"
              type="time"
              mono
              value={form.toTime}
              onChange={(event) => set('toTime', event.target.value)}
            />
          </div>
          {yourTime ? <div className="xs muted mono">{yourTime}</div> : null}
        </>
      )}
      <Input
        label="Repeat weekly for · weeks"
        type="number"
        inputMode="numeric"
        mono
        min={0}
        max={MAX_REPEAT_WEEKS}
        value={String(form.repeatWeeks)}
        onChange={(event) => set('repeatWeeks', Number(event.target.value || 0))}
        hint={repeatHint(form)}
      />
      {error ? <Alert tone="coral">{error}</Alert> : null}
      <Button tone="primary" size="lg" block disabled={pending} onClick={save}>
        {pending ? 'Saving…' : saveLabel(form)}
      </Button>
      <Button tone="ghost" block disabled={pending} onClick={onClose}>
        Cancel
      </Button>
    </Sheet>
  );
}

/** "Delete this entry?" — one, or every remaining week of a series. */
function DeleteDialog({
  entry,
  count,
  pending,
  onClose,
  onDelete,
}: {
  entry: UnavailabilityEntry | null;
  count: number;
  pending: boolean;
  onClose: () => void;
  onDelete: (entry: UnavailabilityEntry, wholeSeries: boolean) => void;
}) {
  if (!entry) return null;
  const title = `${entryTitle(entry)}${entry.allDay ? '' : ' (UK time)'}`;
  const series = entry.seriesId !== null && count > 1;
  return (
    <Modal
      open
      title="Delete this entry?"
      onClose={onClose}
      footer={
        series ? (
          <>
            <Button disabled={pending} onClick={() => onDelete(entry, false)}>
              Just this one
            </Button>
            <Button tone="danger" disabled={pending} onClick={() => onDelete(entry, true)}>
              All {count}
            </Button>
          </>
        ) : (
          <>
            <Button tone="ghost" disabled={pending} onClick={onClose}>
              Cancel
            </Button>
            <Button tone="danger" disabled={pending} onClick={() => onDelete(entry, false)}>
              Delete
            </Button>
          </>
        )
      }
    >
      <p className="muted">
        {series
          ? `${title} repeats weekly. Delete just this one, or every remaining week?`
          : `${title}. Automatic invitations can reach you for this time again.`}
      </p>
    </Modal>
  );
}
