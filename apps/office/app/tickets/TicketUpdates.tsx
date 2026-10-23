'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, EmptyState, toast } from '@thc/ui';
import { formatDateTimeIn, UK_ZONE } from '@thc/domain';
import type { TimeFormat } from '@thc/domain';
import { DictateButton } from '../_components/DictateButton';
import { appendDictation } from '../_lib/dictation';
import { lengthHint } from '../_lib/length';
import { addComment } from './actions';
import { ACTIVITIES, ACTIVITY_LABEL, COMMENT_MAX } from './view-model';
import type { Activity } from './view-model';
import type { TicketComment } from './types';

type Tab = 'all' | Activity;
const TABS: { id: Tab; label: string }[] = [
  { id: 'all', label: 'Activity' },
  { id: 'note', label: 'Notes' },
  { id: 'email', label: 'Emails' },
  { id: 'call', label: 'Calls' },
  { id: 'meeting', label: 'Meetings' },
  { id: 'task', label: 'Tasks' },
];

/**
 * The ticket's Updates (ADR-0202): log a Note, Email, Call, Meeting or Task,
 * and read the thread — the changes to status, category, severity and owner
 * as well, under Activity. Each update is emailed to the owner's address.
 */
export function TicketUpdates({
  id,
  comments,
  format,
}: {
  id: string;
  comments: TicketComment[];
  format?: TimeFormat;
}) {
  const router = useRouter();
  const [type, setType] = useState<Activity>('note');
  const [text, setText] = useState('');
  const [tab, setTab] = useState<Tab>('all');
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const stamp = (iso: string) => formatDateTimeIn(new Date(iso), UK_ZONE, format);

  const shown = comments.filter((c) =>
    tab === 'all' ? true : c.kind === 'comment' && c.activity === tab,
  );

  const add = () =>
    start(async () => {
      setProblem(null);
      const result = await addComment(id, text, type);
      if (!result.ok) return setProblem(result.message);
      setText('');
      router.refresh();
      toast(`${ACTIVITY_LABEL[type]} added`, { tone: 'green' });
    });

  return (
    <div className="tk-updates">
      <div className="tk-types" role="group" aria-label="Type of update">
        {ACTIVITIES.map((a) => (
          <button
            key={a}
            type="button"
            className={type === a ? 'btn sm primary' : 'btn sm'}
            aria-pressed={type === a}
            disabled={pending}
            onClick={() => setType(a)}
          >
            {ACTIVITY_LABEL[a]}
          </button>
        ))}
      </div>
      <div className="field">
        <div className="label-row">
          <label className="label" htmlFor="tk-note">
            Add an update
          </label>
          <DictateButton
            label="Dictate update"
            disabled={pending}
            onText={(spoken) => setText((t) => appendDictation(t, spoken, COMMENT_MAX))}
          />
        </div>
        <textarea
          id="tk-note"
          className="input"
          rows={4}
          value={text}
          maxLength={COMMENT_MAX}
          disabled={pending}
          placeholder={`Log a ${ACTIVITY_LABEL[type].toLowerCase()}: what happened, what was said, or what is next`}
          onChange={(e) => setText(e.target.value)}
        />
        {lengthHint(text.length, COMMENT_MAX) ? (
          <span className="hint">{lengthHint(text.length, COMMENT_MAX)}</span>
        ) : null}
      </div>
      <div className="tk-actions">
        <Button tone="primary" disabled={pending || text.trim() === ''} onClick={add}>
          {pending ? 'Adding…' : `Add ${ACTIVITY_LABEL[type].toLowerCase()}`}
        </Button>
      </div>
      {problem ? <Alert tone="coral">{problem}</Alert> : null}

      <div className="tk-tabs" role="tablist" aria-label="Filter the thread">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? 'btn sm primary' : 'btn sm'}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <EmptyState>
          {comments.length === 0
            ? 'No activity yet — log the first one above.'
            : 'Nothing of that type yet.'}
        </EmptyState>
      ) : (
        <ol className="tk-thread">
          {shown.map((c) => (
            <li key={c.id} className={c.kind === 'change' ? 'tk-change' : 'tk-comment'}>
              <div className="tk-meta">
                {c.kind === 'comment' ? (
                  <span className="tk-activity">{ACTIVITY_LABEL[c.activity]}</span>
                ) : null}
                <b>{c.author_name}</b> · {stamp(c.created_at)}
              </div>
              <div className="tk-body">{c.body}</div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
