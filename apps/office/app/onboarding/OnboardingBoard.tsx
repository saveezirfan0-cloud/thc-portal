'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import {
  Alert,
  Avatar,
  Button,
  Chip,
  EmptyState,
  KanbanCard,
  KanbanColumn,
  Modal,
  Note,
  Pill,
  SearchInput,
  SegToggle,
  Select,
  Textarea,
  useTimeFormat,
} from '@thc/ui';
import { OfficeShell } from '../_components/OfficeShell';
import { useAutoRefresh } from '../_components/useAutoRefresh';
import { employeeId, formatRating, formatShowRate } from '../staff/staff';
import { resolveReturning } from './actions';
import {
  COLUMNS,
  boardColumns,
  boardCounts,
  cardLines,
  chaserLine,
  rejectedLines,
  rejectedPill,
  returningActions,
  shortDay,
  stageAge,
  stageEnteredAt,
} from './view-model';
import type {
  AppliedFilter,
  AttentionFilter,
  GroupFilter,
  BoardColumn,
  BoardFilter,
  Line,
  ReasonFilter,
  StageFilter,
} from './view-model';
import type { BoardData, CandidateRow, ChaserState, ReturningRow } from './types';
import './onboarding.css';

function Meta({ line }: { line: Line }) {
  return (
    <div className={line.tone && line.tone !== 'muted' ? `meta ${line.tone}` : 'meta'}>
      {line.text}
    </div>
  );
}

/**
 * "Review interview on Willo ↗" — live once THC's Willo account is configured
 * (§2.4). Until then a neutral, disabled line: a fact about the set-up, not a
 * warning about the candidate.
 */
function WilloLink({ url }: { url: string | null }) {
  if (!url) {
    return (
      <span
        className="willo off"
        aria-disabled="true"
        title="Willo is not connected yet — the link appears once THC's Willo account is set up in Settings"
      >
        Review interview on Willo — not connected
      </span>
    );
  }
  return (
    <a
      className="willo"
      href={url}
      target="_blank"
      rel="noreferrer"
      onClick={(event) => event.stopPropagation()}
    >
      Review interview on Willo ↗
    </a>
  );
}

const STATUS_NOTE: Record<string, string> = {
  blocked: 'Blocked',
  rejected: 'Rejected',
  inactive: 'Left (inactive)',
  compliant: 'Compliant — currently working',
};

type Pending = { row: ReturningRow; action: 'reset' | 'reject' } | null;

/** The "Referred" chip's lookups: candidates by staff id, returning cards by application. */
interface Referred {
  candidates: ReadonlySet<string>;
  applications: ReadonlySet<string>;
}

/**
 * ADR-0047: the person applied through a colleague's referral link. The
 * name of the referrer is on the profile ("Referred by …"), not the card.
 */
function ReferredChip() {
  return (
    <Chip
      tone="cyan"
      title="Applied through a referral link — see the profile for who referred them"
    >
      Referred
    </Chip>
  );
}

/**
 * /onboarding (BO3): six columns, the Active / Rejected toggle, the
 * returning-applicant card.
 */
export function OnboardingBoard({
  data,
  now,
  applyUrl,
}: {
  data: BoardData;
  now: string;
  /** Null when the Staff App's origin is not configured in production. */
  applyUrl: string | null;
}) {
  const router = useRouter();
  // Cards move on their own (Willo webhook, documents verified, quiz passed),
  // so the board re-reads every 30 s and when the tab regains focus.
  useAutoRefresh();
  const at = useMemo(() => new Date(now), [now]);
  const [filter, setFilter] = useState<BoardFilter>('active');
  const [query, setQuery] = useState('');
  const [roleName, setRoleName] = useState('');
  const [reason, setReason] = useState<ReasonFilter>('any');
  const [stage, setStage] = useState<StageFilter>('any');
  const [attention, setAttention] = useState<AttentionFilter>('any');
  const [applied, setApplied] = useState<AppliedFilter>('any');
  const [group, setGroup] = useState<GroupFilter>('any');
  const [pending, setPending] = useState<Pending>(null);
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, start] = useTransition();

  // ADR-0047: who arrived through a referral link — a separate admin read,
  // not a column of the pipeline view (data.ts).
  const referred = useMemo<Referred>(
    () => ({
      candidates: new Set(data.referred?.candidates ?? []),
      applications: new Set(data.referred?.applications ?? []),
    }),
    [data.referred],
  );

  const counts = boardCounts(data.candidates, data.returning);
  const columns = boardColumns(
    data.candidates,
    data.returning,
    { filter, query, roleName, reason, stage, attention, applied, group },
    {
      now: at,
      referredCandidates: referred.candidates,
      referredApplications: referred.applications,
      chasers: data.chasers,
    },
  );

  // The toggle keeps each view's own filters, so "any" is judged per view.
  const filtering =
    query.trim() !== '' ||
    stage !== 'any' ||
    applied !== 'any' ||
    group !== 'any' ||
    (filter === 'active' ? roleName !== '' || attention !== 'any' : reason !== 'any');
  const clearFilters = () => {
    setQuery('');
    setRoleName('');
    setReason('any');
    setStage('any');
    setAttention('any');
    setApplied('any');
    setGroup('any');
  };

  const open = (row: CandidateRow) => router.push(`/onboarding/${row.id}`);

  const confirm = () => {
    if (!pending) return;
    setProblem(null);
    start(async () => {
      const result = await resolveReturning(
        pending.row.application_id,
        pending.row.staff_id,
        pending.action,
        note,
      );
      if (result.ok) {
        setPending(null);
        setNote('');
        router.refresh();
      } else {
        setProblem(result.message);
      }
    });
  };

  return (
    <OfficeShell
      activeHref="/onboarding"
      title="Onboarding"
      crumbs={
        <>
          candidate pipeline · <b>{counts.active} active</b> · {counts.rejected} rejected
        </>
      }
      actions={
        applyUrl ? (
          <a className="btn sm" href={applyUrl} target="_blank" rel="noreferrer">
            Open /apply form ↗
          </a>
        ) : null
      }
    >
      <div className="stack">
        {data.problem ? <Alert tone="coral">{data.problem}</Alert> : null}
        {data.referredProblem ? (
          // Audit D18: no chip because the read failed is not "nobody referred".
          <Alert tone="coral">
            The referrals could not be read, so no card shows its Referred chip:{' '}
            {data.referredProblem}
          </Alert>
        ) : null}
        {data.chasersProblem ? (
          // As above: no reminder line because the read failed is not "never reminded".
          <Alert tone="coral">
            The onboarding reminders could not be read, so no card shows its reminder or Stalled
            line: {data.chasersProblem}
          </Alert>
        ) : null}

        <div className="toolbar">
          <SegToggle<BoardFilter>
            aria-label="Active or rejected candidates"
            options={[
              { value: 'active', label: 'Active', count: counts.active },
              { value: 'rejected', label: 'Rejected', count: counts.rejected },
            ]}
            value={filter}
            onChange={setFilter}
          />
          <div className="right">
            <SearchInput
              aria-label="Search candidates"
              placeholder="Search candidates"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <Select
              aria-label="Stage"
              value={stage}
              onChange={(event) => setStage(event.target.value as StageFilter)}
            >
              <option value="any">
                {filter === 'active' ? 'Any stage' : 'Rejected from any stage'}
              </option>
              {COLUMNS.map((column) => (
                <option key={column.key} value={column.key}>
                  {column.label}
                </option>
              ))}
            </Select>
            {filter === 'active' ? (
              <>
                <Select
                  aria-label="Role"
                  value={roleName}
                  onChange={(event) => setRoleName(event.target.value)}
                >
                  <option value="">Any role</option>
                  {data.roles.map((role) => (
                    <option key={role.id} value={role.name}>
                      {role.name}
                    </option>
                  ))}
                </Select>
                <Select
                  aria-label="Attention"
                  value={attention}
                  onChange={(event) => setAttention(event.target.value as AttentionFilter)}
                >
                  <option value="any">Everyone</option>
                  <option value="attention">Needs attention</option>
                  <option value="stalled">Reminders stalled or undelivered</option>
                  <option value="referred">From a referral link</option>
                  <option value="not_activated">Not activated</option>
                </Select>
                {/* ADR-0104: SpudBros Express staff are onboarding-only. */}
                <Select
                  aria-label="Group"
                  value={group}
                  onChange={(event) => setGroup(event.target.value as GroupFilter)}
                >
                  <option value="any">All groups</option>
                  <option value="spudbros">SpudBros Express</option>
                  <option value="thc">THC only</option>
                </Select>
              </>
            ) : (
              <Select
                aria-label="Reason"
                value={reason}
                onChange={(event) => setReason(event.target.value as ReasonFilter)}
              >
                <option value="any">Any reason</option>
                <option value="willo">Rejected in Willo</option>
                <option value="quiz_failed">Quiz failed 3×</option>
                <option value="manager">Rejected by manager</option>
              </Select>
            )}
            <Select
              aria-label="Applied"
              value={applied}
              onChange={(event) => setApplied(event.target.value as AppliedFilter)}
            >
              <option value="any">Applied any time</option>
              <option value="today">Applied today</option>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
            </Select>
            {filtering ? (
              <Button size="sm" tone="ghost" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : null}
          </div>
        </div>

        {filter === 'active' ? (
          <Alert tone="cyan">
            <b>No &quot;Applied&quot; stage.</b> Submitting /apply creates the candidate straight in{' '}
            <b>Interview requested</b> and Willo sends the interview invitation (E1) itself. Cards
            move between the first two columns on their own from the Willo webhook; the manager
            decides <i>inside Willo</i>.
          </Alert>
        ) : null}

        <div className="kanban six">
          {columns.map((column) => (
            <Column
              key={column.key}
              column={column}
              filter={filter}
              now={at}
              referred={referred}
              chasers={data.chasers ?? {}}
              onOpen={open}
              onResolve={(row, action) => {
                setProblem(null);
                setNote('');
                setPending({ row, action });
              }}
            />
          ))}
        </div>

        {filter === 'rejected' ? (
          <Alert tone="neutral">
            Rejection is final on this record — there is no &quot;un-reject&quot;. If the person
            applies again via /apply, the duplicate check (email, or mobile + DOB) routes them to
            the office as a <b>Returning applicant</b> card in Interview requested, where the
            manager presses <b>Reset to candidate</b> or rejects the application.
          </Alert>
        ) : null}
      </div>

      <Modal
        open={pending !== null}
        title={pending?.action === 'reset' ? 'Reset to candidate' : 'Reject the application'}
        onClose={() => setPending(null)}
        footer={
          <>
            <Button tone="ghost" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button
              tone={pending?.action === 'reset' ? 'primary' : 'danger'}
              solid={pending?.action === 'reject'}
              disabled={busy || note.trim() === ''}
              onClick={confirm}
            >
              {pending?.action === 'reset' ? 'Reset to candidate' : 'Reject application'}
            </Button>
          </>
        }
      >
        {pending ? (
          <div className="stack">
            <div className="sm muted">
              {pending.row.existing_name} · {employeeId(pending.row.employee_id)} · matched on{' '}
              {pending.row.matched_on === 'email_dob'
                ? 'email + date of birth'
                : 'mobile + date of birth'}
            </div>
            {pending.action === 'reset' ? (
              <div className="note">
                Same record, same Employee ID. Status goes back to Interview requested; every
                document, the share-code result, the HMRC checklist, the declaration, the quiz and
                the contract are marked superseded and must be supplied again. History stays.
              </div>
            ) : (
              <div className="note">
                The applicant receives E2. They are never told why a previous record was blocked.
                The existing record is not changed.
              </div>
            )}
            <Textarea
              label="Reason *"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
            {problem ? <Alert tone="coral">{problem}</Alert> : null}
          </div>
        ) : null}
      </Modal>
    </OfficeShell>
  );
}

function Column({
  column,
  filter,
  now,
  referred,
  chasers,
  onOpen,
  onResolve,
}: {
  column: BoardColumn;
  filter: BoardFilter;
  now: Date;
  referred: Referred;
  chasers: Record<string, ChaserState>;
  onOpen: (row: CandidateRow) => void;
  onResolve: (row: ReturningRow, action: 'reset' | 'reject') => void;
}) {
  const empty = column.candidates.length === 0 && column.returning.length === 0;
  return (
    <KanbanColumn
      title={<span className={`t ${column.tone}`}>{column.label}</span>}
      count={column.count}
    >
      {empty ? (
        <EmptyState>
          <span className="sm">
            {filter === 'rejected' ? 'Nothing rejected at this stage' : 'Nobody at this stage'}
          </span>
        </EmptyState>
      ) : null}

      {column.returning.map((row) => (
        <ReturningCard
          key={row.application_id}
          row={row}
          now={now}
          referred={referred.applications.has(row.application_id)}
          onResolve={onResolve}
        />
      ))}

      {column.candidates.map((row) =>
        filter === 'rejected' ? (
          <RejectedCard
            key={row.id}
            row={row}
            referred={referred.candidates.has(row.id)}
            onOpen={onOpen}
          />
        ) : (
          <CandidateCard
            key={row.id}
            row={row}
            column={column.key}
            now={now}
            referred={referred.candidates.has(row.id)}
            chaser={chasers[row.id]}
            onOpen={onOpen}
          />
        ),
      )}

      {/* The wireframe's note under the Contract column: where a card goes when it leaves (§2.7). */}
      {filter === 'active' && column.key === 'contract' ? (
        <Note>
          Signed → the card leaves the kanban, Employee ID is generated and the person appears in{' '}
          <Link href="/staff">Staff</Link> as Compliant.
        </Note>
      ) : null}
    </KanbanColumn>
  );
}

function CardTop({
  name,
  age,
  tone,
  photo,
}: {
  name: string;
  age: string;
  tone?: string;
  /** The onboarding selfie, signed on the server (_lib/photos.ts); initials until there is one. */
  photo?: string | null;
}) {
  return (
    <div className="top">
      <Avatar size="sm" name={name} src={photo ?? undefined} />
      <div className="nm" title={name}>
        {name}
      </div>
      <span className={tone && tone !== 'ok' ? `age ${tone}` : 'age'}>{age}</span>
    </div>
  );
}

/** A card shows this many role chips; the rest fold into one "+N" chip. */
const ROLE_CHIPS_SHOWN = 2;

function RoleChips({
  roles,
  referred = false,
  spudbros = false,
}: {
  roles: string[];
  referred?: boolean;
  /** ADR-0104: SpudBros Express staff (onboarding only). */
  spudbros?: boolean;
}) {
  if (roles.length === 0 && !referred && !spudbros) return null;
  // Someone can pick every role THC runs (nine chips was a card taller than
  // the screen). The profile has the full list; the "+N" chip's tooltip too.
  const shown = roles.slice(0, ROLE_CHIPS_SHOWN);
  const hidden = roles.slice(ROLE_CHIPS_SHOWN);
  return (
    <div className="chips">
      {spudbros ? (
        <Chip title="SpudBros Express — onboarding only; shifts stay on Connecteam">SpudBros</Chip>
      ) : null}
      {shown.map((role) => (
        <Chip key={role}>{role}</Chip>
      ))}
      {hidden.length > 0 ? <Chip title={hidden.join(', ')}>+{hidden.length}</Chip> : null}
      {referred ? <ReferredChip /> : null}
    </div>
  );
}

function CandidateCard({
  row,
  column,
  now,
  referred,
  chaser,
  onOpen,
}: {
  row: CandidateRow;
  column: BoardColumn['key'];
  now: Date;
  referred: boolean;
  /** The onboarding chasers' state for this candidate (ADR-0071), if any. */
  chaser?: ChaserState;
  onOpen: (row: CandidateRow) => void;
}) {
  const format = useTimeFormat();
  const age = stageAge(stageEnteredAt(row, column), now);
  const reminder = chaserLine(chaser);
  const lines = [...cardLines(row, column, now, format), ...(reminder ? [reminder] : [])];
  const interview = column === 'interview_requested' || column === 'interview_completed';
  return (
    <KanbanCard onOpen={() => onOpen(row)}>
      <CardTop name={row.display_name} age={age.label} tone={age.tone} photo={row.photo_url} />
      {/* Role chips from Documents onwards: picked right after the Willo
          acceptance (§2.4). "Referred" (ADR-0047) from the first column. */}
      <RoleChips
        roles={interview ? [] : row.role_names}
        referred={referred}
        spudbros={row.spudbros_express === true}
      />
      {lines.slice(0, 1).map((line) => (
        <Meta key={line.text} line={line} />
      ))}
      {interview ? <WilloLink url={row.willo_review_url} /> : null}
      {lines.slice(1).map((line) => (
        <Meta key={line.text} line={line} />
      ))}
    </KanbanCard>
  );
}

function RejectedCard({
  row,
  referred,
  onOpen,
}: {
  row: CandidateRow;
  referred: boolean;
  onOpen: (row: CandidateRow) => void;
}) {
  return (
    <KanbanCard onOpen={() => onOpen(row)}>
      <CardTop
        name={row.display_name}
        age={row.rejected_at ? shortDay(row.rejected_at) : '—'}
        photo={row.photo_url}
      />
      <RoleChips
        roles={row.role_names}
        referred={referred}
        spudbros={row.spudbros_express === true}
      />
      <span>
        <Pill tone="coral">{rejectedPill(row)}</Pill>
      </span>
      {rejectedLines(row).map((line) => (
        <Meta key={line.text} line={line} />
      ))}
      {row.rejection_cause === 'willo' ? <WilloLink url={row.willo_review_url} /> : null}
    </KanbanCard>
  );
}

/**
 * §2.12: the duplicate check matched an existing record, so no second
 * candidate was created. The applicant saw the ordinary confirmation.
 */
function ReturningCard({
  row,
  now,
  referred,
  onResolve,
}: {
  row: ReturningRow;
  now: Date;
  /** THIS application came through a referral link (ADR-0047). */
  referred: boolean;
  onResolve: (row: ReturningRow, action: 'reset' | 'reject') => void;
}) {
  const age = stageAge(row.applied_at, now);
  const actions = returningActions(row.status);
  const status =
    row.status === 'blocked' && row.block_reason
      ? `Blocked — ${row.block_reason}`
      : (STATUS_NOTE[row.status] ?? row.status);
  return (
    <KanbanCard returning>
      <CardTop name={row.applicant_name} age={age.days === 0 ? 'today' : age.label} tone="warn" />
      <span>
        <Pill tone="amber">Returning applicant</Pill>
        {referred ? (
          <>
            {' '}
            <ReferredChip />
          </>
        ) : null}
      </span>
      <div className="meta">
        Matches existing record{' '}
        {/* §2.12: the historical show-rate, feedback and violations are on
            the profile — the name opens it. */}
        <Link href={`/staff/${row.staff_id}`} className="cyan">
          <b>
            {row.existing_name} · {employeeId(row.employee_id)}
          </b>
        </Link>{' '}
        ({row.matched_on === 'email_dob' ? 'email + DOB' : 'mobile + DOB'}). Status:{' '}
        <span
          className={row.status === 'blocked' || row.status === 'rejected' ? 'coral' : undefined}
        >
          {status}
        </span>
        . History: {row.shifts_worked} shifts · show-rate {formatShowRate(row.reliability)} · rating{' '}
        {formatRating(row.rating)}.
      </div>
      <div className="meta">
        No second record was created. The applicant saw the ordinary &quot;check your inbox&quot;
        screen and is never told why.
      </div>
      <div className="acts">
        {actions.includes('reset') ? (
          <Button size="sm" tone="primary" onClick={() => onResolve(row, 'reset')}>
            Reset to candidate
          </Button>
        ) : null}
        <Button size="sm" tone="danger" onClick={() => onResolve(row, 'reject')}>
          Reject
        </Button>
      </div>
    </KanbanCard>
  );
}
