'use client';

import { useEffect, useId, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Avatar, Button, Pill } from '@thc/ui';
import { addOfficeFeedback, searchWorkers, workerEvents } from '../actions';
import { eventOptionLabel, uniqueEvents, validateDraft, workerSubline } from '../view-model';
import type { EventOption, WorkerOption } from '../types';
import { StarPicker } from './Stars';

export interface OfficeFeedbackFormProps {
  /** The signed-in manager — the author of the entry (§9.10). */
  managerName: string | null;
  /**
   * On the worker's profile the worker is fixed and their events are
   * already loaded; on /feedback the manager picks the worker first.
   */
  worker?: { id: string; name: string };
  events?: EventOption[];
  variant: 'inbox' | 'profile';
}

/**
 * "New feedback" — the office's own entry (§9.10): worker, stars, an
 * optional event, and a comment. It counts toward the rating the moment it
 * is saved; there is no Mark as read step for an office entry.
 *
 * The same form sits on /feedback and on the worker's profile (§9.6),
 * laid out as each wireframe draws it.
 */
export function OfficeFeedbackForm({
  managerName,
  worker: fixed,
  events: fixedEvents,
  variant,
}: OfficeFeedbackFormProps) {
  const router = useRouter();
  const ids = useId();
  const [worker, setWorker] = useState<{ id: string; name: string } | null>(fixed ?? null);
  const [events, setEvents] = useState<EventOption[]>(uniqueEvents(fixedEvents ?? []));
  const [rating, setRating] = useState(0);
  const [text, setText] = useState('');
  const [eventId, setEventId] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, start] = useTransition();
  /** Bumped after a save so the typeahead starts empty again. */
  const [round, setRound] = useState(0);

  const pick = (next: WorkerOption | null) => {
    setWorker(next ? { id: next.id, name: next.name } : null);
    setEventId('');
    setEvents([]);
    if (next) {
      void workerEvents(next.id).then((rows) => setEvents(uniqueEvents(rows)));
    }
  };

  const submit = () => {
    const draft = { staffId: worker?.id ?? '', rating, text, eventId };
    const invalid = validateDraft(draft);
    setSaved(null);
    if (invalid) {
      setProblem(invalid);
      return;
    }
    setProblem(null);
    start(async () => {
      const result = await addOfficeFeedback(draft);
      if (!result.ok) {
        setProblem(result.message);
        return;
      }
      setSaved(`Saved. It counts toward ${worker?.name ?? 'the worker'}'s rating now.`);
      setRating(0);
      setText('');
      setEventId('');
      if (!fixed) {
        pick(null);
        setRound((n) => n + 1);
      }
      router.refresh();
    });
  };

  const eventSelect = (
    <select
      id={`${ids}-event`}
      className="input"
      aria-label="Event (optional)"
      value={eventId}
      disabled={pending || !worker}
      onChange={(event) => setEventId(event.target.value)}
    >
      <option value="">Not tied to an event</option>
      {events.map((event) => (
        <option key={event.id} value={event.id}>
          {eventOptionLabel(event)}
        </option>
      ))}
    </select>
  );

  const comment = (
    <textarea
      id={`${ids}-comment`}
      className="input"
      aria-label="Comment"
      placeholder="Comment — e.g. a compliment or complaint that came in by phone"
      value={text}
      disabled={pending}
      onChange={(event) => setText(event.target.value)}
    />
  );

  const feedback = (
    <>
      {problem ? <Alert tone="coral">{problem}</Alert> : null}
      {saved ? <Alert tone="green">{saved}</Alert> : null}
    </>
  );

  if (variant === 'profile') {
    return (
      <section className="panel">
        <div className="panel-h">
          <h3>New office feedback</h3>
          <span className="muted sm">
            author = {managerName ?? 'you'} · counts toward the rating immediately
          </span>
        </div>
        <div className="panel-b stack">
          {feedback}
          <StarPicker value={rating} onChange={setRating} disabled={pending} showCount />
          {comment}
          <div className="row wrap">
            <div className="fb-event">{eventSelect}</div>
            <Button tone="primary" className="ml-auto" onClick={submit} disabled={pending}>
              {pending ? 'Saving…' : 'Add feedback'}
            </Button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="panel-h">
        <h3>New feedback</h3>
        <span className="muted sm">
          not every client uses the portal — a complaint or a compliment often arrives by phone
        </span>
        <div className="right">
          <Pill tone="purple">author: {managerName ?? 'you'}</Pill>
        </div>
      </div>
      <div className="panel-b grid c3 fb-form">
        <div className="fb-form-full">{feedback}</div>
        <div className="field">
          <label className="label" htmlFor={`${ids}-worker`}>
            Worker <span className="coral">*</span>
          </label>
          <WorkerTypeahead
            key={round}
            id={`${ids}-worker`}
            selected={worker}
            onPick={pick}
            disabled={pending}
          />
        </div>
        <div className="field">
          <span className="label">
            Stars <span className="coral">*</span>
          </span>
          <StarPicker value={rating} onChange={setRating} disabled={pending} />
          <span className="hint">
            counts toward the rating immediately on submission — no Mark as read step for office
            entries
          </span>
        </div>
        <div className="field">
          <label className="label" htmlFor={`${ids}-event`}>
            Event <span className="muted">· optional</span>
          </label>
          {eventSelect}
        </div>
        <div className="field fb-form-full">
          <label className="label" htmlFor={`${ids}-comment`}>
            Comment <span className="coral">*</span>
          </label>
          {comment}
        </div>
        <div className="row fb-form-full">
          <span className="muted xs">
            No limit on how many entries a person can have. Also available from the worker&rsquo;s
            profile.
          </span>
          <Button tone="primary" className="ml-auto" onClick={submit} disabled={pending}>
            {pending ? 'Saving…' : 'Add feedback'}
          </Button>
        </div>
      </div>
    </section>
  );
}

/**
 * Worker search for the form. Asks the server after a short pause rather
 * than on every keystroke, and offers at most eight names — the manager
 * is looking for one person, not browsing the directory.
 */
function WorkerTypeahead({
  id,
  selected,
  onPick,
  disabled,
}: {
  id: string;
  selected: { id: string; name: string } | null;
  onPick: (worker: WorkerOption | null) => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState(selected?.name ?? '');
  const [options, setOptions] = useState<WorkerOption[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const latest = useRef('');

  useEffect(() => {
    const q = text.trim();
    latest.current = q;
    if (q.length < 2 || (selected && q === selected.name)) {
      setOptions([]);
      return;
    }
    const timer = setTimeout(() => {
      void searchWorkers(q).then((rows) => {
        // A slow answer to an older query must not replace a newer one.
        if (latest.current !== q) return;
        setOptions(rows);
        setActive(0);
        setOpen(true);
      });
    }, 200);
    return () => clearTimeout(timer);
  }, [text, selected]);

  const choose = (worker: WorkerOption) => {
    setText(worker.name);
    setOpen(false);
    onPick(worker);
  };

  const listId = `${id}-list`;

  return (
    <div className="typeahead">
      <input
        id={id}
        className="input"
        role="combobox"
        aria-expanded={open && options.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        placeholder="Start typing a name"
        autoComplete="off"
        value={text}
        disabled={disabled}
        onChange={(event) => {
          setText(event.target.value);
          if (selected) onPick(null);
        }}
        onFocus={() => setOpen(options.length > 0)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(event) => {
          if (!open || options.length === 0) return;
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActive((i) => Math.min(options.length - 1, i + 1));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActive((i) => Math.max(0, i - 1));
          } else if (event.key === 'Enter') {
            event.preventDefault();
            const worker = options[active];
            if (worker) choose(worker);
          } else if (event.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      {open && options.length > 0 ? (
        <div className="dd" role="listbox" id={listId}>
          {options.map((worker, index) => (
            <div
              key={worker.id}
              role="option"
              aria-selected={index === active}
              className={index === active ? 'o sel' : 'o'}
              onMouseDown={(event) => {
                event.preventDefault();
                choose(worker);
              }}
            >
              <Avatar name={worker.name} size="sm" />
              <span>{worker.name}</span>
              <span className="s">{workerSubline(worker)}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
