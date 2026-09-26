'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Alert, Button, Chip, KpiTile, Panel, TileGrid } from '@thc/ui';
import { OfficeShell } from '../../_components/OfficeShell';
import { RecordHistory } from '../../_components/history/RecordHistory';
import { ClientModal } from '../ClientModal';
import { ClientEvents } from './ClientEvents';
import { QualifiedStaff } from './QualifiedStaff';
import { RateCard } from './RateCard';
import { marginTone, newEventHref } from './card';
import type { Client } from '../types';
import type { ClientCardData } from './types';
import './card.css';

/**
 * /clients/:id — the client card (§9.7),
 * `wireframes/backoffice/client-card.html`.
 *
 * Four blocks, numbered as the scope numbers them. Two things hold across
 * all of them:
 *
 * There is no Delete, anywhere. §9.7: "there is no Delete action; a
 * client record cannot be removed from the system, only edited." The
 * database agrees — `delete_client` does not exist, and
 * 280_clients_directory.sql asserts its absence, because on this screen
 * the absence IS the requirement.
 *
 * Every figure here is money, which is why none of it goes near the
 * Client Portal. The views behind the card are `clients_`, plural: the
 * singular `client_` prefix belongs to the portal and 050 forbids a money
 * column on anything carrying it (§11.1, ADR-0004).
 */
export function ClientCard({
  data,
  ratesVisible = true,
}: {
  data: ClientCardData;
  /** ADR-0061: the viewer's office_can('finance') — no margin, no rate controls without it. */
  ratesVisible?: boolean;
}) {
  const client = data.client as Client;
  const [editing, setEditing] = useState(false);
  const eventsTile = (
    <KpiTile
      label="Events"
      value={client.event_count}
      description={`${data.events.filter((row) => row.status === 'upcoming' || row.status === 'ongoing').length} still to come`}
    />
  );

  return (
    <OfficeShell
      activeHref="/clients"
      title="Client"
      crumbs={
        <>
          <Link href="/clients">Clients</Link> / <b>{client.name}</b>
        </>
      }
      actions={
        // The Shift Builder opens with this client picked, its rate card and
        // on-site contact loaded (§9.7, §3.2).
        <Link className="btn primary sm" href={newEventHref(client.id)}>
          + New event for this client
        </Link>
      }
    >
      <div className="stack">
        <Panel
          title={
            <>
              <span className="blk-n">1</span> General info
            </>
          }
          actions={
            <>
              <Button size="sm" onClick={() => setEditing(true)}>
                Edit
              </Button>
              <span className="muted xs">no Delete — a client record is only ever edited</span>
            </>
          }
        >
          <div className="grid c3">
            <div className="kv" style={{ gridColumn: 'span 2' }}>
              <span className="k">Client name</span>
              <span>
                <b>{client.name}</b>
              </span>
              <span className="k">Contact</span>
              <span>{client.contact_name}</span>
              <span className="k">Phone</span>
              <span className="mono">{client.phone}</span>
              <span className="k">Staff contact point</span>
              <span>
                {client.staff_contact_point}{' '}
                <span className="muted xs">(pre-fills the on-site contact on every event)</span>
              </span>
              <span className="k">Allocation emails</span>
              <span className="row wrap">
                {client.contact_emails.map((email) => (
                  <Chip key={email}>{email}</Chip>
                ))}
              </span>
              <span className="k">Break policy</span>
              <span>
                {client.pays_breaks ? (
                  <>
                    Pays for breaks — break time is <b>not</b> deducted from the charge
                  </>
                ) : (
                  <>
                    Does <b>not</b> pay for breaks — staff log Start / Finish break and the time is
                    deducted from pay and charge
                  </>
                )}
              </span>
              <span className="k">Buffer policy</span>
              <span>
                {client.pays_buffer ? (
                  <>Pays for the buffer — everyone accepted works and is paid normally</>
                ) : (
                  <>
                    Not charged for the buffer — the first {'{headcount}'} check-ins work and later
                    ones are turned away at check-in
                  </>
                )}
              </span>
            </div>
            {ratesVisible ? (
              <TileGrid columns={2}>
                <KpiTile
                  label="Average margin"
                  value={client.avg_margin_pct === null ? '—' : `${client.avg_margin_pct}%`}
                  tone={marginTone(client.avg_margin_pct) === 'green' ? 'ok' : 'default'}
                  description={
                    client.avg_margin_pct === null
                      ? 'nothing delivered yet — no margin is not 0%'
                      : 'across completed events · after holiday pay'
                  }
                />
                {eventsTile}
              </TileGrid>
            ) : (
              eventsTile
            )}
          </div>
        </Panel>

        <RateCard
          clientId={client.id}
          rows={data.rateCard}
          roles={data.roles}
          ratesVisible={ratesVisible}
        />

        <QualifiedStaff
          clientId={client.id}
          rows={data.qualified}
          rateCard={data.rateCard}
          staff={data.staff}
        />

        <ClientEvents rows={data.events} ratesVisible={ratesVisible} />

        {/* The audit trail (ADR-0055), after the scope's four blocks. */}
        <RecordHistory
          entity="client"
          id={client.id}
          title={
            <>
              <span className="blk-n">5</span> History
            </>
          }
        />

        <Alert tone="cyan">
          Changing a policy applies to events built from now on; existing events keep the policy
          they were built with. The rate card and the qualified pool are edited on this card, not in
          the Edit dialog.
        </Alert>
      </div>

      {editing ? (
        <ClientModal
          client={client}
          onClose={() => setEditing(false)}
          onSaved={() => setEditing(false)}
        />
      ) : null}
    </OfficeShell>
  );
}
