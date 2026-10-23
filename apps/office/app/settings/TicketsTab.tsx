import Link from 'next/link';
import { Note, Panel } from '@thc/ui';

/**
 * /settings → Tickets (ADR-0202): where the owners handle the tickets the
 * team has sent from the top bar's Ticket button. The list and each ticket
 * are the /tickets pages; this tab is the way in from Settings.
 *
 * Time and billing are drawn only for a login `ticket_tracker_allowed()`
 * names, so for anyone else this tab does not say they exist.
 */
export function TicketsTab({ tracker }: { tracker: boolean }) {
  return (
    <div className="stack">
      <Note>
        Anyone in the Back Office can send a ticket from the <b>Ticket</b> button at the top of
        every screen. Each one is numbered (TK-12), emailed to the owner, and followed up here. The
        person who sent it is emailed when somebody replies or resolves it.
      </Note>
      <div className="settings-grid">
        <Panel title="Tickets">
          <p>
            <Link href="/tickets">Open the ticket list</Link>
          </p>
          <p className="hint">
            Open · Closed · All, with search, filters and a page for each ticket: status, owner,
            updates and a resolution note.
          </p>
        </Panel>
        {tracker ? (
          <Panel title="Time and billing">
            <p>
              <Link href="/tickets/time">Open the time report</Link>
            </p>
            <p className="hint">
              Internal, only you can see this. The month&rsquo;s time by ticket, who did it (Me or
              Claude), billable or not, and a CSV for the invoice. Start a timer or log time from
              any ticket.
            </p>
          </Panel>
        ) : null}
      </div>
    </div>
  );
}
