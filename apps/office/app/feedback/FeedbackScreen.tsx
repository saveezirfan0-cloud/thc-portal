'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type ReactNode } from 'react';
import { Alert, Button, EmptyState, Pill, SegToggle, Tabs } from '@thc/ui';
import { markRead } from './actions';
import { DeleteFeedbackModal, EditFeedbackModal } from './_components/FeedbackDialogs';
import { OfficeFeedbackForm } from './_components/OfficeFeedbackForm';
import { Stars } from './_components/Stars';
import {
  clientMetaLine,
  clientStatus,
  eventLine,
  hrefFor,
  officeMetaLine,
  pageInfo,
  quoted,
} from './view-model';
import type { FeedbackPageData } from './data';
import type { FeedbackEntry, FeedbackQuery, ReadFilter, Tab } from './types';

/**
 * /feedback — every piece of feedback about workers, in one place (§9.10),
 * `wireframes/backoffice/feedback.html`.
 *
 * Two tabs, never a combined list. Client feedback is a read-only channel
 * whose one action is Mark as read — the moment an entry starts counting
 * toward the worker's rating. Office feedback is the manager's own, counts
 * from submission, and can be edited or deleted.
 *
 * The tab, search, filters and page live in the URL, so the list is read
 * on the server and a filtered view is a link.
 */
export function FeedbackScreen({ data, query }: { data: FeedbackPageData; query: FeedbackQuery }) {
  const router = useRouter();
  const [editing, setEditing] = useState<FeedbackEntry | null>(null);
  const [deleting, setDeleting] = useState<FeedbackEntry | null>(null);

  const go = (patch: Partial<FeedbackQuery>) => router.push(hrefFor(query, patch));
  const info = pageInfo(query.page, data.total);

  return (
    <div className="stack fb-screen">
      {data.problem ? <Alert tone="coral">{data.problem}</Alert> : null}

      <Tabs<Tab>
        aria-label="Feedback source"
        value={query.tab}
        onChange={(tab) => go({ tab })}
        options={[
          {
            value: 'client',
            label: 'Client feedback',
            count: data.unread > 0 ? data.unread : undefined,
            alert: true,
          },
          { value: 'office', label: 'Office feedback' },
        ]}
      />

      {query.tab === 'client' ? (
        <>
          <div className="toolbar">
            <SearchBox query={query} />
            <select
              className="input fb-filter"
              aria-label="Filter by client"
              value={query.clientId}
              onChange={(event) => go({ clientId: event.target.value })}
            >
              <option value="">All clients</option>
              {data.clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
            <SegToggle<ReadFilter>
              small
              aria-label="Read state"
              value={query.status}
              onChange={(status) => go({ status })}
              options={[
                { value: 'all', label: 'All' },
                {
                  value: 'unread',
                  label: 'Unread',
                  count: data.unread > 0 ? data.unread : undefined,
                  alert: true,
                },
                { value: 'read', label: 'Read' },
              ]}
            />
            <div className="right">
              <span className="muted xs">
                read-only channel — arrives from the Client Portal; cannot be replied to, edited or
                deleted
              </span>
            </div>
          </div>

          <Alert tone="cyan">
            <b>Rating impact:</b> a client entry feeds the worker&rsquo;s rating (25% of the
            auto-assign score) only once a manager presses <b>Mark as read</b> — submission alone
            does not affect the rating. &ldquo;Mark as read&rdquo; exists only on this tab.
          </Alert>

          <div className="fb-list" role="list" aria-label="Client feedback">
            <div className="fbhead" aria-hidden="true">
              <span className="label">Stars</span>
              <span className="label">Worker · event</span>
              <span className="label">Comment</span>
              <span className="label">Status</span>
            </div>
            {data.entries.length === 0 ? (
              <EmptyState>
                {query.q || query.clientId || query.status !== 'all'
                  ? 'No client feedback matches these filters.'
                  : 'No client feedback yet. It arrives from the Client Portal once an event has started.'}
              </EmptyState>
            ) : (
              data.entries.map((entry) => (
                <ClientRow key={entry.id} entry={entry} onDelete={() => setDeleting(entry)} />
              ))
            )}
          </div>
        </>
      ) : (
        <>
          <OfficeFeedbackForm variant="inbox" managerName={data.managerName} />

          <div className="toolbar">
            <SearchBox query={query} />
            <select
              className="input fb-filter"
              aria-label="Filter by author"
              value={query.authorId}
              onChange={(event) => go({ authorId: event.target.value })}
            >
              <option value="">All authors</option>
              {data.authors.map((author) => (
                <option key={author.id} value={author.id}>
                  {author.name}
                </option>
              ))}
            </select>
            <div className="right">
              <span className="muted sm">
                editable / deletable here and on the worker&rsquo;s profile · author = the
                manager&rsquo;s own name, never a generic &ldquo;Office&rdquo;
              </span>
            </div>
          </div>

          <div className="fb-list" role="list" aria-label="Office feedback">
            <div className="fbhead" aria-hidden="true">
              <span className="label">Stars</span>
              <span className="label">Worker · event</span>
              <span className="label">Comment</span>
              <span className="label">Author</span>
            </div>
            {data.entries.length === 0 ? (
              <EmptyState>
                {query.q || query.authorId
                  ? 'No office feedback matches these filters.'
                  : 'No office feedback yet. Use the form above when a compliment or a complaint arrives by phone.'}
              </EmptyState>
            ) : (
              data.entries.map((entry) => (
                <OfficeRow
                  key={entry.id}
                  entry={entry}
                  onEdit={() => setEditing(entry)}
                  onDelete={() => setDeleting(entry)}
                />
              ))
            )}
          </div>
        </>
      )}

      <div className="row fb-pager">
        <span className="muted sm">{info.label}</span>
        <div className="ml-auto row">
          <PageLink disabled={info.page <= 1} href={hrefFor(query, { page: info.page - 1 })}>
            ‹ Prev
          </PageLink>
          <span className="mono sm">
            {info.page} / {info.pages}
          </span>
          <PageLink
            disabled={info.page >= info.pages}
            href={hrefFor(query, { page: info.page + 1 })}
          >
            Next ›
          </PageLink>
        </div>
      </div>

      {editing ? <EditFeedbackModal entry={editing} onClose={() => setEditing(null)} /> : null}
      {deleting ? <DeleteFeedbackModal entry={deleting} onClose={() => setDeleting(null)} /> : null}
    </div>
  );
}

/** The worker's name, linked to the profile — unless §1.7 has removed them. */
function WorkerName({ entry }: { entry: FeedbackEntry }) {
  if (entry.staff_removed) {
    return (
      <div className="n muted">
        <i>{entry.staff_name}</i>
      </div>
    );
  }
  return (
    <div className="n">
      <Link href={`/staff/${entry.staff_id}`}>{entry.staff_name}</Link>
    </div>
  );
}

function ClientRow({ entry, onDelete }: { entry: FeedbackEntry; onDelete: () => void }) {
  const router = useRouter();
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const status = clientStatus(entry);

  const read = () => {
    setProblem(null);
    start(async () => {
      const result = await markRead(entry.id);
      if (result.ok) router.refresh();
      else setProblem(result.message);
    });
  };

  return (
    <div className={`fb ${entry.unread ? 'unread' : 'read'}`} role="listitem">
      <Stars rating={entry.rating} />
      <div className="who">
        <WorkerName entry={entry} />
        <div className="s">{eventLine(entry, true)}</div>
      </div>
      <div className="txt">
        {quoted(entry.text) ?? <span className="muted">No comment — stars only.</span>}
        <span className="m">{clientMetaLine(entry)}</span>
      </div>
      <div className="acts">
        <Pill tone={status.tone}>{status.label}</Pill>
        {entry.unread ? (
          <Button size="sm" tone="primary" onClick={read} disabled={pending}>
            {pending ? 'Marking…' : 'Mark as read'}
          </Button>
        ) : (
          <span className="muted xs">in rating</span>
        )}
        {entry.deletable ? (
          <>
            <Button size="sm" tone="ghost" onClick={onDelete}>
              Delete
            </Button>
            <span className="note-line muted xs">
              the one exception to read-only: deleting a client entry to redact a name after GDPR
              removal, if asked
            </span>
          </>
        ) : null}
        {problem ? <span className="note-line coral xs">{problem}</span> : null}
      </div>
    </div>
  );
}

function OfficeRow({
  entry,
  onEdit,
  onDelete,
}: {
  entry: FeedbackEntry;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="fb office" role="listitem">
      <Stars rating={entry.rating} />
      <div className="who">
        <WorkerName entry={entry} />
        <div className="s">{eventLine(entry, false)}</div>
      </div>
      <div className="txt">
        {quoted(entry.text)}
        <span className="m">{officeMetaLine(entry)}</span>
      </div>
      <div className="acts">
        <Pill tone="purple">{entry.author_name ?? 'Unknown manager'}</Pill>
        <Button size="sm" tone="ghost" onClick={onEdit}>
          Edit
        </Button>
        <Button size="sm" tone="ghost" onClick={onDelete}>
          Delete
        </Button>
      </div>
    </div>
  );
}

/**
 * Search by staff name (§9.10, both tabs). A form, so it asks the server
 * once on Enter rather than on every keystroke.
 */
function SearchBox({ query }: { query: FeedbackQuery }) {
  const router = useRouter();
  const [q, setQ] = useState(query.q);
  return (
    <form
      className="search"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        router.push(hrefFor(query, { q: q.trim() }));
      }}
    >
      <input
        className="input fb-search"
        type="search"
        placeholder="Search by staff name"
        aria-label="Search by staff name"
        value={q}
        onChange={(event) => {
          setQ(event.target.value);
          // Clearing the box clears the search, without needing Enter.
          if (event.target.value === '' && query.q) router.push(hrefFor(query, { q: '' }));
        }}
      />
    </form>
  );
}

function PageLink({
  href,
  disabled,
  children,
}: {
  href: string;
  disabled: boolean;
  children: ReactNode;
}) {
  if (disabled) {
    return (
      <button type="button" className="btn sm ghost" disabled>
        {children}
      </button>
    );
  }
  return (
    <Link className="btn sm ghost" href={href}>
      {children}
    </Link>
  );
}
