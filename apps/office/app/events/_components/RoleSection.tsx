'use client';

import { useId, useState } from 'react';
import { Alert, Button, Input, Pill, Select } from '@thc/ui';
import {
  type EditableField,
  ROLE_SECTION_MESSAGE,
  type RoleSectionIssue,
  defaultAllocationPerHour,
  finalHourlyPence,
  formatAllocationPair,
  formatConfirmationTarget,
  formatHours,
  marginPerHourPence,
  reconfirmingChanges,
  sectionHours,
  ukInputLabel,
} from '@thc/domain';
import { Switch } from './Switch';
import { DRESS_CODE_OTHER, type RoleDraft, isResolvable, resolveRole } from '../draft';
import type { ClientOption, RoleOption } from '../data';

const money = (pounds: number) => pounds.toFixed(2);

const classes = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(' ');

function signedPence(pence: number): string {
  const sign = pence < 0 ? '−' : '+';
  return `${sign}£${(Math.abs(pence) / 100).toFixed(2)}/h`;
}

export interface RoleSectionProps {
  mode: 'new' | 'edit';
  index: number;
  role: RoleDraft;
  date: string;
  issues: RoleSectionIssue[];
  roles: RoleOption[];
  client: ClientOption | undefined;
  /** Confirmed bookings on this section — the people a time change re-asks. */
  confirmed: number;
  /** Every booking still standing on this section, invited ones included. */
  booked: number;
  /** The fields that differ from the saved version, for the amber hints. */
  changed: Set<string>;
  original: RoleDraft | undefined;
  locked: boolean;
  onChange: (patch: Partial<RoleDraft>) => void;
  onRemove: () => void;
}

export function RoleSection({
  mode,
  index,
  role,
  date,
  issues,
  roles,
  client,
  confirmed,
  booked,
  changed,
  original,
  locked,
  onChange,
  onRemove,
}: RoleSectionProps) {
  const roleName = roles.find((r) => r.id === role.roleId)?.name ?? 'Choose a role';
  const resolvable = isResolvable(date, role);
  const hours = resolvable ? sectionHours(resolveRole(role, date)) : null;
  const dressCodes = client?.rateCard[role.roleId]?.dressCodes ?? [];
  const margin = marginPerHourPence(
    Math.round(role.chargeRate * 100),
    Math.round(role.payRate * 100),
  );
  const finalRatePence = finalHourlyPence(Math.round(role.payRate * 100));

  // §3.2: the charge rate comes from the client's rate card. On a new event
  // it is read-only until the manager deliberately overrides it, so a typo
  // cannot quietly undercut the card.
  const [chargeOverride, setChargeOverride] = useState(false);
  const fieldId = useId();
  const cardRate = client?.rateCard[role.roleId]?.chargeRate;
  const chargeFromCard = mode === 'new' && !chargeOverride && cardRate !== undefined;

  const issueFor = (field: RoleSectionIssue) => (issues.includes(field) ? field : null);
  const lengthIssue = issueFor('below_minimum_hours') ?? issueFor('end_before_start');
  const reconfirming = reconfirmingChanges([...changed] as EditableField[]).length > 0;

  if (locked) {
    return (
      <div className="rolesec collapsed">
        <div className="rh">
          <span className="n">Role {index + 1}</span>
          <b>{roleName}</b>
          <span className="mono sm muted">
            {role.start} – {role.end}
          </span>
          <Pill>{formatAllocationPair(role.headcount, role.buffer)}</Pill>
          <div className="right">
            <Pill tone="green">Ongoing</Pill>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={classes('rolesec', issues.length > 0 && 'err', changed.size > 0 && 'changed')}>
      <div className="rh">
        <span className="n">Role {index + 1}</span>
        <b>{roleName}</b>
        <span className="mono sm muted">
          {role.start} – {role.end}
          {hours === null ? '' : ` · ${formatHours(hours)}`}
        </span>
        {/* Absolute buffer: "12 (+2)", never the total (§3.2). */}
        <Pill>{formatAllocationPair(role.headcount, role.buffer)}</Pill>
        {role.chargeRate > 0 ? (
          <span className={`mono sm ${margin >= 0 ? 'green' : 'coral'}`}>
            margin {signedPence(margin)}
          </span>
        ) : null}
        {reconfirming && confirmed > 0 ? (
          <Pill tone="amber">{confirmed} confirmed will be asked to re-confirm</Pill>
        ) : null}
        <div className="right">
          <Switch
            checked={role.autoAssign}
            onChange={(autoAssign) => onChange({ autoAssign })}
            label="Auto-assign"
          />
          <Button
            size="sm"
            tone="ghost"
            onClick={onRemove}
            disabled={booked > 0}
            title={
              booked > 0
                ? 'This section has people on it. Withdraw them on the event board first.'
                : undefined
            }
          >
            Remove
          </Button>
        </div>
      </div>

      <div className="rb">
        <div className="grid6">
          <Select
            label="Role"
            value={role.roleId}
            onChange={(e) => onChange({ roleId: e.target.value })}
          >
            <option value="">Choose…</option>
            {roles.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </Select>

          {/* Manager-typed times carry "(UK time)" — the server reads a
              zoneless value as Europe/London (§1.8). */}
          <Input
            label={ukInputLabel('Start')}
            type="time"
            mono
            value={role.start}
            onChange={(e) => onChange({ start: e.target.value })}
            {...(changed.has('starts_at') && original ? { hint: `was ${original.start}` } : {})}
          />
          <Input
            label={ukInputLabel('End')}
            type="time"
            mono
            value={role.end}
            onChange={(e) => onChange({ end: e.target.value })}
            {...(lengthIssue ? { error: ROLE_SECTION_MESSAGE[lengthIssue] } : {})}
            {...(!lengthIssue && changed.has('ends_at') && original
              ? { hint: `was ${original.end}` }
              : {})}
          />
          <Input
            label="Headcount"
            type="number"
            min={1}
            mono
            value={role.headcount}
            onChange={(e) => onChange({ headcount: Number(e.target.value) })}
            {...(issues.includes('headcount_below_one')
              ? { error: ROLE_SECTION_MESSAGE.headcount_below_one }
              : changed.has('headcount') && original
                ? { hint: `was ${original.headcount}` }
                : {})}
          />
          <Input
            label="Buffer"
            type="number"
            min={0}
            mono
            value={role.buffer}
            onChange={(e) => onChange({ buffer: Number(e.target.value) })}
            {...(issues.includes('negative_buffer')
              ? { error: ROLE_SECTION_MESSAGE.negative_buffer }
              : {
                  hint: `absolute, not % · shown as ${formatAllocationPair(role.headcount, role.buffer)}`,
                })}
          />

          <div className="field">
            <label className="label" htmlFor={`${fieldId}-charge`}>
              Charge rate
            </label>
            <div className="input-row">
              <span className="addon l">£</span>
              <input
                id={`${fieldId}-charge`}
                className={classes('input', 'mono', chargeFromCard && 'readonly')}
                type="number"
                step="0.01"
                min={0}
                readOnly={chargeFromCard}
                value={money(role.chargeRate)}
                onChange={(e) => onChange({ chargeRate: Number(e.target.value) })}
              />
            </div>
            <span className="hint">
              {client ? `${client.name} rate card` : 'From the rate card'}
              {chargeFromCard ? (
                <>
                  {' · '}
                  <button type="button" className="linkish" onClick={() => setChargeOverride(true)}>
                    override
                  </button>
                </>
              ) : null}
            </span>
          </div>

          <div className="field">
            <label className="label" htmlFor={`${fieldId}-pay`}>
              Pay rate (base)
            </label>
            <div className="input-row">
              <span className="addon l">£</span>
              <input
                id={`${fieldId}-pay`}
                className="input mono"
                type="number"
                step="0.01"
                min={0}
                value={money(role.payRate)}
                onChange={(e) => onChange({ payRate: Number(e.target.value) })}
              />
            </div>
            {/* Holiday is always broken out at 12.07%, never blended (§9.8). */}
            <span className="hint">final £{money(finalRatePence / 100)} (+12.07%)</span>
          </div>
        </div>

        <div className="f3">
          <Select
            label="Dress code"
            value={role.dressCode}
            onChange={(e) => onChange({ dressCode: e.target.value })}
            hint={
              dressCodes.length > 0
                ? `${client?.name}'s list for this role, plus "Other" for this event only`
                : 'No list on the rate card for this role yet — use "Other"'
            }
          >
            <option value="">Choose…</option>
            {dressCodes.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
            {/* An existing per-event override is not on the client's list. */}
            {role.dressCode &&
            role.dressCode !== DRESS_CODE_OTHER &&
            !dressCodes.includes(role.dressCode) ? (
              <option value={role.dressCode}>{role.dressCode}</option>
            ) : null}
            <option value={DRESS_CODE_OTHER}>Other…</option>
          </Select>

          {role.dressCode === DRESS_CODE_OTHER ? (
            <Input
              label="Other — dress code for this event only"
              value={role.dressCodeOther}
              onChange={(e) => onChange({ dressCodeOther: e.target.value })}
              hint="Not saved back to the client's list."
            />
          ) : null}

          <Input
            label="Allocation per hour"
            type="number"
            min={1}
            mono
            value={role.allocationPerHour}
            onChange={(e) => onChange({ allocationPerHour: Number(e.target.value) })}
            {...(issues.includes('allocation_below_one')
              ? { error: ROLE_SECTION_MESSAGE.allocation_below_one }
              : {
                  hint: `Invites per hourly round · default headcount + buffer = ${defaultAllocationPerHour(
                    role.headcount,
                    role.buffer,
                  )} · editable`,
                })}
          />

          <div className="field">
            <label className="label" htmlFor={`${fieldId}-target`}>
              Confirmation target
            </label>
            <input
              id={`${fieldId}-target`}
              className="input readonly mono"
              readOnly
              value={formatConfirmationTarget(role.headcount, role.buffer)}
            />
            <span className="hint">Buffer is part of the target, not the working headcount.</span>
          </div>
        </div>

        {lengthIssue === 'below_minimum_hours' ? (
          <Alert tone="coral">
            This role section cannot be saved: its end time is less than 4 hours after its own
            start. A role may end after midnight, but its end can never fall before its start on the
            same calendar day.
          </Alert>
        ) : null}

        {lengthIssue === 'end_before_start' ? (
          <Alert tone="coral">
            This role section cannot be saved: its end falls before its own start.
          </Alert>
        ) : null}

        {reconfirming && confirmed > 0 ? (
          <Alert>
            <b>
              {changed.has('dress_code') && !changed.has('starts_at') && !changed.has('ends_at')
                ? 'Dress code changed for this role only'
                : 'Time changed for this role only'}
            </b>{' '}
            → the {confirmed} worker{confirmed === 1 ? '' : 's'} confirmed on {roleName} move to
            &ldquo;Awaiting&rdquo; and get push N11 (&ldquo;Time Changed&rdquo; tag + &ldquo;Confirm
            new time&rdquo;). The other role sections are untouched.
          </Alert>
        ) : null}

        {changed.has('headcount') && original && role.headcount < confirmed ? (
          <Alert tone="cyan">
            <b>
              Headcount {original.headcount} → {role.headcount} with {confirmed} confirmed:
            </b>{' '}
            nobody is auto-removed. The manager withdraws people by hand on the event board.
          </Alert>
        ) : null}
      </div>
    </div>
  );
}
