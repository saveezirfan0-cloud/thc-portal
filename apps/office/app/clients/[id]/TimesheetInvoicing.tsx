'use client';

import { useState, useTransition } from 'react';
import { Alert, Button, Checkbox, Chip, Input, Panel, SegToggle, Select, Textarea, toast } from '@thc/ui';
import { saveTimesheetInvoicing } from './timesheetActions';
import {
  FORMAT_LABEL,
  LABEL_MAX,
  MODE_LABEL,
  NAME_MAX,
  defaultRoleOnCard,
  normaliseList,
  parseTerms,
  settingsProblem,
} from './timesheetInvoicing';
import type { InvoiceFormat, InvoicingMode } from './timesheetInvoicing';
import { TimesheetRates } from './TimesheetRates';
import type { TimesheetInvoicingSettings, TimesheetRateRow } from './types';

/**
 * Block 8 — Timesheet invoicing (ADR-0210). Not in the wireframe's four
 * blocks; `wireframes/backoffice/client-timesheet-invoicing.html` draws it
 * and the ADR is the deviation record.
 *
 * A client is invoiced either from the sign-in log of its events (ADR-0176)
 * or from a timesheet the office uploads (Invoices → Process timesheet).
 * Setting it to Timesheet also leaves it out of event invoicing (ADR-0203's
 * "Left out of invoicing", in the same statement) so the daily job never
 * takes a number for it. The settings below drive the timesheet workflow:
 * the invoice layout, the venue and date header printed on it, the subject
 * wording, who is dropped from a sheet, whether a PO is mandatory and the
 * payment terms. The rate card (what each role is charged per hour) sits
 * under them.
 *
 * Without the 'write' permission (a viewer, ADR-0060) the values are text,
 * with no Edit — the database refuses the same.
 */
export function TimesheetInvoicing({
  clientId,
  settings,
  rates,
  excludedFromEvents,
  canWrite,
}: {
  clientId: string;
  settings: TimesheetInvoicingSettings;
  rates: TimesheetRateRow[];
  /** ADR-0203's switch as it stands (so the mode's side effect can be said). */
  excludedFromEvents: boolean;
  canWrite: boolean;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <>
      <Panel
        title={
          <>
            <span className="blk-n">8</span> Timesheet invoicing
          </>
        }
        actions={
          <>
            {canWrite && !editing ? (
              <Button size="sm" onClick={() => setEditing(true)}>
                Edit
              </Button>
            ) : null}
            <span className="muted xs">invoices from an uploaded timesheet, pushed to Xero</span>
          </>
        }
      >
        {canWrite && editing ? (
          <SettingsForm
            clientId={clientId}
            settings={settings}
            rates={rates}
            excludedFromEvents={excludedFromEvents}
            onDone={() => setEditing(false)}
          />
        ) : (
          <SettingsView settings={settings} rates={rates} />
        )}
      </Panel>
      <TimesheetRates clientId={clientId} rows={rates} canWrite={canWrite} />
    </>
  );
}

function SettingsView({
  settings,
  rates,
}: {
  settings: TimesheetInvoicingSettings;
  rates: TimesheetRateRow[];
}) {
  const none = <span className="muted">Not set</span>;
  return (
    <div className="kv">
      <span className="k">Invoiced from</span>
      <span className="stack tight">
        <span>{MODE_LABEL[settings.mode]}</span>
        <ModeNote mode={settings.mode} />
      </span>
      <span className="k">Format</span>
      <span>{FORMAT_LABEL[settings.format]}</span>
      <span className="k">Display name</span>
      <span>{settings.displayName ?? none}</span>
      <span className="k">Venue</span>
      <span>{settings.venue ?? none}</span>
      <span className="k">Venue address</span>
      <span className="inv-address">{settings.venueAddress ?? none}</span>
      <span className="k">Date column header</span>
      <span>{settings.dateLabel ?? <span className="muted">Date (default)</span>}</span>
      <span className="k">Email subject</span>
      <span>
        {settings.omitEventDates
          ? 'Event dates left out of the subject'
          : 'Event dates in brackets, e.g. “(15th, 17th October)”'}
      </span>
      <span className="k">Default role</span>
      <span className="stack tight">
        <span>{settings.defaultRole ?? none}</span>
        {settings.defaultRole && !defaultRoleOnCard(settings.defaultRole, rates) ? (
          <span className="rp-amber xs">Not on the rate card below: a sheet with no role column gets no rate.</span>
        ) : null}
      </span>
      <span className="k">Excluded staff</span>
      <span>
        {settings.excludedStaff.length > 0 ? (
          <span className="row wrap">
            {settings.excludedStaff.map((name) => (
              <Chip key={name}>{name}</Chip>
            ))}
          </span>
        ) : (
          <span className="muted">None</span>
        )}
      </span>
      <span className="k">PO number</span>
      <span>{settings.poRequired ? 'Required on every invoice' : 'Optional'}</span>
      <span className="k">Payment terms</span>
      <span>
        {settings.paymentTermsDays === null ? (
          <span className="muted">Default terms</span>
        ) : (
          `${settings.paymentTermsDays} days`
        )}
      </span>
      <span className="k">Xero contact</span>
      <span className="mono">
        {settings.xeroContactId ?? (
          <span className="muted">Matched by name on the first invoice pushed</span>
        )}
      </span>
    </div>
  );
}

/** The ADR-0203 interaction, in words, beside the mode. */
function ModeNote({ mode }: { mode: InvoicingMode }) {
  return mode === 'timesheet' ? (
    <span className="muted xs">
      Its hours arrive as a timesheet (Invoices → Process timesheet). It is also left out of event
      invoicing (the “Invoicing” switch in General info), so the daily job never takes a number for
      it.
    </span>
  ) : (
    <span className="muted xs">
      Its events are invoiced automatically from the sign-in log (ADR-0176), unless it is left out of
      invoicing in General info.
    </span>
  );
}

function SettingsForm({
  clientId,
  settings,
  rates,
  excludedFromEvents,
  onDone,
}: {
  clientId: string;
  settings: TimesheetInvoicingSettings;
  rates: TimesheetRateRow[];
  excludedFromEvents: boolean;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<InvoicingMode>(settings.mode);
  const [format, setFormat] = useState<InvoiceFormat>(settings.format);
  const [displayName, setDisplayName] = useState(settings.displayName ?? '');
  const [venue, setVenue] = useState(settings.venue ?? '');
  const [venueAddress, setVenueAddress] = useState(settings.venueAddress ?? '');
  const [dateLabel, setDateLabel] = useState(settings.dateLabel ?? '');
  const [omit, setOmit] = useState(settings.omitEventDates);
  const [defaultRole, setDefaultRole] = useState(settings.defaultRole ?? '');
  const [staff, setStaff] = useState<string[]>(settings.excludedStaff);
  const [staffDraft, setStaffDraft] = useState('');
  const [poRequired, setPoRequired] = useState(settings.poRequired);
  const [terms, setTerms] = useState(settings.paymentTermsDays === null ? '' : String(settings.paymentTermsDays));
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  const addStaff = () => {
    // Several names can be pasted at once, one per line or comma-separated.
    const added = staffDraft.split(/[,;\n]/);
    setStaff(normaliseList([...staff, ...added]));
    setStaffDraft('');
  };

  const save = () => {
    const days = parseTerms(terms);
    if (days === 'invalid') {
      setError('Payment terms are a whole number of days from 0 to 120, or blank for the default.');
      return;
    }
    // A half-typed name is kept, not lost to Save.
    const excludedStaff = normaliseList(staffDraft.trim() ? [...staff, ...staffDraft.split(/[,;\n]/)] : staff);
    const input = {
      mode,
      format,
      displayName: displayName.trim(),
      venue: venue.trim(),
      venueAddress: venueAddress.trim(),
      dateLabel: dateLabel.trim(),
      omitEventDates: omit,
      defaultRole: defaultRole.trim(),
      excludedStaff,
      poRequired,
      paymentTermsDays: days,
    };
    const problem = settingsProblem(input);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    startSaving(async () => {
      const result = await saveTimesheetInvoicing(clientId, input);
      if (result.ok) {
        toast('Timesheet invoicing saved.', { tone: 'green' });
        onDone();
      } else setError(result.message);
    });
  };

  return (
    <div className="stack">
      <div className="stack tight">
        <span className="label">Invoiced from</span>
        <SegToggle<InvoicingMode>
          aria-label="Invoiced from"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'events', label: 'Events' },
            { value: 'timesheet', label: 'Timesheet' },
          ]}
        />
        <ModeNote mode={mode} />
        {mode === 'timesheet' && settings.mode !== 'timesheet' ? (
          <Alert tone="amber">
            Saving also sets this client to <b>left out of invoicing</b> (ADR-0203): its events stop
            being invoiced by the daily job. Invoices the system has already issued stay as they are.
          </Alert>
        ) : null}
        {mode === 'events' && settings.mode === 'timesheet' && excludedFromEvents ? (
          <Alert tone="amber">
            Moving back to Events does <b>not</b> put the client back into event invoicing. Turn off
            “Left out of invoicing” in General info if its events should be invoiced again.
          </Alert>
        ) : null}
      </div>

      <Select
        label="Format"
        value={format}
        onChange={(event) => setFormat(event.target.value as InvoiceFormat)}
        hint="Named staff prints a line per person. Role aggregated prints the same lines without names, with No. of staff."
      >
        <option value="named">{FORMAT_LABEL.named}</option>
        <option value="aggregated">{FORMAT_LABEL.aggregated}</option>
      </Select>

      <Input
        label="Display name"
        value={displayName}
        onChange={(event) => setDisplayName(event.target.value)}
        maxLength={NAME_MAX}
        hint="Printed under “Invoice to” and in the email subject. Blank uses the client name."
      />
      <Input
        label="Venue"
        value={venue}
        onChange={(event) => setVenue(event.target.value)}
        maxLength={NAME_MAX}
      />
      <Textarea
        label="Venue address"
        value={venueAddress}
        onChange={(event) => setVenueAddress(event.target.value)}
        rows={3}
        maxLength={1000}
      />
      <Input
        label="Date column header"
        value={dateLabel}
        onChange={(event) => setDateLabel(event.target.value)}
        maxLength={LABEL_MAX}
        placeholder="Date"
        hint="Blank prints “Date”. Use “W/C Date” for a weekly invoice, as Taster does."
      />
      <Checkbox checked={omit} onChange={setOmit}>
        Omit the event dates from the email subject{' '}
        <span className="muted">(drops “(15th, 17th October)”)</span>
      </Checkbox>

      <Input
        label="Default role"
        value={defaultRole}
        onChange={(event) => setDefaultRole(event.target.value)}
        list={`ts-roles-${clientId}`}
        maxLength={120}
        hint="For a timesheet with no role column. It must match a role (or alias) on the rate card."
      />
      <datalist id={`ts-roles-${clientId}`}>
        {rates.map((rate) => (
          <option key={rate.id} value={rate.role_name} />
        ))}
      </datalist>

      <div className="stack tight">
        <label className="label" htmlFor={`ts-staff-${clientId}`}>
          Excluded staff
        </label>
        <div className="row wrap">
          {staff.map((name) => (
            <Chip key={name} onRemove={() => setStaff(staff.filter((n) => n !== name))}>
              {name}
            </Chip>
          ))}
        </div>
        <div className="row">
          <input
            id={`ts-staff-${clientId}`}
            className="input"
            value={staffDraft}
            onChange={(event) => setStaffDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ',') {
                event.preventDefault();
                addStaff();
              }
            }}
            placeholder="Type a name and press Enter"
          />
          <Button onClick={addStaff} disabled={staffDraft.trim() === ''}>
            Add
          </Button>
        </div>
        <span className="hint">
          Non-THC staff on the sheet. Rows with these names are rejected automatically at review.
        </span>
      </div>

      <Checkbox checked={poRequired} onChange={setPoRequired}>
        A PO number is required on every invoice
      </Checkbox>
      <Input
        label="Payment terms (days)"
        inputMode="numeric"
        value={terms}
        onChange={(event) => setTerms(event.target.value)}
        maxLength={3}
        placeholder="Default"
        hint="Blank uses the platform's default terms. The due date is printed on the invoice."
      />

      <div className="kv">
        <span className="k">Xero contact</span>
        <span className="mono">{settings.xeroContactId ?? <span className="muted">Set by the first push</span>}</span>
      </div>

      {error ? <Alert tone="coral">{error}</Alert> : null}

      <div className="row">
        <Button tone="primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
        <Button onClick={onDone} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
