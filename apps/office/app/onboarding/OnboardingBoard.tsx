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
} from '@thc/ui';
import { OfficeShell } from '../_components/OfficeShell';
import { employeeId, formatRating, formatShowRate } from '../staff/staff';
import { resolveReturning } from './actions';
import {
  boardColumns,
  boardCounts,
  cardLines,
  rejectedLines,
  rejectedPill,
  returningActions,
  shortDay,
  stageAge,
  stageEnteredAt,
} from './view-model';
import type { BoardColumn, BoardFilter, Line, ReasonFilter } from './view-model';
import type { BoardData, CandidateRow, ReturningRow } from './types';
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
 * ADR-0046: the person applied through a colleague's referral link. The
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
  const at = useMemo(() => new Date(now), [now]);
  const [filter, setFilter] = useState<BoardFilter>('active');
  const [query, setQuery] = useState('');
  const [roleName, setRoleName] = useState('');
  const [reason, setReason] = useState<ReasonFilter>('any');
  const [pending, setPending] = useState<Pending>(null);
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, start] = useTransition();

  // ADR-0046: who arrived through a referral link — a separate admin read,
  // not a column of the pipeline view (data.ts).
  const referred = useMemo<Referred>(
    () => ({
      candidates: new Set(data.referred?.candidates ?? []),
      applications: new Set(data.referred?.applications ?? []),
    }),
    [data.referred],
  );

  const counts = boardCounts(data.candidates, data.returning);
  const columns = boardColumns(data.candidates, data.returning, {
    filter,
    query,
    roleName,
    reason,
  });

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
            {filter === 'active' ? (
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
  onOpen,
  onResolve,
}: {
  column: BoardColumn;
  filter: BoardFilter;
  now: Date;
  referred: Referred;
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
      <div className="nm">{name}</div>
      <span className={tone && tone !== 'ok' ? `age ${tone}` : 'age'}>{age}</span>
    </div>
  );
}

function RoleChips({ roles, referred = false }: { roles: string[]; referred?: boolean }) {
  if (roles.length === 0 && !referred) return null;
  return (
    <div className="chips">
      {roles.map((role) => (
        <Chip key={role}>{role}</Chip>
      ))}
      {referred ? <ReferredChip /> : null}
    </div>
  );
}

function CandidateCard({
  row,
  column,
  now,
  referred,
  onOpen,
}: {
  row: CandidateRow;
  column: BoardColumn['key'];
  now: Date;
  referred: boolean;
  onOpen: (row: CandidateRow) => void;
}) {
  const age = stageAge(stageEnteredAt(row, column), now);
  const lines = cardLines(row, column, now);
  const interview = column === 'interview_requested' || column === 'interview_completed';
  return (
    <KanbanCard onOpen={() => onOpen(row)}>
      <CardTop name={row.display_name} age={age.label} tone={age.tone} photo={row.photo_url} />
      {/* Role chips from Documents onwards: picked right after the Willo
          acceptance (§2.4). "Referred" (ADR-0046) from the first column. */}
      <RoleChips roles={interview ? [] : row.role_names} referred={referred} />
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
      <RoleChips roles={row.role_names} referred={referred} />
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
  /** THIS application came through a referral link (ADR-0046). */
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
