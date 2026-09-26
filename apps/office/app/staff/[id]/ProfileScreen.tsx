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
  statusLabel,
} from '../staff';
import { Availability } from './Availability';
import { ChangeRequestBanner } from './ChangeRequestBanner';
import { Documents } from './Documents';
import { Feedback } from './Feedback';
import { Overview } from './Overview';
import { Qualifications } from './Qualifications';
import { Shifts } from './Shifts';
import {
  blockBanner,
  canBlock,
  canReset,
  hoursThisWeek,
  isActionable,
  noShowTone,
} from './profile';
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

type Tab = 'overview' | 'documents' | 'qualification' | 'shifts' | 'feedback' | 'availability';
type Dialog = 'block' | 'reset' | 'remove' | null;

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
  const banner = blockBanner(profile);
  const hours = hoursThisWeek(profile);
  const capWhy = capReason(
    profile.weekly_cap_band,
    profile.weekly_cap_hours,
    profile.weekly_cap_until,
  );
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
            {/* Each kind of block lifts differently; the words say which. */}
            <span>
              <b>{banner.title}</b>
              <br />
              <span className="muted sm">{banner.detail}</span>
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
              {/* The wireframe's words ("Compliant", "Blocked"), never the raw enum. */}
              <Pill tone={statusLabel(profile).tone} large>
                {statusLabel(profile).label}
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
                Weekly limit <b>{capWhy}</b>
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
                  None — this worker is invisible to every auto-assign round until one is added
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
                          title="Also removes this worker’s client qualifications for this role — except any marked Do not return, which the database keeps"
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
                    invitations only
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
                  title="A fresh personal link and a new activation email. Once every 10 minutes."
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
                  // §2.12: only a compliant worker can be blocked; someone who
                  // left, was rejected or is still a candidate cannot (§9.6).
                  disabled={!actionable || !canBlock(profile.status) || pending}
                  title={
                    actionable && !canBlock(profile.status)
                      ? 'Only a compliant worker can be blocked — a leaver or candidate is not'
                      : undefined
                  }
                  onClick={() => setDialog('block')}
                >
                  Block
                </Button>
              )}
              <Button
                size="sm"
                disabled={!canReset(profile.status) || pending}
                title="Only on a blocked, rejected or inactive profile"
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
                Removed: personal data anonymised. The record stays open with its non-personal
                history; nothing here can be undone.
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
          {/* §9.6: "worked / calculated weekly limit", the reason on hover;
              the booked hours underneath, because the cap gates on them. */}
          <KpiTile
            label="Hours this week"
            value={<span title={capWhy}>{hours.value}</span>}
            tone={hours.tone}
            description={`worked · ${hours.booked} · ${capWhy}`}
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
            description="feeds the auto-assign score (30%)"
          />
        </TileGrid>

        {/* ADR-0038: a pending name/photo change, decided here or in the queue. */}
        <ChangeRequestBanner requests={data.changeRequests ?? []} />

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
            // ADR-0036: read-only, the next 8 weeks.
            {
              value: 'availability',
              label: 'Availability',
              count: data.availability?.length ?? 0,
            },
          ]}
        />

        {tab === 'overview' ? (
          <Overview
            profile={profile}
            references={data.references}
            declarations={data.declarations}
            locationStale={data.locationStale === true}
            emergencyContact={data.emergencyContact ?? null}
            emergencyContactProblem={data.emergencyContactProblem ?? null}
            referrals={data.referrals ?? null}
            referralsProblem={data.referralsProblem ?? null}
          />
        ) : null}
        {tab === 'availability' ? (
          <Availability
            rows={data.availability ?? []}
            problem={data.availabilityProblem ?? null}
            name={profile.display_name}
          />
        ) : null}
        {tab === 'documents' ? (
          <Documents
            profile={profile}
            documents={data.documents}
            declarations={data.declarations}
            rtwChecks={data.rtwChecks}
            rtwCheckEnabled={data.rtwCheckEnabled}
            reviewQueue={data.reviewQueue}
            reviewQueueProblem={data.reviewQueueProblem}
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
            never sees it. A manual block always means something went wrong — a worker who has
            simply left goes to Inactive instead.
          </span>
        </div>
        <div className="sm stack">
          <div>• All future bookings released to auto-assign, and open invitations withdrawn</div>
          <div>• Out of the scoring pool; the app shows &ldquo;Your account is on hold&rdquo;</div>
          <div>• Only a manager’s Unblock lifts it, after the full compliance check</div>
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
          documents → HMRC New Starter → convictions → H&amp;S quiz → contract.
        </p>
        <div className="two">
          <div className="card">
            <h4 className="coral">Cleared (superseded)</h4>
            <ul>
              <li>Every Right to Work and compliance document, and the share-code result</li>
              <li>HMRC New Starter Checklist</li>
              <li>Criminal convictions declaration</li>
              <li>H&amp;S quiz result and the signed contract</li>
              <li>Term dates, so the weekly limit stops reading evidence nobody may rely on</li>
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
                entry if asked
              </li>
              <li>Roles and rating on the anonymised row</li>
              <li>
                Timesheets already sent keep the real name; a regenerated copy prints the new label
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
