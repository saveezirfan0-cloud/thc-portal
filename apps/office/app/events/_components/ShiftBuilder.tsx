'use client';

import { useEffect, useId, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import {
  Alert,
  Button,
  Checkbox,
  Chip,
  Input,
  Note,
  Panel,
  SaveBar,
  Select,
  Textarea,
  TimeField,
  UkDateField,
  useTimeFormat,
  useUnsavedChanges,
} from '@thc/ui';
import {
  LATE_SECTION_MESSAGE,
  UK_ZONE,
  canAddSectionAfterStart,
  clockLabel,
  extraLanguages,
  forecastEvent,
  formatLanguages,
  formatTimeIn,
  isRealIsoDate,
  ukInputLabel,
  ukToday,
} from '@thc/domain';
import { LanguagePicker } from '../../_components/LanguagePicker';
import { useConfirm } from '../../_components/useConfirm';
import { formatDayLong } from '../calendar';
import { RoleSection } from './RoleSection';
import { Switch } from './Switch';
import { ClientPolicies, SummaryPanel } from './SummaryPanel';
import {
  DRESS_CODE_OTHER,
  defaultDressCode,
  type EventDraft,
  type RoleDraft,
  canRemoveRole,
  canSave,
  draftIssues,
  draftWindow,
  editRole,
  effectiveDressCode,
  isResolvable,
  newRoleDraft,
  pastDateIssue,
  resolveRole,
  roleChanges,
  securityClearedToTell,
  seriesContextFor,
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
  /** Of `booked`, confirmed or worked — what keeps Remove off (ADR-0160). */
  held: Record<string, number>;
  /** §3.2: the event has started, so nothing already saved can be changed. */
  locked: boolean;
  /**
   * ADR-0177: the event has started but is not cancelled or over for the
   * day, so a NEW role section starting later than now may still be added.
   * Saved sections and the event's own fields stay locked.
   */
  canAddRoles?: boolean;
  /**
   * ADR-0061: may the viewer see pay and charge rates (`office_can('finance')`)?
   * False for a scheduler: no rate, charge, margin or forecast money is
   * drawn, none is sent on save, and the database gives their sections the
   * catalogue rates.
   */
  ratesVisible: boolean;
  save: (input: EventInput) => Promise<{ error: string } | { ok: true; id: string }>;
}

function toInput(draft: EventDraft, id: string | null, ratesVisible: boolean): EventInput {
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
    requiredLanguages: draft.requiredLanguages,
    securityCleared: draft.securityCleared,
    duplicateOf: draft.duplicateOf,
    roles: draft.roles.map((role) => ({
      id: role.id,
      roleId: role.roleId,
      start: role.start,
      end: role.end,
      headcount: role.headcount,
      buffer: role.buffer,
      chargeRate: ratesVisible ? role.chargeRate : null,
      payRate: ratesVisible ? role.payRate : null,
      dressCode: effectiveDressCode(role),
      autoAssign: role.autoAssign,
      requiredGender: role.requiredGender,
      sameStaffAllDays: role.sameStaffAllDays,
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
  held,
  locked,
  canAddRoles = false,
  ratesVisible,
  save,
}: ShiftBuilderProps) {
  const format = useTimeFormat();
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
  // ADR-0177: a started event that still takes new role sections.
  const addOnly = readOnly && canAddRoles && !cancelled;
  const addedRoles = draft.roles.filter((role) => !role.id);
  const lateIssue =
    addOnly &&
    addedRoles.some(
      (role) =>
        isResolvable(draft.date, role) && !canAddSectionAfterStart(resolveRole(role, draft.date)),
    )
      ? LATE_SECTION_MESSAGE
      : null;
  // Release audit: a NEW event dated before today was accepted, and its
  // board then refused every invite. Editing an existing past event is
  // the locked state above, unchanged.
  const pastDate = mode === 'new' ? pastDateIssue(draft.date, ukToday()) : null;
  const saveable = addOnly
    ? addedRoles.length > 0 && canSave(draft) && lateIssue === null
    : canSave(draft) && !readOnly && pastDate === null;
  // The save bar says "Unsaved changes" once the form differs from what it
  // opened with, and the guard below holds a way out while it does.
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(initial), [draft, initial]);
  const guard = useUnsavedChanges(dirty && (!readOnly || addOnly) && !pending, {
    message:
      mode === 'new'
        ? 'The event you are building has not been saved. Leave and it is lost.'
        : 'Your changes to this event have not been saved. Leave and they are lost.',
  });
  // Release audit E-M3: a save redirects to the event board, and the board
  // opened at the scroll position the form was left at. A builder that is
  // unmounted by its own successful save puts the window back at the top.
  const leavingAfterSave = useRef(false);
  useEffect(
    () => () => {
      if (leavingAfterSave.current) globalThis.window.scrollTo(0, 0);
    },
    [],
  );

  const erroredRoles = [...issues.roles.values()].filter((list) => list.length > 0).length;
  const validRoles = draft.roles.filter(
    (role) =>
      role.roleId &&
      isResolvable(draft.date, role) &&
      (issues.roles.get(role.key) ?? []).length === 0,
  ).length;
  const headcount = draft.roles.reduce((sum, role) => sum + role.headcount, 0);
  // ADR-0080: the languages besides English, and whether this edit added
  // one — only an addition can shut out someone already booked.
  const languagesAdded = extraLanguages(draft.requiredLanguages);
  const savedLanguages = extraLanguages(initial.requiredLanguages);
  const languagesChanged =
    mode === 'edit' && languagesAdded.some((language) => !savedLanguages.includes(language));
  const bookedTotal = Object.values(booked).reduce((sum, n) => sum + n, 0);
  // ADR-0185: ticking Security cleared on a saved event tells everyone already
  // confirmed on it to bring ID, so say how many before the office saves.
  const confirmedTotal = Object.values(confirmed).reduce((sum, n) => sum + n, 0);
  const securityTold = securityClearedToTell(initial, draft, confirmedTotal);
  const buffer = draft.roles.reduce((sum, role) => sum + role.buffer, 0);

  const forecast = useMemo(
    () =>
      forecastEvent(
        draft.roles
          .filter(
            (role) =>
              role.roleId &&
              isResolvable(draft.date, role) &&
              (issues.roles.get(role.key) ?? []).length === 0,
          )
          .map((role) => ({
            ...resolveRole(role, draft.date),
            chargeRatePence: Math.round(role.chargeRate * 100),
            payRatePence: Math.round(role.payRate * 100),
          })),
      ),
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
      roles: current.roles.map((role) =>
        role.key === key ? editRole(role, patch, reference.bufferRule) : role,
      ),
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
        const stillOnList =
          role.dressCode === DRESS_CODE_OTHER || (card?.dressCodes ?? []).includes(role.dressCode);
        return {
          ...role,
          chargeRate: card?.chargeRate ?? role.chargeRate,
          dressCode:
            stillOnList && role.dressCode
              ? role.dressCode
              : defaultDressCode(card?.dressCodes ?? []),
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
      dressCode: defaultDressCode(client?.rateCard[roleId]?.dressCodes ?? []),
      dressCodeOther: '',
    });
  }

  function addRole() {
    setDraft((current) => ({
      ...current,
      roles: [...current.roles, newRoleDraft(current, '', 0, reference.bufferRule)],
    }));
  }

  /**
   * Removing a section deletes the `shift_requirements` row on save, and
   * bookings cascade off it. A section with anyone confirmed on it is never
   * removed here: the manager withdraws them on the event board first
   * (§3.3, §3.6). Pending invitations and applications do not hold it — the
   * save closes them and tells each worker (ADR-0160), so the manager is
   * asked first.
   */
  const removeConfirm = useConfirm();
  function removeRole(key: string) {
    const role = draft.roles.find((r) => r.key === key);
    if (!role || !canRemoveRole(role, held)) return;
    const drop = () =>
      setDraft((current) => ({ ...current, roles: current.roles.filter((r) => r.key !== key) }));
    const waiting = role.id ? (booked[role.id] ?? 0) - (held[role.id] ?? 0) : 0;
    if (waiting <= 0) {
      drop();
      return;
    }
    const roleName = reference.roles.find((r) => r.id === role.roleId)?.name ?? 'this role';
    removeConfirm.ask({
      title: `Remove ${roleName}?`,
      body: (
        <>
          Nobody is confirmed on it, but {waiting} {waiting === 1 ? 'worker has' : 'workers have'} a
          pending invitation or application. When you save, {waiting === 1 ? 'it is' : 'they are'}{' '}
          closed and each worker is told by push that the shift is no longer needed.
        </>
      ),
      confirm: 'Remove role',
      onConfirm: drop,
    });
  }

  function onSave() {
    setError(null);
    leavingAfterSave.current = true;
    startTransition(async () => {
      const result = await save(toInput(draft, saved?.id ?? null, ratesVisible));
      if (result && 'error' in result) {
        leavingAfterSave.current = false;
        setError(result.error);
      }
    });
  }

  const seriesContext = seriesContextFor(draft, saved);

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
            with its Cancelled status. Re-run it as a new event, or{' '}
            <Link href={`/events/new?from=${saved?.id ?? ''}`}>duplicate it</Link> to copy the
            roles.
          </Alert>
        ) : null}

        {locked && !cancelled ? (
          <Alert tone="coral">
            <b>
              Editing is locked — {draft.title} started at{' '}
              {window
                ? `${formatTimeIn(window.startsAt, UK_ZONE, format)} (UK)`
                : 'its scheduled start'}
              .
            </b>{' '}
            {addOnly ? (
              <>
                What is already saved cannot be changed, but you can still <b>add a new role</b>{' '}
                that starts later than now — for a client&rsquo;s same-day request. Use{' '}
                <b>+ Add role</b> below, then save.
              </>
            ) : (
              <>
                Once the event has started, and for any past event, no field can be changed. What is
                still possible is on the event board: Withdraw, No show / Get back, Cancel event,
                Send / Download documents.
              </>
            )}
          </Alert>
        ) : null}

        {mode === 'edit' && !readOnly ? (
          <Alert>
            <b>
              {/* "Thu 22 Oct 2026", as event dates are written (§1.8), never
                  the ISO "2026-10-22" (release audit p3). */}
              Editing {draft.title} ·{' '}
              {isRealIsoDate(draft.date) ? formatDayLong(draft.date) : draft.date}
              {draft.poNumber ? ` · PO ${draft.poNumber}` : ''}.
            </b>{' '}
            Allowed up to the event&rsquo;s start. Every field — venue, date and time, headcount,
            buffer, {ratesVisible ? 'charge rate, ' : ''}dress code, PO Number — is editable the
            same way as at creation.
          </Alert>
        ) : null}

        {error ? <Alert tone="coral">{error}</Alert> : null}

        <Panel
          title="1 · Client & venue"
          actions={
            <span className="muted sm">client → venue (address → geo point, type → radius)</span>
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
                disabled={readOnly}
                onChange={(e) => pickClient(e.target.value)}
                hint="Loads this client's rate card, dress codes, on-site contact and policies."
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
                      Changing the venue address triggers re-confirmation for everyone booked.
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
                <span className="hint">Set on the venue, not per event.</span>
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
                hint="Free text, optional, no format or uniqueness rule; can be added or edited any time."
              />
            </div>
          </div>
        </Panel>

        <Panel
          title="2 · Date & overall window"
          actions={
            <span className="muted sm">
              every role added below is pre-filled with this window, then edited independently
            </span>
          }
        >
          <div className="stack">
            <div className="f3">
              {/* dd/mm/yyyy whatever the device's locale (ADR-0140). */}
              <UkDateField
                label={
                  <>
                    Date <span className="coral">*</span>
                  </>
                }
                value={draft.date}
                disabled={readOnly}
                error={pastDate}
                min={mode === 'new' ? ukToday() : undefined}
                onChange={(date) => setDraft((c) => ({ ...c, date }))}
              />
              <TimeField
                label={
                  <>
                    {ukInputLabel('Overall start')} <span className="coral">*</span>
                  </>
                }
                value={draft.overallStart}
                disabled={readOnly}
                onChange={(overallStart) => setDraft((c) => ({ ...c, overallStart }))}
              />
              <TimeField
                label={
                  <>
                    {ukInputLabel('Overall end')} <span className="coral">*</span>
                  </>
                }
                value={draft.overallEnd}
                disabled={readOnly}
                onChange={(overallEnd) => setDraft((c) => ({ ...c, overallEnd }))}
                hint={`A role may end after midnight (e.g. ${clockLabel('17:00', format)}–${clockLabel('01:30', format)}).`}
              />
            </div>
            <Note>
              Every field where a manager <b>types</b> a time carries &ldquo;(UK time)&rdquo; — the
              server reads a zoneless value as Europe/London. The saved event window is derived from
              the roles: earliest start → latest end; the overall window above is only the pre-fill.
            </Note>
          </div>
        </Panel>

        <Panel
          title="3 · Roles"
          actions={
            <>
              <span className="muted sm">
                one section per role, each with its own start and end
              </span>
              <Button size="sm" onClick={addRole} disabled={readOnly && !addOnly}>
                + Add role
              </Button>
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
                ratesVisible={ratesVisible}
                booked={role.id ? (booked[role.id] ?? 0) : 0}
                held={role.id ? (held[role.id] ?? 0) : 0}
                locked={readOnly && !(addOnly && !role.id)}
                series={seriesContext}
                bufferRule={reference.bufferRule}
                {...(saved?.id ? { boardHref: `/events/${saved.id}` } : {})}
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

        <Panel title="4 · On-site contact & instructions">
          <div className="stack">
            {/* ADR-0080: English by default; any other language the client
                needs is a hard gate in auto_assign_candidates, so every path
                that books someone holds to it — rounds, Radar, offers,
                Accept and a manual invite. */}
            <LanguagePicker
              label="Languages staff must speak"
              value={draft.requiredLanguages}
              disabled={readOnly}
              onChange={(requiredLanguages) => setDraft((c) => ({ ...c, requiredLanguages }))}
              hint={
                languagesAdded.length > 0
                  ? `Only staff who speak ${formatLanguages(languagesAdded)} are invited or see it on Radar. Staff with no languages on file are left out.`
                  : 'English by default. Add a language only when the client asks for it.'
              }
            />
            {languagesChanged && languagesAdded.length > 0 && bookedTotal > 0 ? (
              <Alert tone="cyan">
                <b>Already booked staff are not removed.</b> Open invitations stay open but can only
                be accepted by staff who speak {formatLanguages(languagesAdded)}; withdraw anyone
                else on the event board.
              </Alert>
            ) : null}
            {/* ADR-0185: a tick box, not a gate. Nobody is refused a booking for
                it and check-in is unchanged; each worker confirmed on the event
                is pushed SC1 and sees the note on their shift. */}
            <div className="field">
              <Checkbox
                checked={draft.securityCleared}
                disabled={readOnly}
                onChange={(securityCleared) => setDraft((c) => ({ ...c, securityCleared }))}
              >
                <b>Security cleared event</b> — staff must bring a passport or driving licence
              </Checkbox>
              <span className="hint">
                Each worker is told to bring it when they are confirmed on the event, and the
                reminder shows on their shift.
              </span>
            </div>
            {securityTold > 0 ? (
              <Alert tone="cyan">
                <b>
                  {securityTold} confirmed {securityTold === 1 ? 'worker is' : 'workers are'} told
                  when you save.
                </b>{' '}
                They get a notification to bring a passport or driving licence.
              </Alert>
            ) : null}
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
                <span className="label">Allocation Timesheet recipients</span>
                <div className="row wrap">
                  {(client?.contactEmails ?? []).map((email) => (
                    <Chip key={email}>{email}</Chip>
                  ))}
                  {(client?.contactEmails ?? []).length === 0 ? (
                    <span className="muted sm">Choose a client to load its recipients.</span>
                  ) : null}
                </div>
                <span className="hint">
                  From the client card — where &ldquo;Send Allocation Timesheet&rdquo; goes.
                </span>
              </div>
            </div>
            <Textarea
              label="Notes / specific instructions"
              rows={3}
              value={draft.notes}
              disabled={readOnly}
              onChange={(e) => setDraft((c) => ({ ...c, notes: e.target.value }))}
              hint="Visible to staff on their shift details in the app — entrance, parking, a specific ask from the client."
            />
          </div>
        </Panel>
      </div>

      <div className="side">
        {client ? (
          <ClientPolicies
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
          ratesVisible={ratesVisible}
        />

        {mode === 'edit' && !readOnly ? (
          <Panel title="What triggers re-confirmation">
            <div className="stack tight sm">
              <div>
                <span className="amber">▲</span> Start or end time of a role · date · venue address
                · dress code → everyone booked on <b>that role</b> re-confirms (push N11).
              </div>
              <div>
                <span className="muted">○</span> Headcount · buffer ·{' '}
                {ratesVisible ? 'charge rate · ' : ''}PO Number · notes · languages · security
                cleared → applied silently.
              </div>
            </div>
          </Panel>
        ) : null}

        {mode === 'edit' && saved ? (
          <Panel
            title="Duplicate"
            actions={
              <Link className="btn sm" href={`/events/new?from=${saved.id}`}>
                Duplicate
              </Link>
            }
          >
            <span className="sm muted">
              Multi-day = separate events created via <b>Duplicate</b> on the event board. The clone
              copies the roles (times, headcount, buffer, {ratesVisible ? 'rates, ' : ''}dress
              code), <b>not the staff</b>, and starts filling from zero.
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
              first — until headcount + buffer is filled. Turn a role off when the client asks for a
              specific person.
            </span>
          </Panel>
        ) : null}

        {readOnly && !addOnly ? (
          <div className="stack tight">
            <Link className="btn primary lg block keep" href={`/events/${saved?.id ?? ''}`}>
              Open event board →
            </Link>
            <Link className="btn block keep" href="/events">
              Back to scheduling
            </Link>
            <Button size="lg" block disabled>
              Save event
            </Button>
          </div>
        ) : null}
      </div>

      {/* The save action rides at the bottom of the screen for the whole of
          a long form, instead of waiting at the end of the side column
          (below the fold on a phone, several screens down). Same buttons,
          same rules, same handler. */}
      {readOnly && !addOnly ? null : (
        <SaveBar
          label={addOnly ? 'Add role' : 'Save event'}
          dirty={dirty}
          status={pending ? 'Saving…' : undefined}
          hint={
            !saveable ? (
              <span data-testid="save-blockers">
                {issues.event.length > 0
                  ? issues.event.join(' · ')
                  : pastDate
                    ? pastDate
                    : lateIssue
                      ? lateIssue
                      : addOnly && addedRoles.length === 0
                        ? 'Add a role to save.'
                        : 'Save is disabled while a role section fails validation.'}
              </span>
            ) : undefined
          }
        >
          <Link className="btn" href={saved ? `/events/${saved.id}` : '/events'}>
            Cancel
          </Link>
          <Button tone="primary" disabled={!saveable || pending} onClick={onSave}>
            {pending ? 'Saving…' : addOnly ? 'Save new role' : 'Save event'}
          </Button>
        </SaveBar>
      )}
      {guard.dialog}
      {removeConfirm.dialog}
    </div>
  );
}
