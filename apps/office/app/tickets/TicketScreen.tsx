import Link from 'next/link';
import { formatDateTimeIn, UK_ZONE } from '@thc/domain';
import type { TimeFormat } from '@thc/domain';
import { Alert, Avatar, Panel, Pill } from '@thc/ui';
import { OfficeShell } from '../_components/OfficeShell';
import { DeleteTicket } from './DeleteTicket';
import { TicketTracking } from './TicketTracking';
import { TicketTriage } from './TicketTriage';
import { TicketUpdates } from './TicketUpdates';
import type { TicketPageData, TrackingData } from './data';
import type { TicketFile } from './types';
import { sizeLabel } from './ticket-files';
import {
  KIND_SHORT,
  KIND_TONE,
  SCOPE_SHORT,
  SCOPE_TONE,
  SEVERITY_SHORT,
  SEVERITY_TONE,
  STATUS_LABEL,
  STATUS_TONE,
  ticketRef,
} from './view-model';
import './tickets.css';

const NO_TRACKING: TrackingData = {
  allowed: false,
  scope: null,
  entries: [],
  running: null,
  problem: null,
};

/**
 * One ticket (ADR-0202), laid out as the reference's report panel:
 * Triage (status, category, severity, owner), the Report, its Context
 * (who, when, which page), the Resolution note, the Updates thread — and,
 * for the one login that tracks, the internal scope label and time.
 */
export function TicketScreen({
  data,
  canWrite,
  isOwner = false,
  tracking = NO_TRACKING,
  files = [],
  format,
}: {
  data: TicketPageData;
  canWrite: boolean;
  /** An Owner login: the one that may delete a report. */
  isOwner?: boolean;
  tracking?: TrackingData;
  /** Screenshots, videos and recordings sent with it (ADR-0204). */
  files?: TicketFile[];
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
          <div className="tk-eyebrow">
            {ticketRef(ticket.ticket_no)} · filed by {ticket.reporter_name}
          </div>
          <h2 className="tk-h2">{ticket.title}</h2>
          <span className="tk-pills">
            <Pill tone={KIND_TONE[ticket.kind]}>{KIND_SHORT[ticket.kind]}</Pill>
            {ticket.severity ? (
              <Pill tone={SEVERITY_TONE[ticket.severity]}>{SEVERITY_SHORT[ticket.severity]}</Pill>
            ) : null}
            <Pill tone={STATUS_TONE[ticket.status]}>{STATUS_LABEL[ticket.status]}</Pill>
            {tracking.allowed && tracking.scope ? (
              <Pill tone={SCOPE_TONE[tracking.scope.label]}>
                {SCOPE_SHORT[tracking.scope.label]}
              </Pill>
            ) : null}
          </span>
        </Panel>

        <Panel title="Triage">
          <TicketTriage
            id={ticket.id}
            status={ticket.status}
            kind={ticket.kind}
            severity={ticket.severity}
            assigneeId={ticket.assignee_id}
            resolution={ticket.resolution}
            reporterName={ticket.reporter_name}
            assignees={data.assignees}
            canWrite={canWrite}
          />
        </Panel>

        <Panel title="Report">
          <div className="tk-label">What was reported</div>
          {ticket.details ? (
            <p className="tk-body">{ticket.details}</p>
          ) : (
            <p className="tk-meta">No details were given.</p>
          )}
          {ticket.link_url ? (
            <p>
              <a href={ticket.link_url} target="_blank" rel="noopener noreferrer">
                Screenshot or recording ↗
              </a>
            </p>
          ) : null}
        </Panel>

        {files.length > 0 ? (
          <Panel title="Screenshots and recordings">
            <ul className="tk-files">
              {files.map((file) => (
                <li key={file.id}>
                  {file.url && file.kind === 'screenshot' ? (
                    <a href={file.url} target="_blank" rel="noopener noreferrer">
                      <img src={file.url} alt={file.file_name ?? 'Screenshot'} loading="lazy" />
                    </a>
                  ) : file.url ? (
                    <video src={file.url} controls preload="metadata" />
                  ) : (
                    <p className="tk-meta">
                      {file.restricted
                        ? 'A screenshot can show pay or other private screens, so only the person who sent it and finance logins can open it.'
                        : 'This file could not be linked just now. Reload to try again.'}
                    </p>
                  )}
                  <div className="tk-meta">
                    {file.file_name ?? (file.kind === 'screenshot' ? 'Screenshot' : 'Recording')} ·{' '}
                    {sizeLabel(file.bytes)}
                    {file.url ? (
                      <>
                        {' · '}
                        <a href={file.url} target="_blank" rel="noopener noreferrer" download>
                          Open
                        </a>
                      </>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}

        <Panel title="Context">
          <div className="tk-grid">
            <div>
              <div className="tk-label">Reported by</div>
              <div className="tk-who">
                <Avatar name={ticket.reporter_name} size="sm" /> {ticket.reporter_name}
              </div>
            </div>
            <div>
              <div className="tk-label">Filed</div>
              <div>{stamp(ticket.created_at)} (UK time)</div>
            </div>
            <div>
              <div className="tk-label">Page it happened on</div>
              {ticket.page_path ? (
                /^\/(?!\/)/.test(ticket.page_path) ? (
                  <a className="tk-path" href={ticket.page_path}>
                    <code>{ticket.page_path}</code>
                  </a>
                ) : (
                  <code className="tk-path">{ticket.page_path}</code>
                )
              ) : (
                '—'
              )}
            </div>
            {ticket.resolved_at ? (
              <div>
                <div className="tk-label">Resolved</div>
                <div>{stamp(ticket.resolved_at)} (UK time)</div>
              </div>
            ) : null}
          </div>
        </Panel>

        <Panel title="Updates">
          <TicketUpdates id={ticket.id} comments={comments} format={format} />
        </Panel>

        {tracking.allowed ? (
          <Panel title="Scope and time">
            {tracking.problem ? <Alert tone="coral">{tracking.problem}</Alert> : null}
            <TicketTracking
              ticketId={ticket.id}
              ticketNo={ticket.ticket_no}
              scope={tracking.scope}
              entries={tracking.entries}
              running={tracking.running}
              format={format}
            />
          </Panel>
        ) : null}

        {data.problem ? <Alert tone="coral">{data.problem}</Alert> : null}
        {isOwner ? <DeleteTicket id={ticket.id} no={ticket.ticket_no} /> : null}
      </div>
    </OfficeShell>
  );
}
