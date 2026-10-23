'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Panel, toast } from '@thc/ui';
import { logTime } from '../actions';
import type { TicketChoice } from '../data';
import { NOTE_MAX, WORKERS, WORKER_LABEL } from '../view-model';

const BILLABLE = [
  { value: 'follow', label: 'Billable: follow the scope label' },
  { value: 'yes', label: 'Billable' },
  { value: 'no', label: 'Not billed' },
] as const;

/**
 * Log time without opening the ticket (ADR-0202): pick the ticket, say how
 * long, who did it and whether it is billed. The same `log_ticket_time()` as
 * the panel on the ticket, so it is refused for anyone who is not a tracker.
 */
export function QuickLogTime({ choices }: { choices: readonly TicketChoice[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  const [ticket, setTicket] = useState('');
  const [duration, setDuration] = useState('');
  const [workedBy, setWorkedBy] = useState('owner');
  const [workedOn, setWorkedOn] = useState('');
  const [note, setNote] = useState('');
  const [billable, setBillable] = useState<(typeof BILLABLE)[number]['value']>('follow');

  if (choices.length === 0) {
    return (
      <Panel title="Log time">
        <p className="hint">No tickets yet. Send one with the Ticket button, then log time here.</p>
      </Panel>
    );
  }

  const submit = () =>
    start(async () => {
      setProblem(null);
      const result = await logTime(ticket, {
        duration,
        workedBy,
        workedOn,
        note,
        billable: billable === 'follow' ? null : billable === 'yes',
      });
      if (!result.ok) return setProblem(result.message);
      setDuration('');
      setNote('');
      toast('Time logged', { tone: 'green' });
      router.refresh();
    });

  return (
    <Panel title="Log time">
      <div className="tk-log">
        <select
          className="input"
          aria-label="Ticket"
          value={ticket}
          disabled={pending}
          onChange={(e) => setTicket(e.target.value)}
        >
          <option value="">Choose a ticket…</option>
          {choices.map((t) => (
            <option key={t.id} value={t.id}>
              TK-{t.no} · {t.title}
            </option>
          ))}
        </select>
        <input
          className="input"
          aria-label="Time spent"
          placeholder="15, 1h 30m, 1.5h"
          value={duration}
          disabled={pending}
          onChange={(e) => setDuration(e.target.value)}
        />
        <select
          className="input"
          aria-label="Worked by"
          value={workedBy}
          disabled={pending}
          onChange={(e) => setWorkedBy(e.target.value)}
        >
          {WORKERS.map((w) => (
            <option key={w} value={w}>
              {WORKER_LABEL[w]}
            </option>
          ))}
        </select>
        <input
          className="input"
          type="date"
          aria-label="Day worked"
          value={workedOn}
          disabled={pending}
          onChange={(e) => setWorkedOn(e.target.value)}
        />
      </div>
      <div className="tk-log">
        <input
          className="input"
          aria-label="What was done"
          placeholder="What was done (optional)"
          value={note}
          maxLength={NOTE_MAX}
          disabled={pending}
          onChange={(e) => setNote(e.target.value)}
        />
        <select
          className="input"
          aria-label="Billable"
          value={billable}
          disabled={pending}
          onChange={(e) => setBillable(e.target.value as typeof billable)}
        >
          {BILLABLE.map((b) => (
            <option key={b.value} value={b.value}>
              {b.label}
            </option>
          ))}
        </select>
        <Button
          tone="primary"
          disabled={pending || ticket === '' || duration.trim() === ''}
          onClick={submit}
        >
          Log time
        </Button>
      </div>
      <p className="hint">
        Leave the day blank for today. To run a timer instead, open the ticket and press Start
        timer.
      </p>
      {problem ? <Alert tone="coral">{problem}</Alert> : null}
    </Panel>
  );
}
