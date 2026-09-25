'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { UK_ZONE, formatDateTimeIn } from '@thc/domain';
import {
  Alert,
  Avatar,
  Button,
  EmptyState,
  Input,
  Modal,
  Note,
  Panel,
  Pill,
  SearchInput,
  SegToggle,
  Select,
} from '@thc/ui';
import { OfficeShell } from '../_components/OfficeShell';
import { ROLE_LABEL } from '../_lib/accounts';
import { type UsersResult, inviteUser, newInviteLink, setLoginDisabled } from './actions';
import type { AccountRow, UsersPageData } from './data';
import { inviteMailto } from './invite';
import '../account/account.css';

/**
 * /users — Users & access (ADR-0035, §1.4).
 *
 * Three tabs, one per app. Back Office and Client Portal logins are
 * created here (Invite) and can be switched off and on; a worker's login
 * comes from Accept in Onboarding and is closed by Block or Remove on the
 * staff profile, so the Staff App tab lists them read-only with a link
 * through. What each kind of login can see is stated on the page, because
 * that — not a toggle here — is where the access rules live (RLS).
 */

type Tab = 'admin' | 'client' | 'staff';

/** The Staff App tab can hold a thousand rows; a search narrows it. */
const STAFF_LIMIT = 100;

const ACCESS_NOTE: Record<Tab, string> = {
  admin:
    'Back Office: everything — scheduling, compliance, staff, clients, money, reports and these settings. Every change is recorded in the activity log with the person’s name.',
  client:
    'Client Portal: only their own company’s events and line-up, and feedback. No pay rates, charges or totals, and no worker personal details beyond the line-up (§11.1).',
  staff:
    'Staff App: only their own onboarding, documents, invites, shifts and check-in. Created when a candidate is accepted in Onboarding; closed by Block or Remove on the staff profile.',
};

function ukStamp(iso: string | null): string {
  return iso ? formatDateTimeIn(new Date(iso), UK_ZONE) : 'Never';
}

function statusOf(account: AccountRow): { tone: 'green' | 'amber' | 'neutral'; label: string } {
  if (account.disabled) return { tone: 'neutral', label: 'Switched off' };
  if (!account.last_sign_in_at) return { tone: 'amber', label: 'Invited' };
  return { tone: 'green', label: 'Active' };
}

export function UsersScreen({ data }: { data: UsersPageData }) {
  const [tab, setTab] = useState<Tab>('admin');
  const [query, setQuery] = useState('');
  const [inviting, setInviting] = useState(false);
  const [switching, setSwitching] = useState<AccountRow | null>(null);
  const [issued, setIssued] = useState<{ account: AccountRow; link: string } | null>(null);

  const counts = useMemo(() => {
    const out: Record<Tab, number> = { admin: 0, client: 0, staff: 0 };
    for (const account of data.accounts) out[account.role] += 1;
    return out;
  }, [data.accounts]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.accounts.filter(
      (account) =>
        account.role === tab &&
        (!q ||
          account.full_name.toLowerCase().includes(q) ||
          (account.email ?? '').toLowerCase().includes(q) ||
          (account.client_name ?? '').toLowerCase().includes(q) ||
          (account.job_title ?? '').toLowerCase().includes(q)),
    );
  }, [data.accounts, tab, query]);
  const shown = tab === 'staff' ? rows.slice(0, STAFF_LIMIT) : rows;

  return (
    <OfficeShell
      activeHref="/users"
      title="Users & access"
      crumbs={<>Who can sign in to each app, and what they can see · §1.4</>}
      actions={
        <Button tone="primary" onClick={() => setInviting(true)}>
          + Invite user
        </Button>
      }
    >
      {data.problem ? <Alert tone="coral">{data.problem}</Alert> : null}

      <div className="toolbar">
        <SegToggle<Tab>
          aria-label="Which app"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'admin', label: 'Back Office', count: counts.admin },
            { value: 'client', label: 'Client Portal', count: counts.client },
            { value: 'staff', label: 'Staff App', count: counts.staff },
          ]}
        />
        <div className="right">
          <SearchInput
            aria-label="Search users"
            placeholder="Search name, email, client"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>

      <Note tone="cyan">{ACCESS_NOTE[tab]}</Note>

      <Panel flush>
        {shown.length === 0 ? (
          <EmptyState>
            {query ? 'No login matches that search.' : `No ${ROLE_LABEL[tab]} logins yet.`}
          </EmptyState>
        ) : (
          <div className="table-scroll">
            <table className="tbl card-rows users-table">
              <thead>
                <tr>
                  <th aria-label="Avatar" />
                  <th>Name</th>
                  <th>Email</th>
                  {tab === 'client' ? <th>Client</th> : null}
                  <th>Last signed in (UK time)</th>
                  <th>Status</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {shown.map((account) => (
                  <UserRow
                    key={account.id}
                    account={account}
                    tab={tab}
                    self={account.id === data.selfId}
                    onSwitch={() => setSwitching(account)}
                    onIssued={(link) => setIssued({ account, link })}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
        {tab === 'staff' && rows.length > STAFF_LIMIT ? (
          <p className="sm muted users-more">
            Showing {STAFF_LIMIT} of {rows.length}. Search to narrow the list, or use the{' '}
            <Link href="/staff">Staff directory</Link>.
          </p>
        ) : null}
      </Panel>

      <Panel title="Finer permissions">
        <p className="sm muted users-plain">
          Every Back Office login has the same full access today, and every change it makes is in
          the <Link href="/activity">activity log</Link> under its name. Office roles with less
          access — for example a scheduler who cannot see pay, or a read-only viewer — are written
          up as a proposal in ADR-0035 and need the database rules (RLS) changed before a switch
          here could mean anything.
        </p>
      </Panel>

      {inviting ? (
        <InviteModal
          clients={data.clients}
          initialRole={tab === 'client' ? 'client' : 'admin'}
          onClose={() => setInviting(false)}
        />
      ) : null}
      {switching ? <SwitchModal account={switching} onClose={() => setSwitching(null)} /> : null}
      {issued ? (
        <LinkModal
          name={issued.account.full_name}
          email={issued.account.email ?? ''}
          role={issued.account.role === 'client' ? 'client' : 'admin'}
          link={issued.link}
          onClose={() => setIssued(null)}
        />
      ) : null}
    </OfficeShell>
  );
}

function UserRow({
  account,
  tab,
  self,
  onSwitch,
  onIssued,
}: {
  account: AccountRow;
  tab: Tab;
  self: boolean;
  onSwitch: () => void;
  onIssued: (link: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const status = statusOf(account);

  const reissue = () => {
    setError(null);
    start(async () => {
      const result = await newInviteLink(account.id);
      if (result.ok && result.link) onIssued(result.link);
      else if (!result.ok) setError(result.message);
    });
  };

  return (
    <tr className={account.disabled ? 'muted' : undefined}>
      <td className="cell-lead">
        <Avatar name={account.full_name} size="sm" />
      </td>
      <td className="cell-title">
        {tab === 'staff' && account.staff_id ? (
          <Link href={`/staff/${account.staff_id}`}>
            <b>{account.full_name}</b>
          </Link>
        ) : (
          <b>{account.full_name}</b>
        )}
        {self ? <span className="sub">You</span> : null}
        {account.job_title ? <span className="sub">{account.job_title}</span> : null}
      </td>
      <td data-label="Email" className="sm">
        {account.email ?? '—'}
      </td>
      {tab === 'client' ? <td data-label="Client">{account.client_name ?? '—'}</td> : null}
      <td data-label="Last signed in" className="mono sm">
        {ukStamp(account.last_sign_in_at)}
      </td>
      <td data-label="Status">
        <Pill tone={status.tone}>{status.label}</Pill>
      </td>
      <td className="cell-actions">
        {tab === 'staff' ? (
          account.staff_id ? (
            <Link className="btn sm" href={`/staff/${account.staff_id}`}>
              Staff profile
            </Link>
          ) : null
        ) : (
          <>
            {/* Only a login nobody has used yet gets a new link: for one in
                use, a link would let whoever holds it sign in as its owner,
                who resets their own password from the sign-in screen. */}
            {!account.disabled && !account.last_sign_in_at ? (
              <Button size="sm" disabled={pending} onClick={reissue}>
                {pending ? 'Creating…' : 'New invite link'}
              </Button>
            ) : null}
            {!self ? (
              <Button size="sm" tone={account.disabled ? 'green' : 'ghost'} onClick={onSwitch}>
                {account.disabled ? 'Switch on' : 'Switch off'}
              </Button>
            ) : null}
            {error ? <span className="sub coral">{error}</span> : null}
          </>
        )}
      </td>
    </tr>
  );
}

function InviteModal({
  clients,
  initialRole,
  onClose,
}: {
  clients: UsersPageData['clients'];
  initialRole: 'admin' | 'client';
  onClose: () => void;
}) {
  const router = useRouter();
  const [role, setRole] = useState<'admin' | 'client'>(initialRole);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [clientId, setClientId] = useState('');
  const [result, setResult] = useState<UsersResult | null>(null);
  const [pending, start] = useTransition();

  if (result?.ok && result.link) {
    return (
      <LinkModal
        name={fullName}
        email={result.email ?? email}
        role={role}
        link={result.link}
        onClose={onClose}
      />
    );
  }

  const submit = () => {
    setResult(null);
    start(async () => {
      const outcome = await inviteUser({ email, fullName, role, clientId, jobTitle });
      setResult(outcome);
      if (outcome.ok) router.refresh();
    });
  };

  return (
    <Modal
      open
      title="Invite a user"
      onClose={onClose}
      footer={
        <>
          <Button tone="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button tone="primary" disabled={pending} onClick={submit}>
            {pending ? 'Creating…' : 'Create login'}
          </Button>
        </>
      }
    >
      <div className="account-form">
        <SegToggle<'admin' | 'client'>
          aria-label="Which app"
          block
          value={role}
          onChange={setRole}
          options={[
            { value: 'admin', label: 'Back Office' },
            { value: 'client', label: 'Client Portal' },
          ]}
        />
        <p className="sm muted">
          {role === 'admin'
            ? 'A THC manager. Full Back Office access.'
            : 'Someone at a client. Sees only that client’s events and line-up — never money.'}{' '}
          Workers are not invited here: they get their login when accepted in Onboarding.
        </p>
        <Input
          label="Full name"
          value={fullName}
          autoComplete="off"
          onChange={(event) => setFullName(event.target.value)}
        />
        <Input
          label="Email"
          type="email"
          value={email}
          autoComplete="off"
          onChange={(event) => setEmail(event.target.value)}
        />
        {role === 'admin' ? (
          <Input
            label="Job title (optional)"
            value={jobTitle}
            placeholder="e.g. Scheduler"
            onChange={(event) => setJobTitle(event.target.value)}
          />
        ) : (
          <Select
            label="Client"
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
          >
            <option value="">Choose a client…</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </Select>
        )}
        {result && !result.ok ? <Alert tone="coral">{result.message}</Alert> : null}
      </div>
    </Modal>
  );
}

/**
 * The set-up link, once. It is shown rather than emailed by the platform:
 * an invitation email would be a new entry in the §8 register, which is
 * the contract's to add. Until then the manager sends it from their own
 * mail — one click — or copies it into a message.
 */
function LinkModal({
  name,
  email,
  role,
  link,
  onClose,
}: {
  name: string;
  email: string;
  role: 'admin' | 'client';
  link: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <Modal
      open
      title="Login ready — send the link"
      onClose={onClose}
      footer={
        <Button tone="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="account-form">
        <p className="sm">
          <b>{name}</b> ({email}) has a {ROLE_LABEL[role]} login. They choose their own password
          with this link. It works once, and expires after 24 hours.
        </p>
        <Input
          label="Set-up link"
          value={link}
          readOnly
          mono
          onFocus={(event) => event.target.select()}
        />
        <div className="row users-link-actions">
          <Button onClick={copy}>{copied ? 'Copied ✓' : 'Copy link'}</Button>
          <a className="btn" href={inviteMailto({ email, name, role, link })}>
            Open in email
          </a>
        </div>
        <Note>
          The link is shown only now. If it is lost or expires, use <b>New invite link</b> on their
          row — that replaces this one.
        </Note>
      </div>
    </Modal>
  );
}

function SwitchModal({ account, onClose }: { account: AccountRow; onClose: () => void }) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [result, setResult] = useState<UsersResult | null>(null);
  const [pending, start] = useTransition();
  const turningOff = !account.disabled;

  const submit = () => {
    setResult(null);
    start(async () => {
      const outcome = await setLoginDisabled(account.id, turningOff, reason);
      setResult(outcome);
      if (outcome.ok) {
        router.refresh();
        onClose();
      }
    });
  };

  return (
    <Modal
      open
      title={
        turningOff ? `Switch off ${account.full_name}?` : `Switch ${account.full_name} back on?`
      }
      onClose={onClose}
      footer={
        <>
          <Button tone="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            tone={turningOff ? 'danger' : 'green'}
            solid={turningOff}
            disabled={pending || (turningOff && !reason.trim())}
            onClick={submit}
          >
            {pending ? 'Saving…' : turningOff ? 'Switch off' : 'Switch on'}
          </Button>
        </>
      }
    >
      <div className="account-form">
        <p className="sm">
          {turningOff
            ? 'They are signed out everywhere at once and cannot sign in again until switched back on. Nothing they did is removed, and their name stays on the activity log.'
            : 'They can sign in again with their existing password straight away.'}
        </p>
        {turningOff ? (
          <Input
            label="Reason"
            value={reason}
            placeholder="e.g. Left THC on 30 Sep"
            hint="Recorded in the activity log."
            onChange={(event) => setReason(event.target.value)}
          />
        ) : null}
        {result && !result.ok ? <Alert tone="coral">{result.message}</Alert> : null}
      </div>
    </Modal>
  );
}
