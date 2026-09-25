'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import {
  Alert,
  Avatar,
  Button,
  Chip,
  Input,
  KpiTile,
  Modal,
  Pill,
  Select,
  Tabs,
  Textarea,
  TileGrid,
} from '@thc/ui';
import { OfficeShell } from '../../_components/OfficeShell';
import {
  RTW_LABEL,
  capReason,
  employeeId,
  formatRating,
  formatShowRate,
  formatUkDate,
} from '../staff';
import { Documents } from './Documents';
import { Feedback } from './Feedback';
import { Overview } from './Overview';
import { Qualifications } from './Qualifications';
import { Shifts } from './Shifts';
import { canReset, hoursTone, isActionable, noShowTone } from './profile';
import {
  addRole,
  blockWorker,
  removeRole,
  removeWorker,
  resetToCandidate,
  unblockWorker,
} from './actions';
import { resendActivationLink } from '../../onboarding/actions';
import { canResendActivation } from '../../onboarding/view-model';
import type { ProfileData, ProfileRow } from './types';
import './profile.css';

type Tab = 'overview' | 'documents' | 'qualification' | 'shifts' | 'feedback';
type Dialog = 'block' | 'reset' | 'remove' | null;

const STATUS_TONE: Record<string, 'green' | 'coral' | 'amber' | 'neutral'> = {
  compliant: 'green',
  blocked: 'coral',
  rejected: 'coral',
  removed: 'neutral',
  inactive: 'amber',
};

/**
 * /staff/:id — the worker profile (§9.6),
 * `wireframes/backoffice/staff-profile.html`.
 *
 * Three things this screen holds to.
 *
 * On a blocked profile the REASON comes first, above everything else.
 * §9.6: "When a manager later opens a blocked profile to decide whether
 * to unblock, they see the reason first." So it is a banner over the
 * header, not a field inside it.
 *
 * "Hours this week" is the calculated cap and the hours booked against
 * it, amber when the two meet — and the reason is on the tile, because
 * "20" and "48" mean different things depending on which rule produced
 * them (RULE-20).
 *
 * Every tab stays available on a blocked or removed profile. §9.6 wants
 * the history, show-rate, feedback and violations all in front of the
 * manager before they decide what to do with the record — and §1.7 keeps
 * a removed profile openable with its non-personal history intact.
 */
export function ProfileScreen({ data }: { data: ProfileData }) {
  const profile = data.profile as ProfileRow;
  const [tab, setTab] = useState<Tab>('overview');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [reason, setReason] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [addingRole, setAddingRole] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [resent, setResent] = useState(false);

  const actionable = isActionable(profile.status);
  const unheld = data.roles.filter((role) => !profile.role_names.includes(role.name));

  const run = (
    work: () => Promise<{ ok: true } | { ok: false; message: string }>,
    after?: () => void,
  ) => {
    setProblem(null);
    start(async () => {
      const result = await work();
      if (result.ok) after?.();
      else setProblem(result.message);
    });
  };

  const close = () => {
    setDialog(null);
    setReason('');
    setConfirmation('');
  };

  return (
    <OfficeShell
      activeHref="/staff"
      title="Staff"
      crumbs={
        <>
          <Link href="/staff">Directory</Link> / <b>{profile.display_name}</b> ·{' '}
          {employeeId(profile.employee_id)}
        </>
      }
    >
      <div className="stack">
        {problem ? <Alert tone="coral">{problem}</Alert> : null}

        {/*
          §9.6: the reason is shown first, before anything else, when a
          blocked profile is opened. An auto-block carries no reason by
          design (§4.3) and says which document instead.
        */}
        {profile.status === 'blocked' ? (
          <div className="blocklbl">
            <Pill tone="coral" large>
              Blocked
            </Pill>
            <span>
              <b>
                {profile.block_reason
                  ? `Blocked — ${profile.block_reason}`
                  : 'Blocked automatically — a document is out of date (§4.3)'}
              </b>
              <br />
              <span className="muted sm">
                {profile.block_kind === 'manual'
                  ? 'Manual block. Only a manager’s Unblock lifts it, and only after the full compliance check (§4.3). The worker never sees the reason.'
                  : 'System block: temporary, not a penalty. It lifts by itself once the document is verified and the full re-check passes (§4.3).'}
              </span>
            </span>
            <Button
              tone="primary"
              size="sm"
              className="ml-auto"
              disabled={pending}
              onClick={() => run(() => unblockWorker(profile.id))}
            >
              Unblock
            </Button>
          </div>
        ) : null}

        <div className="phead">
          <Avatar
            size="xl"
            name={profile.display_name}
            src={profile.removed ? undefined : (profile.photo_url ?? undefined)}
          />
          <div className="who">
            <div className="row wrap">
              <h2>{profile.display_name}</h2>
              <Pill tone={STATUS_TONE[profile.status] ?? 'neutral'} large>
                {profile.status}
              </Pill>
              <span className="mono sm muted">
                Employee ID <b className="cyan">{employeeId(profile.employee_id)}</b>
              </span>
            </div>
            <div className="facts">
              <span>
                Right to Work{' '}
                <b>
                  {profile.rtw_branch ? (RTW_LABEL[profile.rtw_branch] ?? profile.rtw_branch) : '—'}
                </b>
                {profile.right_to_work_until
                  ? ` · until ${formatUkDate(profile.right_to_work_until)}`
                  : ''}
              </span>
              <span>
                Weekly limit{' '}
                <b>
                  {capReason(
                    profile.weekly_cap_band,
                    profile.weekly_cap_hours,
                    profile.weekly_cap_until,
                  )}
                </b>
              </span>
              <span>
                Joined <b>{formatUkDate(profile.joined_at)}</b>
              </span>
              {profile.email ? <span>{profile.email}</span> : null}
              {profile.phone ? <span>{profile.phone}</span> : null}
            </div>
            <div className="roles-edit">
              <span className="label">Roles</span>
              {profile.role_names.length === 0 ? (
                <span className="muted sm">
                  None — this worker is invisible to every auto-assign round until one is added (§6)
                </span>
              ) : (
                profile.role_names.map((name) => {
                  const role = data.roles.find((entry) => entry.name === name);
                  return (
                    <Chip key={name}>
                      {name}
                      {actionable && role ? (
                        <button
                          type="button"
                          className="x"
                          aria-label={`Remove ${name}`}
                          title="Also removes this worker’s client qualifications for this role — except any marked Do not return, which the database keeps (§9.6)"
                          disabled={pending}
                          onClick={() => run(() => removeRole(profile.id, role.id))}
                        >
                          ×
                        </button>
                      ) : null}
                    </Chip>
                  );
                })
              )}
              {actionable && unheld.length > 0 ? (
                <>
                  <Select
                    value={addingRole}
                    aria-label="Add a role"
                    onChange={(event) => {
                      const id = event.target.value;
                      setAddingRole('');
                      if (id) run(() => addRole(profile.id, id));
                    }}
                  >
                    <option value="">+ Add role</option>
                    {unheld.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.name}
                      </option>
                    ))}
                  </Select>
                  <span className="muted xs">
                    role qualification = what they can do anywhere; eligible for these roles’
                    invitations only (§9.6)
                  </span>
                </>
              ) : null}
            </div>
          </div>
          <div className="acts">
            {data.activated === false && canResendActivation(profile.status, false) ? (
              <div className="row">
                <span className="muted sm">Not activated yet</span>
                <Button
                  size="sm"
                  tone="outline"
                  disabled={pending || resent}
                  title="A fresh personal link and a new E3 (§2.7). Once every 10 minutes."
                  onClick={() =>
                    run(
                      () => resendActivationLink(profile.id),
                      () => setResent(true),
                    )
                  }
                >
                  {resent ? 'Activation link sent ✓' : 'Resend activation link'}
                </Button>
              </div>
            ) : null}
            <div className="row">
              {profile.status === 'blocked' ? (
                <Button
                  size="sm"
                  tone="primary"
                  disabled={pending}
                  onClick={() => run(() => unblockWorker(profile.id))}
                >
                  Unblock
                </Button>
              ) : (
                <Button
                  size="sm"
                  tone="danger"
                  disabled={!actionable || pending}
                  onClick={() => setDialog('block')}
                >
                  Block
                </Button>
              )}
              <Button
                size="sm"
                disabled={!canReset(profile.status) || pending}
                title="Only on a blocked, rejected or inactive profile (§9.6)"
                onClick={() => setDialog('reset')}
              >
                Reset to candidate
              </Button>
              <Button
                size="sm"
                tone="danger"
                disabled={!actionable || pending}
                onClick={() => setDialog('remove')}
              >
                Remove (GDPR)
              </Button>
            </div>
            {profile.removed ? (
              <span className="muted xs">
                Removed under §1.7. The record stays open with its non-personal history; nothing
                here can be undone.
              </span>
            ) : null}
          </div>
        </div>

        <TileGrid columns={5}>
          <KpiTile
            label="Shifts worked"
            value={profile.shifts_worked}
            description={`since ${formatUkDate(profile.joined_at)}`}
          />
          <KpiTile
            label="Hours this week"
            value={
              <span
                title={capReason(
                  profile.weekly_cap_band,
                  profile.weekly_cap_hours,
                  profile.weekly_cap_until,
                )}
              >
                {Number(profile.weekly_booked_hours ?? 0).toFixed(0)} /{' '}
                {profile.weekly_cap_hours ?? '—'}
              </span>
            }
            tone={hoursTone(profile.weekly_cap_hours, profile.weekly_booked_hours)}
            description={capReason(
              profile.weekly_cap_band,
              profile.weekly_cap_hours,
              profile.weekly_cap_until,
            )}
          />
          <KpiTile
            label="No-shows"
            value={profile.no_shows}
            tone={noShowTone(profile.no_shows)}
            description="unresolved"
          />
          <KpiTile
            label="Rating"
            value={formatRating(profile.rating)}
            tone={profile.rating !== null && profile.rating >= 4 ? 'ok' : 'default'}
            description={`from ${profile.feedback_count} counted entries`}
          />
          <KpiTile
            label="Show-rate"
            value={formatShowRate(profile.reliability)}
            tone={profile.reliability !== null && profile.reliability >= 95 ? 'ok' : 'default'}
            description="feeds the auto-assign score (30%, §6)"
          />
        </TileGrid>

        <Tabs
          value={tab}
          onChange={setTab}
          aria-label="Profile sections"
          options={[
            { value: 'overview', label: 'Overview' },
            {
              value: 'documents',
              label: 'Documents',
              // The criminal declarations are rows of this tab too (§9.6).
              count: data.documents.length + data.declarations.length,
              alert:
                profile.documents_pending > 0 ||
                data.declarations.some((row) => row.review_status === 'pending'),
            },
            {
              value: 'qualification',
              label: 'Client qualification',
              count: data.qualifications.length,
            },
            { value: 'shifts', label: 'Shifts', count: data.shifts.length },
            { value: 'feedback', label: 'Feedback', count: data.feedback.length },
          ]}
        />

        {tab === 'overview' ? (
          <Overview
            profile={profile}
            references={data.references}
            declarations={data.declarations}
            locationStale={data.locationStale === true}
          />
        ) : null}
        {tab === 'documents' ? (
          <Documents
            profile={profile}
            documents={data.documents}
            declarations={data.declarations}
            rtwChecks={data.rtwChecks}
            rtwCheckEnabled={data.rtwCheckEnabled}
          />
        ) : null}
        {tab === 'qualification' ? (
          <Qualifications
            profile={profile}
            qualifications={data.qualifications}
            clients={data.clients}
            roles={data.roles}
          />
        ) : null}
        {tab === 'shifts' ? (
          <Shifts
            shifts={data.shifts}
            violations={data.violations}
            details={data.violationDetails}
          />
        ) : null}
        {tab === 'feedback' ? (
          <Feedback
            profile={profile}
            feedback={data.feedback}
            shifts={data.shifts}
            managerName={data.managerName}
          />
        ) : null}
      </div>

      {/* Block (§9.6, §4.3): the reason is mandatory and is the label. */}
      <Modal
        open={dialog === 'block'}
        title={`Block ${profile.display_name}`}
        onClose={close}
        footer={
          <>
            <Button tone="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              tone="danger"
              solid
              disabled={pending || reason.trim() === ''}
              onClick={() => run(() => blockWorker(profile.id, reason), close)}
            >
              Block
            </Button>
          </>
        }
      >
        <div className="field">
          <span className="label">
            Describe the reason <span className="coral">*</span>
          </span>
          <Textarea value={reason} onChange={(event) => setReason(event.target.value)} />
          <span className="hint">
            Saved and shown on the profile as &ldquo;Blocked — reason&rdquo;. Internal: the worker
            never sees it (§9.6). A manual block always means something went wrong — a worker who
            has simply left goes to Inactive instead (§10.6).
          </span>
        </div>
        <div className="sm stack">
          <div>• All future bookings released to auto-assign, and open invitations withdrawn</div>
          <div>
            • Out of the scoring pool; the app shows &ldquo;Your account is on hold&rdquo; (§10.1)
          </div>
          <div>• Only a manager’s Unblock lifts it, after the full compliance check (§4.3)</div>
        </div>
      </Modal>

      {/* Reset to candidate (§2.12): what goes, what stays, stated plainly. */}
      <Modal
        open={dialog === 'reset'}
        title="Reset to candidate"
        onClose={close}
        wide
        footer={
          <>
            <Button tone="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              tone="primary"
              disabled={pending || reason.trim() === ''}
              onClick={() => run(() => resetToCandidate(profile.id, reason), close)}
            >
              Reset to candidate
            </Button>
          </>
        }
      >
        <p className="sm">
          The profile returns to the <b>start of the onboarding pipeline</b> on this same record.
          They complete the whole wizard again — application → interview → Right to Work and
          documents → HMRC New Starter → convictions → H&amp;S quiz → contract (§2.12).
        </p>
        <div className="two">
          <div className="card">
            <h4 className="coral">Cleared (superseded)</h4>
            <ul>
              <li>Every Right to Work and compliance document, and the share-code result</li>
              <li>HMRC New Starter Checklist</li>
              <li>Criminal convictions declaration</li>
              <li>H&amp;S quiz result and the signed contract</li>
              <li>Term dates, so RULE-20 stops reading evidence nobody may rely on</li>
            </ul>
            <div className="muted xs mt-8">
              Superseded documents stay on the profile read-only as the record of the previous
              period — never used to satisfy the new check.
            </div>
          </div>
          <div className="card">
            <h4 className="green">Kept</h4>
            <ul>
              <li>
                Employee ID <b>{employeeId(profile.employee_id)}</b> — one person, one ID across
                every period, so payroll and historical timesheets reconcile
              </li>
              <li>Shift history, show-rate, rating, feedback and violations</li>
              <li>Client qualifications, back in the first-choice pool once compliant again</li>
            </ul>
          </div>
        </div>
        <div className="field">
          <span className="label">
            Reason <span className="coral">*</span>
          </span>
          <Input value={reason} onChange={(event) => setReason(event.target.value)} />
        </div>
      </Modal>

      {/*
        Remove (§1.7). The wireframe's two steps are the Remove button and
        this dialog; the typed word is the second confirmation, and the
        server checks it again — a confirmation that exists only in the
        browser is not one.
      */}
      <Modal
        open={dialog === 'remove'}
        title="Remove from system (GDPR)"
        onClose={close}
        wide
        footer={
          <>
            <Button tone="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              tone="danger"
              solid
              disabled={pending || confirmation.trim().toUpperCase() !== 'REMOVE'}
              onClick={() => run(() => removeWorker(profile.id, confirmation), close)}
            >
              Remove permanently
            </Button>
          </>
        }
      >
        <Alert tone="coral">
          <b>This cannot be undone.</b> Personal data is anonymised irreversibly: the name becomes
          &ldquo;Deleted account #{profile.employee_id ?? 'unknown'}&rdquo;, contacts, documents and
          photo are wiped, login is disabled, future bookings are released and the status becomes
          Removed.
        </Alert>
        <div className="two sm">
          <div className="card">
            <h4>Gone</h4>
            <ul>
              <li>Name, photo, email, phone, address, date of birth</li>
              <li>Every document and the share-code report</li>
              <li>NI number, bank details, HMRC checklist</li>
              <li>Conviction details — the fact one existed and its outcome stay</li>
            </ul>
          </div>
          <div className="card">
            <h4>Retained for reporting</h4>
            <ul>
              <li>Booking and shift history, violations</li>
              <li>
                Feedback, comments verbatim — the office redacts a name by editing or deleting the
                entry if asked (§1.7)
              </li>
              <li>Roles and rating on the anonymised row</li>
              <li>
                Timesheets already sent keep the real name; a regenerated copy prints the new label
                (§11.3)
              </li>
            </ul>
          </div>
        </div>
        <div className="field">
          <span className="label">
            Type <span className="mono">REMOVE</span> to confirm <span className="coral">*</span>
          </span>
          <Input
            className="mono"
            placeholder="REMOVE"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </div>
      </Modal>
    </OfficeShell>
  );
}
