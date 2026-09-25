'use client';

import { useId, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { Alert, Button, Chip, Input, Note, Panel, Pill, Select, Textarea } from '@thc/ui';
import { UK_ZONE, eventStatus, forecastEvent, formatTimeIn, ukInputLabel } from '@thc/domain';
import { formatDayLong, relativeDayLabel, todayInUk, ukDateOf } from '../calendar';
import { RoleSection } from './RoleSection';
import { Switch } from './Switch';
import { ClientPolicies, SummaryPanel } from './SummaryPanel';
import {
  type EventDraft,
  type RoleDraft,
  canRemoveRole,
  canSave,
  defaultDressCode,
  draftIssues,
  draftWindow,
  editRole,
  effectiveDressCode,
  isResolvable,
  newRoleDraft,
  resolveRole,
  roleChanges,
} from '../draft';
import type { ClientOption, ReferenceData, SavedEvent } from '../data';
import type { EventInput } from '../actions';

export interface ShiftBuilderProps {
  mode: 'new' | 'edit';
  reference: ReferenceData;
  initial: EventDraft;
  /** The saved event, for the edit state's "was 17:00" hints and counts. */
  saved: SavedEvent | null;
  /** Confirmed and still-standing booking counts, per saved section id. */
  confirmed: Record<string, number>;
  booked: Record<string, number>;
  /** §3.2: the event has started, so nothing can be changed. */
  locked: boolean;
  save: (input: EventInput) => Promise<{ error: string } | { ok: true; id: string }>;
}

function toInput(draft: EventDraft, id: string | null): EventInput {
  return {
    id,
    clientId: draft.clientId,
    venueId: draft.venueId,
    title: draft.title,
    date: draft.date,
    poNumber: draft.poNumber,
    onsiteContact: draft.onsiteContact,
    notes: draft.notes,
    autoAssign: draft.autoAssign,
    roles: draft.roles.map((role) => ({
      id: role.id,
      roleId: role.roleId,
      start: role.start,
      end: role.end,
      headcount: role.headcount,
      buffer: role.buffer,
      chargeRate: role.chargeRate,
      payRate: role.payRate,
      dressCode: effectiveDressCode(role),
      autoAssign: role.autoAssign,
      allocationPerHour: role.allocationPerHour,
    })),
  };
}

/**
 * The Shift Builder — Scope §3.2, §3.4, §3.5, §1.8.
 *
 * Order of entry is the scope's: client → venue (address → geo point, type →
 * radius) → date and overall window → roles. The overall window only
 * PRE-FILLS each new role; every section then carries its own start and end,
 * and the event's own window is derived from them (RULE-18).
 */
export function ShiftBuilder({
  mode,
  reference,
  initial,
  saved,
  confirmed,
  booked,
  locked,
  save,
}: ShiftBuilderProps) {
  const [draft, setDraft] = useState<EventDraft>(initial);
  const [error, setError] = useState<string | null>(null);
  const fieldId = useId();
  const [pending, startTransition] = useTransition();

  const client: ClientOption | undefined = reference.clients.find((c) => c.id === draft.clientId);
  const venue = reference.venues.find((v) => v.id === draft.venueId);

  const issues = useMemo(() => draftIssues(draft), [draft]);
  const window = useMemo(() => draftWindow(draft), [draft]);
  const cancelled = Boolean(saved?.cancelledAt);
  const readOnly = locked || cancelled;
  const saveable = canSave(draft) && !readOnly;
  // §1.5, for the pill on a locked section: Ongoing green, Completed and
  // Cancelled neutral — the lock alone does not mean Ongoing.
  const status = eventStatus(window, saved?.cancelledAt ?? null);
  // "07:00 tomorrow" / "08:00 today" — the start the banners name.
  const startLabel = window
    ? `${formatTimeIn(window.startsAt, UK_ZONE)} ${relativeDayLabel(ukDateOf(window.startsAt), todayInUk())}`
    : null;

  const erroredRoles = [...issues.roles.values()].filter((list) => list.length > 0).length;
  // The summary's counts and its forecast read the SAME set — the sections
  // that resolve and carry no error — so "3 valid · 1 error" and
  // "17 (+3)" describe the same roles (shift-builder.html:220).
  const validSections = draft.roles.filter(
    (role) =>
      role.roleId &&
      isResolvable(draft.date, role) &&
      (issues.roles.get(role.key) ?? []).length === 0,
  );
  const validRoles = validSections.length;
  const headcount = validSections.reduce((sum, role) => sum + role.headcount, 0);
  const buffer = validSections.reduce((sum, role) => sum + role.buffer, 0);

  const forecast = useMemo(
    () =>
      forecastEvent(
        validSections.map((role) => ({
          ...resolveRole(role, draft.date),
          chargeRatePence: Math.round(role.chargeRate * 100),
          payRatePence: Math.round(role.payRate * 100),
        })),
      ),
    // validSections is derived from exactly these two.
    [draft, issues],
  );

  const originals = useMemo(
    () => new Map(initial.roles.filter((role) => role.id).map((role) => [role.id!, role])),
    [initial],
  );
  const dateChanged = mode === 'edit' && initial.date !== draft.date;

  function patchRole(key: string, patch: Partial<RoleDraft>) {
    setDraft((current) => ({
      ...current,
      roles: current.roles.map((role) => (role.key === key ? editRole(role, patch) : role)),
    }));
  }

  /**
   * Picking a client loads its rate card: charge rate and the dress-code list
   * for each role, plus the on-site contact from the client profile (§3.2).
   */
  function pickClient(clientId: string) {
    const picked = reference.clients.find((c) => c.id === clientId);
    setDraft((current) => ({
      ...current,
      clientId,
      onsiteContact: current.onsiteContact || (picked?.staffContactPoint ?? ''),
      roles: current.roles.map((role) => {
        const card = picked?.rateCard[role.roleId];
        return {
          ...role,
          chargeRate: card?.chargeRate ?? role.chargeRate,
          // §3.2: the code defaults to the new client's list for this role;
          // a value still on it, or the per-event override, is kept.
          dressCode: defaultDressCode(card?.dressCodes ?? [], role.dressCode),
        };
      }),
    }));
  }

  function pickRole(key: string, roleId: string) {
    const role = reference.roles.find((r) => r.id === roleId);
    patchRole(key, {
      roleId,
      payRate: role?.payRate ?? 0,
      chargeRate: client?.rateCard[roleId]?.chargeRate ?? 0,
      // §3.2 / §9.7: the client + role combination's first listed code.
      dressCode: defaultDressCode(client?.rateCard[roleId]?.dressCodes ?? []),
      dressCodeOther: '',
    });
  }

  function addRole() {
    setDraft((current) => ({ ...current, roles: [...current.roles, newRoleDraft(current, '')] }));
  }

  /**
   * Removing a section deletes the `shift_requirements` row, and bookings
   * cascade off it. A section with people on it is therefore never removed
   * here: the manager withdraws them on the event board first (§3.3, §3.6).
   */
  function removeRole(key: string) {
    const role = draft.roles.find((r) => r.key === key);
    if (!role || !canRemoveRole(role, booked)) return;
    setDraft((current) => ({ ...current, roles: current.roles.filter((r) => r.key !== key) }));
  }

  function onSave() {
    setError(null);
    startTransition(async () => {
      const result = await save(toInput(draft, saved?.id ?? null));
      if (result && 'error' in result) setError(result.error);
    });
  }

  // shift-builder.html:305 — every panel header says so while the form is locked.
  const lockedPill = readOnly ? <Pill>locked</Pill> : null;

  const changesByKey = new Map<string, Set<string>>();
  for (const role of draft.roles) {
    const original = role.id ? originals.get(role.id) : undefined;
    changesByKey.set(
      role.key,
      new Set(original ? roleChanges(original, role, dateChanged).changed : []),
    );
  }

  return (
    <div className={`builder${readOnly ? ' locked' : ''}`}>
      <div className="stack" style={{ gap: 16 }}>
        {reference.unavailable ? <Alert tone="coral">{reference.unavailable}</Alert> : null}

        {cancelled ? (
          <Alert tone="coral">
            <b>This event is cancelled.</b> A cancelled event is not edited — it stays on the record
            with its Cancelled status (§1.5, §3.2). Re-run it as a new event, or use Duplicate on
            the event board to copy the roles.
          </Alert>
        ) : null}

        {locked && !cancelled ? (
          <Alert tone="coral">
            <b>
              Editing is locked — {draft.title} started at {startLabel ?? 'its scheduled start'}.
            </b>{' '}
            Once the event has started, and for any past event, no field can be changed (§3.2). What
            is still possible is on the event board: Withdraw, No show / Get back, Cancel event,
            Send / Download documents.
          </Alert>
        ) : null}

        {mode === 'edit' && !readOnly ? (
          <Alert>
            <b>
              Editing {draft.title} · {formatDayLong(draft.date)}
              {draft.poNumber ? ` · PO ${draft.poNumber}` : ''}.
            </b>{' '}
            Allowed up to the event&rsquo;s start time{startLabel ? ` (${startLabel})` : ''}. Every
            field — venue, date and time, headcount, buffer, charge rate, dress code, PO Number — is
            editable the same way as at creation (§3.2).
          </Alert>
        ) : null}

        {error ? <Alert tone="coral">{error}</Alert> : null}

        <Panel
          title="1 · Client & venue"
          actions={
            <>
              <span className="muted sm">client → venue (address → geo point, type → radius)</span>
              {lockedPill}
            </>
          }
        >
          <div className="stack">
            <div className="f2">
              <Select
                label={
                  <>
                    Client <span className="coral">*</span>
                  </>
                }
                value={draft.clientId}
                // §3.2's editable list has no client on it: the policies
                // were copied from this client at creation and the rate card
                // priced every section (shift-builder.html:248, one option).
                disabled={readOnly || mode === 'edit'}
                onChange={(e) => pickClient(e.target.value)}
                hint={
                  mode === 'edit'
                    ? 'Set at creation — the rate card, dress codes and policies are this client\u2019s. To run it for another client, create a new event (§3.2).'
                    : "Loads this client's rate card, dress codes, on-site contact and policies."
                }
              >
                <option value="">Choose…</option>
                {reference.clients.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </Select>
              <Select
                label={
                  <>
                    Venue <span className="coral">*</span>
                  </>
                }
                value={draft.venueId}
                disabled={readOnly}
                onChange={(e) => setDraft((c) => ({ ...c, venueId: e.target.value }))}
                hint={
                  mode === 'edit' ? (
                    <span className="amber">
                      Changing the venue address triggers re-confirmation for everyone booked
                      (§3.5).
                    </span>
                  ) : (
                    'From the Venues directory. Address and geofence come with it, read-only here.'
                  )
                }
              >
                <option value="">Choose…</option>
                {reference.venues.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name} — {option.address}
                  </option>
                ))}
              </Select>
            </div>

            <div className="f3">
              <div className="field">
                <label className="label" htmlFor={`${fieldId}-address`}>
                  Address
                </label>
                <input
                  id={`${fieldId}-address`}
                  className="input readonly"
                  readOnly
                  value={venue?.address ?? '—'}
                />
              </div>
              <div className="field">
                <label className="label" htmlFor={`${fieldId}-venue-type`}>
                  Venue type
                </label>
                <input
                  id={`${fieldId}-venue-type`}
                  className="input readonly"
                  readOnly
                  value={venue?.venueTypeLabel ?? '—'}
                />
              </div>
              <div className="field">
                <label className="label" htmlFor={`${fieldId}-radius`}>
                  Geofence radius
                </label>
                <input
                  id={`${fieldId}-radius`}
                  className="input readonly mono"
                  readOnly
                  value={venue ? `${venue.geofenceRadiusM} m` : '—'}
                />
                <span className="hint">Set on the venue, not per event (§9.11).</span>
              </div>
            </div>

            <div className="f2">
              <Input
                label={
                  <>
                    Event title <span className="coral">*</span>
                  </>
                }
                value={draft.title}
                disabled={readOnly}
                onChange={(e) => setDraft((c) => ({ ...c, title: e.target.value }))}
              />
              {/* Manual, optional, no format or uniqueness rule; editable any
                  time, also long after creation (§3.2). */}
              <Input
                label="PO Number"
                mono
                value={draft.poNumber}
                disabled={readOnly}
                placeholder="Optional — as given by the client"
                onChange={(e) => setDraft((c) => ({ ...c, poNumber: e.target.value }))}
                hint={
                  mode === 'edit'
                    ? 'Applies silently — no re-confirmation.'
                    : 'Free text, optional, no format or uniqueness rule; can be added or edited any time, also after creation (§3.2).'
                }
              />
            </div>
          </div>
        </Panel>

        <Panel
          title="2 · Date & overall window"
          actions={
            <>
              <span className="muted sm">
                every role added below is pre-filled with this window, then edited independently
              </span>
              {lockedPill}
            </>
          }
        >
          <div className="stack">
            <div className="f3">
              <Input
                label={
                  <>
                    Date <span className="coral">*</span>
                  </>
                }
                type="date"
                mono
                value={draft.date}
                disabled={readOnly}
                onChange={(e) => setDraft((c) => ({ ...c, date: e.target.value }))}
              />
              <Input
                label={
                  <>
                    {ukInputLabel('Overall start')} <span className="coral">*</span>
                  </>
                }
                type="time"
                mono
                value={draft.overallStart}
                disabled={readOnly}
                onChange={(e) => setDraft((c) => ({ ...c, overallStart: e.target.value }))}
              />
              <Input
                label={
                  <>
                    {ukInputLabel('Overall end')} <span className="coral">*</span>
                  </>
                }
                type="time"
                mono
                value={draft.overallEnd}
                disabled={readOnly}
                onChange={(e) => setDraft((c) => ({ ...c, overallEnd: e.target.value }))}
                hint="A role may end after midnight (e.g. 17:00–01:30)."
              />
            </div>
            <Note>
              Every field where a manager <b>types</b> a time carries &ldquo;(UK time)&rdquo; — the
              server reads a zoneless value as Europe/London (§1.8). The saved event window is
              derived from the roles: earliest start → latest end (RULE-18); the overall window
              above is only the pre-fill.
            </Note>
          </div>
        </Panel>

        <Panel
          title="3 · Roles"
          actions={
            <>
              <span className="muted sm">
                one section per role, each with its own start and end (RULE-18)
              </span>
              <Button size="sm" onClick={addRole} disabled={readOnly}>
                + Add role
              </Button>
              {lockedPill}
            </>
          }
        >
          <div className="stack">
            {draft.roles.length === 0 ? (
              <Note tone="amber">
                An event needs at least one role section. Each one is pre-filled with the overall
                window above and then edited on its own.
              </Note>
            ) : null}

            {draft.roles.map((role, index) => (
              <RoleSection
                key={role.key}
                index={index}
                role={role}
                date={draft.date}
                issues={issues.roles.get(role.key) ?? []}
                roles={reference.roles}
                client={client}
                confirmed={role.id ? (confirmed[role.id] ?? 0) : 0}
                changed={changesByKey.get(role.key) ?? new Set()}
                original={role.id ? originals.get(role.id) : undefined}
                mode={mode}
                booked={role.id ? (booked[role.id] ?? 0) : 0}
                locked={readOnly}
                status={status}
                onChange={(patch) =>
                  patch.roleId !== undefined
                    ? pickRole(role.key, patch.roleId)
                    : patchRole(role.key, patch)
                }
                onRemove={() => removeRole(role.key)}
              />
            ))}
          </div>
        </Panel>

        <Panel title="4 · On-site contact & instructions" actions={lockedPill}>
          <div className="stack">
            <div className="f2">
              <Input
                label="On-site contact"
                value={draft.onsiteContact}
                disabled={readOnly}
                onChange={(e) => setDraft((c) => ({ ...c, onsiteContact: e.target.value }))}
                hint={
                  'Pre-filled from the client profile ("Staff contact point"), editable per event.'
                }
              />
              <div className="field">
                <span className="label">Allocation sheet recipients</span>
                <div className="row wrap">
                  {(client?.contactEmails ?? []).map((email) => (
                    <Chip key={email}>{email}</Chip>
                  ))}
                  {(client?.contactEmails ?? []).length === 0 ? (
                    <span className="muted sm">Choose a client to load its recipients.</span>
                  ) : null}
                </div>
                <span className="hint">
                  From the client card — where &ldquo;Send allocation sheet&rdquo; goes (§11.4).
                </span>
              </div>
            </div>
            <Textarea
              label="Notes / specific instructions"
              rows={3}
              value={draft.notes}
              disabled={readOnly}
              onChange={(e) => setDraft((c) => ({ ...c, notes: e.target.value }))}
              hint="Visible to staff on their shift details in the app (§10.4) — entrance, parking, a specific ask from the client."
            />
          </div>
        </Panel>
      </div>

      <div className="side">
        {client ? (
          <ClientPolicies
            clientId={client.id}
            clientName={client.name}
            paysBreaks={client.paysBreaks}
            paysBuffer={client.paysBuffer}
          />
        ) : null}

        <SummaryPanel
          window={window}
          validRoles={validRoles}
          erroredRoles={erroredRoles}
          headcount={headcount}
          buffer={buffer}
          forecast={forecast}
        />

        {mode === 'edit' && !readOnly ? (
          <Panel title="What triggers re-confirmation" actions={<Pill>§3.5</Pill>}>
            <div className="stack tight sm">
              <div>
                <span className="amber">▲</span> Start or end time of a role · date · venue address
                · dress code → everyone booked on <b>that role</b> re-confirms (push N11).
              </div>
              <div>
                <span className="muted">○</span> Headcount · buffer · charge rate · PO Number ·
                notes → applied silently.
              </div>
            </div>
          </Panel>
        ) : null}

        {mode === 'edit' ? (
          <Panel title="Duplicate">
            <span className="sm muted">
              Multi-day = separate events created via <b>Duplicate</b> on the event board. The clone
              copies the roles (times, headcount, buffer, rates, dress code), <b>not the staff</b>,
              and starts filling from zero (§3.2).
            </span>
          </Panel>
        ) : null}

        {!readOnly ? (
          <Panel
            title="Auto-assign"
            actions={
              <Switch
                checked={draft.autoAssign}
                // The event switch never rewrites the role switches: §3.4
                // allows auto-assign to be off at EITHER level, and the
                // wireframe's Host role is off because the client asked for a
                // named person. Flicking this must not undo that.
                onChange={(autoAssign) => setDraft((c) => ({ ...c, autoAssign }))}
                label="Event level"
              />
            }
          >
            <span className="sm muted">
              Default ON at event and role level. From the moment the event is saved, auto-assign
              adds <i>allocation</i> invites every hour (at :17) in score order — qualified staff
              first (RULE-17) — until headcount + buffer is filled (§3.4). Turn a role off when the
              client asks for a specific person.
            </span>
          </Panel>
        ) : null}

        <div className="stack tight">
          {readOnly ? (
            <>
              <Link className="btn primary lg block keep" href={`/events/${saved?.id ?? ''}`}>
                Open event board →
              </Link>
              <Link className="btn block keep" href="/events">
                Back to scheduling
              </Link>
              <Button size="lg" block disabled>
                Save event
              </Button>
            </>
          ) : (
            <>
              <Button
                tone="primary"
                size="lg"
                block
                disabled={!saveable || pending}
                onClick={onSave}
              >
                {pending ? 'Saving…' : 'Save event'}
              </Button>
              <Link className="btn block" href={saved ? `/events/${saved.id}` : '/events'}>
                Cancel
              </Link>
              {!saveable ? (
                <span className="muted xs" data-testid="save-blockers">
                  {issues.event.length > 0
                    ? issues.event.join(' · ')
                    : 'Save is disabled while a role section fails validation.'}
                </span>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
