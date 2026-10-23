import Link from 'next/link';
import { formatDateTimeIn, UK_ZONE } from '@thc/domain';
import type { TimeFormat } from '@thc/domain';
import { Alert, Panel, Pill } from '@thc/ui';
import { OfficeShell } from '../_components/OfficeShell';
import { TicketControls } from './TicketControls';
import type { TicketPageData } from './data';
import {
  KIND_SHORT,
  KIND_TONE,
  SEVERITY_SHORT,
  SEVERITY_TONE,
  STATUS_LABEL,
  STATUS_TONE,
  ticketRef,
} from './view-model';
import './tickets.css';

/** One ticket (ADR-0198): what was reported, the thread, and the follow-up controls. */
export function TicketScreen({
  data,
  canWrite,
  format,
}: {
  data: TicketPageData;
  canWrite: boolean;
  format?: TimeFormat;
}) {
  const { ticket, comments } = data;
  const stamp = (iso: string) => formatDateTimeIn(new Date(iso), UK_ZONE, format);

  if (!ticket) {
    return (
      <OfficeShell activeHref="/tickets" title="Ticket">
        {data.problem ? (
          <Alert tone="coral">{data.problem}</Alert>
        ) : (
          <p>That ticket was not found.</p>
        )}
        <p>
          <Link href="/tickets">← All tickets</Link>
        </p>
      </OfficeShell>
    );
  }

  return (
    <OfficeShell
      activeHref="/tickets"
      title={ticketRef(ticket.ticket_no)}
      crumbs={<Link href="/tickets">← All tickets</Link>}
    >
      <div className="tk-detail">
        <Panel>
          <div className="tk-head">
            <h2 className="tk-h2">{ticket.title}</h2>
            <span className="tk-pills">
              <Pill tone={KIND_TONE[ticket.kind]}>{KIND_SHORT[ticket.kind]}</Pill>
              {ticket.severity ? (
                <Pill tone={SEVERITY_TONE[ticket.severity]}>{SEVERITY_SHORT[ticket.severity]}</Pill>
              ) : null}
              <Pill tone={STATUS_TONE[ticket.status]}>{STATUS_LABEL[ticket.status]}</Pill>
            </span>
          </div>
          <p className="tk-meta">
            Logged by {ticket.reporter_name} · {stamp(ticket.created_at)} (UK time)
            {ticket.page_path ? <> · from {ticket.page_path}</> : null}
            {ticket.resolved_at ? <> · resolved {stamp(ticket.resolved_at)}</> : null}
          </p>
          {ticket.details ? <p className="tk-body">{ticket.details}</p> : null}
          {ticket.link_url ? (
            <p>
              <a href={ticket.link_url} target="_blank" rel="noopener noreferrer">
                Screenshot or recording ↗
              </a>
            </p>
          ) : null}
        </Panel>

        <Panel title="Thread">
          {comments.length === 0 ? (
            <p className="tk-meta">No updates yet.</p>
          ) : (
            <ol className="tk-thread">
              {comments.map((c) => (
                <li key={c.id} className={c.kind === 'change' ? 'tk-change' : 'tk-comment'}>
                  <div className="tk-meta">
                    <b>{c.author_name}</b> · {stamp(c.created_at)}
                  </div>
                  <div className="tk-body">{c.body}</div>
                </li>
              ))}
            </ol>
          )}
        </Panel>

        {data.problem ? <Alert tone="coral">{data.problem}</Alert> : null}
        <Panel title="Follow up">
          <TicketControls
            id={ticket.id}
            status={ticket.status}
            severity={ticket.severity}
            canWrite={canWrite}
          />
        </Panel>
      </div>
    </OfficeShell>
  );
}
