'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { UK_ZONE, formatDateTimeIn } from '@thc/domain';
import { Alert, Avatar, Button, Input, ModeSwitch, Panel, Pill } from '@thc/ui';
import { OfficeShell } from '../_components/OfficeShell';
import { ROLE_LABEL } from '../_lib/accounts';
import {
  type AccountResult,
  changeMyEmail,
  changeMyPassword,
  saveMyDetails,
  signOutOtherDevices,
} from './actions';
import type { AccountPageData, MyAccount } from './data';
import './account.css';

/**
 * /account — My profile (ADR-0035).
 *
 * Four blocks, each saving on its own, so a password change never rides
 * along with a name edit: your details, sign-in email, password, and
 * this device (sessions + the appearance switch). No wireframe exists for
 * this screen; it uses the Back Office's existing Panel, form and pill
 * language and adds none of its own.
 */
export function AccountScreen({ data }: { data: AccountPageData }) {
  const { account, problem } = data;
  return (
    <OfficeShell
      activeHref="/account"
      title="My profile"
      crumbs={<>Your own details and sign-in · only you can change these</>}
    >
      {problem ? <Alert tone="coral">{problem}</Alert> : null}
      {account ? (
        <>
          <Header account={account} />
          <div className="account-grid">
            <DetailsBlock account={account} />
            <EmailBlock account={account} />
            <PasswordBlock />
            <DeviceBlock />
          </div>
        </>
      ) : null}
    </OfficeShell>
  );
}

function useAction() {
  const router = useRouter();
  const [result, setResult] = useState<AccountResult | null>(null);
  const [pending, start] = useTransition();
  const run = (action: () => Promise<AccountResult>, after?: () => void) => {
    setResult(null);
    start(async () => {
      const outcome = await action();
      setResult(outcome);
      if (outcome.ok) {
        after?.();
        router.refresh();
      }
    });
  };
  return { result, pending, run };
}

function Feedback({ result }: { result: AccountResult | null }) {
  if (!result) return null;
  if (!result.ok) return <Alert tone="coral">{result.message}</Alert>;
  return result.message ? <Alert tone="green">{result.message}</Alert> : null;
}

/** Audit-style stamps are UK only (§1.8). */
function ukStamp(iso: string | null): string {
  return iso ? `${formatDateTimeIn(new Date(iso), UK_ZONE)} (UK time)` : '—';
}

function Header({ account }: { account: MyAccount }) {
  const role = account.role as keyof typeof ROLE_LABEL;
  return (
    <section className="panel account-head">
      <Avatar name={account.fullName || account.email} size="lg" />
      <div className="who">
        <h2>{account.fullName || 'No name yet'}</h2>
        <div className="muted sm">
          {account.jobTitle ? `${account.jobTitle} · ` : ''}
          {account.email}
        </div>
      </div>
      <div className="facts">
        <Pill tone="cyan">{ROLE_LABEL[role] ?? account.role}</Pill>
        <span className="xs muted">Last signed in {ukStamp(account.lastSignInAt)}</span>
      </div>
    </section>
  );
}

function DetailsBlock({ account }: { account: MyAccount }) {
  const [fullName, setFullName] = useState(account.fullName);
  const [jobTitle, setJobTitle] = useState(account.jobTitle);
  const [phone, setPhone] = useState(account.phone);
  const { result, pending, run } = useAction();
  const dirty =
    fullName !== account.fullName || jobTitle !== account.jobTitle || phone !== account.phone;

  return (
    <Panel title="Your details">
      <form
        className="account-form"
        onSubmit={(event) => {
          event.preventDefault();
          run(() => saveMyDetails({ fullName, jobTitle, phone }));
        }}
      >
        <Input
          label="Full name"
          value={fullName}
          autoComplete="name"
          required
          hint="Shown in the sidebar and against everything you do in the activity log."
          onChange={(event) => setFullName(event.target.value)}
        />
        <Input
          label="Job title"
          value={jobTitle}
          autoComplete="organization-title"
          placeholder="e.g. Operations manager"
          onChange={(event) => setJobTitle(event.target.value)}
        />
        <Input
          label="Phone"
          type="tel"
          value={phone}
          autoComplete="tel"
          placeholder="+44 7700 900000"
          onChange={(event) => setPhone(event.target.value)}
        />
        <Feedback result={result} />
        <Button type="submit" tone="primary" disabled={pending || !dirty}>
          {pending ? 'Saving…' : 'Save details'}
        </Button>
      </form>
    </Panel>
  );
}

function EmailBlock({ account }: { account: MyAccount }) {
  const [email, setEmail] = useState('');
  const { result, pending, run } = useAction();
  return (
    <Panel title="Sign-in email">
      <form
        className="account-form"
        onSubmit={(event) => {
          event.preventDefault();
          run(
            () => changeMyEmail(email),
            () => setEmail(''),
          );
        }}
      >
        <p className="sm muted">
          You sign in as <b>{account.email}</b>.
          {account.pendingEmail ? (
            <>
              {' '}
              A change to <b>{account.pendingEmail}</b> is waiting for its confirmation link.
            </>
          ) : null}
        </p>
        <Input
          label="New email address"
          type="email"
          value={email}
          autoComplete="email"
          onChange={(event) => setEmail(event.target.value)}
        />
        <Feedback result={result} />
        <Button type="submit" disabled={pending || !email.trim()}>
          {pending ? 'Sending…' : 'Change email'}
        </Button>
      </form>
    </Panel>
  );
}

function PasswordBlock() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const { result, pending, run } = useAction();
  return (
    <Panel title="Password">
      <form
        className="account-form"
        onSubmit={(event) => {
          event.preventDefault();
          run(
            () => changeMyPassword({ current, next, confirm }),
            () => {
              setCurrent('');
              setNext('');
              setConfirm('');
            },
          );
        }}
      >
        <Input
          label="Current password"
          type="password"
          reveal
          value={current}
          autoComplete="current-password"
          onChange={(event) => setCurrent(event.target.value)}
        />
        <Input
          label="New password"
          type="password"
          reveal
          value={next}
          autoComplete="new-password"
          hint="At least 10 characters. Every other device is signed out when it changes."
          onChange={(event) => setNext(event.target.value)}
        />
        <Input
          label="Confirm new password"
          type="password"
          reveal
          value={confirm}
          autoComplete="new-password"
          onChange={(event) => setConfirm(event.target.value)}
        />
        <Feedback result={result} />
        <Button type="submit" disabled={pending || !current || !next || !confirm}>
          {pending ? 'Changing…' : 'Change password'}
        </Button>
      </form>
    </Panel>
  );
}

function DeviceBlock() {
  const { result, pending, run } = useAction();
  return (
    <Panel title="Sessions & appearance">
      <div className="account-form">
        <p className="sm muted">
          Signed in somewhere you should not be — a shared computer, a lost phone? End every session
          except this one.
        </p>
        <Feedback result={result} />
        <Button tone="outline" disabled={pending} onClick={() => run(signOutOtherDevices)}>
          {pending ? 'Signing out…' : 'Sign out other devices'}
        </Button>
        <hr />
        <p className="sm muted">Light or dark, for this browser only.</p>
        <ModeSwitch />
      </div>
    </Panel>
  );
}
