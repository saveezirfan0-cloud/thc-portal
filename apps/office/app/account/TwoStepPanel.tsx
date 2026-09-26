'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { UK_ZONE, formatDateTimeIn } from '@thc/domain';
import { Alert, Button, Input, Panel, Pill } from '@thc/ui';
import { groupSecret } from '../login/two-step';
import type { MyTwoStep } from './data';
import {
  type TwoStepResult,
  cancelTwoStepSetup,
  confirmTwoStepSetup,
  removeTwoStep,
  startTwoStepSetup,
} from './two-step-actions';
import '../login/two-step.css';

/**
 * "Two-step sign-in" on /account (ADR-0057).
 *
 * Three states: off (what it is, and Set up) → setting up (scan the QR code
 * or type the key, then the first code) → on (which phone, since when, and
 * Remove with a fresh code). Written for a manager who has never used an
 * authenticator app: say what to install, what to scan, what to type.
 */
export function TwoStepPanel({ twoStep }: { twoStep: MyTwoStep }) {
  return (
    <Panel
      title="Two-step sign-in"
      actions={twoStep.on ? <Pill tone="green">On</Pill> : <Pill tone="neutral">Off</Pill>}
    >
      {twoStep.on ? <OnState twoStep={twoStep} /> : <OffState />}
    </Panel>
  );
}

function Feedback({ result }: { result: TwoStepResult | null }) {
  if (!result) return null;
  if (!result.ok) return <Alert tone="coral">{result.message}</Alert>;
  return result.message ? <Alert tone="green">{result.message}</Alert> : null;
}

interface Setup {
  factorId: string;
  qrCode: string;
  secret: string;
}

function OffState() {
  const router = useRouter();
  const [deviceName, setDeviceName] = useState('My phone');
  const [setup, setSetup] = useState<Setup | null>(null);
  const [code, setCode] = useState('');
  const [result, setResult] = useState<TwoStepResult | null>(null);
  const [pending, start] = useTransition();

  const begin = () => {
    setResult(null);
    start(async () => {
      const outcome = await startTwoStepSetup(deviceName);
      if (outcome.ok) {
        setSetup({ factorId: outcome.factorId, qrCode: outcome.qrCode, secret: outcome.secret });
        setCode('');
      } else {
        setResult(outcome);
      }
    });
  };

  const confirm = (factorId: string) => {
    setResult(null);
    start(async () => {
      const outcome = await confirmTwoStepSetup({ factorId, code });
      setResult(outcome);
      if (outcome.ok) {
        setSetup(null);
        router.refresh();
      }
    });
  };

  const cancel = (factorId: string) => {
    setResult(null);
    start(async () => {
      await cancelTwoStepSetup(factorId);
      setSetup(null);
      setCode('');
    });
  };

  if (!setup) {
    return (
      <form
        className="account-form"
        onSubmit={(event) => {
          event.preventDefault();
          begin();
        }}
      >
        <p className="sm muted">
          Adds a second check when you sign in: after your password, you type a 6-digit code from an
          app on your phone. Someone who learns your password still cannot get in without your
          phone.
        </p>
        <p className="sm muted">
          You need a free authenticator app on your phone — Google Authenticator or Microsoft
          Authenticator both work. Install one first.
        </p>
        <Input
          label="Which phone is it on?"
          value={deviceName}
          maxLength={40}
          hint="Just a name, so you know which phone to reach for later."
          onChange={(event) => setDeviceName(event.target.value)}
        />
        <Feedback result={result} />
        <Button type="submit" tone="primary" disabled={pending || !deviceName.trim()}>
          {pending ? 'Preparing…' : 'Set up two-step sign-in'}
        </Button>
      </form>
    );
  }

  return (
    <form
      className="account-form"
      onSubmit={(event) => {
        event.preventDefault();
        confirm(setup.factorId);
      }}
    >
      <p className="sm">
        <b>1.</b> Open your authenticator app, choose to add an account, and scan this code with
        your phone’s camera.
      </p>
      {/* GoTrue returns the QR code as an SVG data URI; nothing to fetch. */}
      <img
        className="twostep-qr"
        src={setup.qrCode}
        width={180}
        height={180}
        alt="QR code to scan with your authenticator app"
      />
      <p className="sm muted">
        Can’t scan it? In the app choose “enter a set-up key” and type this key instead:
      </p>
      <code className="twostep-secret" aria-label="Set-up key">
        {groupSecret(setup.secret)}
      </code>
      <p className="sm">
        <b>2.</b> The app now shows “THC Back Office” with a 6-digit number that changes every 30
        seconds. Type the number showing now.
      </p>
      <Input
        label="6-digit code"
        value={code}
        mono
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={9}
        placeholder="123 456"
        className="twostep-code"
        onChange={(event) => setCode(event.target.value)}
      />
      <Feedback result={result} />
      <div className="twostep-actions">
        <Button type="submit" tone="primary" disabled={pending || !code.trim()}>
          {pending ? 'Checking…' : 'Turn on two-step sign-in'}
        </Button>
        <Button tone="ghost" disabled={pending} onClick={() => cancel(setup.factorId)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function OnState({ twoStep }: { twoStep: MyTwoStep }) {
  const router = useRouter();
  const [removing, setRemoving] = useState(false);
  const [code, setCode] = useState('');
  const [result, setResult] = useState<TwoStepResult | null>(null);
  const [pending, start] = useTransition();

  const remove = () => {
    setResult(null);
    start(async () => {
      const outcome = await removeTwoStep(code);
      setResult(outcome);
      if (outcome.ok) {
        setRemoving(false);
        setCode('');
        router.refresh();
      }
    });
  };

  return (
    <form
      className="account-form"
      onSubmit={(event) => {
        event.preventDefault();
        remove();
      }}
    >
      <p className="sm muted">
        After your password, you are asked for the 6-digit code from the authenticator app on{' '}
        <b>{twoStep.deviceName ?? 'your phone'}</b>
        {twoStep.since ? (
          <> — set up {formatDateTimeIn(new Date(twoStep.since), UK_ZONE)} (UK time)</>
        ) : null}
        .
      </p>
      <p className="sm muted">
        Changing phone? Remove it here while you still have the old one, then set it up again on the
        new one.
      </p>
      {removing ? (
        <>
          <Input
            label="Code from your phone, to confirm"
            value={code}
            mono
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={9}
            placeholder="123 456"
            className="twostep-code"
            hint="Removing it means your password alone lets you in again."
            onChange={(event) => setCode(event.target.value)}
          />
          <Feedback result={result} />
          <div className="twostep-actions">
            <Button type="submit" tone="danger" disabled={pending || !code.trim()}>
              {pending ? 'Removing…' : 'Remove two-step sign-in'}
            </Button>
            <Button
              tone="ghost"
              disabled={pending}
              onClick={() => {
                setRemoving(false);
                setCode('');
                setResult(null);
              }}
            >
              Keep it
            </Button>
          </div>
        </>
      ) : (
        <>
          <Feedback result={result} />
          <Button tone="outline" onClick={() => setRemoving(true)}>
            Remove
          </Button>
        </>
      )}
    </form>
  );
}
