'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button } from '@thc/ui';
import { contractParagraphs } from '../content/contract';
import { signContract } from '../actions';
import { WizardFoot, WizardTop } from './Wizard';

/**
 * 10/11 Contract — §2.11, §1.8; wireframes/staff/onboarding-3.html
 * (reading, then signed).
 *
 * "A tick-box 'I agree' = the signature (the timestamp is recorded:
 * 'Signed electronically · date/time — this timestamp is your
 * signature')." Ticking it IS signing: `sign_contract()` records the
 * version shown and the instant, the candidate becomes compliant and the
 * Employee ID is issued. The stamp comes back from the database already in
 * UK time and is shown as it comes — an audit record is never converted to
 * the viewer's zone (§1.8).
 */
export function ContractStep({
  version,
  title,
  body,
  isPlaceholder,
  signedStamp,
}: {
  version: string;
  title: string;
  body: string;
  isPlaceholder: boolean;
  signedStamp: string | null;
}) {
  const router = useRouter();
  const [stamp, setStamp] = useState<string | null>(signedStamp);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const signed = Boolean(stamp);

  function sign() {
    if (signed) return;
    setError(null);
    start(async () => {
      const result = await signContract(version);
      if (!result.ok) setError(result.message);
      else setStamp(result.stamp);
    });
  }

  return (
    <>
      <WizardTop
        step={10}
        heading="Zero-hours agreement"
        sub={signed ? undefined : 'Please read it all. Ticking “I agree” signs it.'}
      />
      {isPlaceholder ? (
        <div className="note xs">
          Draft wording: THC’s own agreement replaces this text before go-live. Each published
          version is kept exactly as signed.
        </div>
      ) : null}
      <div className={`contract ${signed ? 'short' : ''}`} tabIndex={0} aria-label={title}>
        <h4>{title}</h4>
        {contractParagraphs(body).map((p, i) => (
          <p key={i}>
            {p.heading ? <b>{p.heading}</b> : null} {p.text}
          </p>
        ))}
      </div>

      <label className={`check boxed ${signed ? 'on' : ''}`}>
        <input
          type="checkbox"
          className="check-input"
          checked={signed}
          disabled={signed || pending}
          onChange={(e) => {
            if (e.target.checked) sign();
          }}
        />
        <span className={`box ${signed ? 'on' : ''}`} aria-hidden="true" />
        <span>
          <b>I agree</b> to the zero-hours agreement above. Ticking this box is my electronic
          signature.
        </span>
      </label>

      {pending ? <Alert tone="cyan">Signing…</Alert> : null}
      {stamp ? (
        <>
          <div className="sig">
            Signed electronically · {stamp} — this timestamp is your signature
          </div>
          <div className="xs muted">
            A copy of the signed agreement is kept on your profile. The timestamp is always shown in
            UK time, wherever you are.
          </div>
        </>
      ) : null}
      {error ? <Alert tone="coral">{error}</Alert> : null}

      <WizardFoot hint={signed ? undefined : 'Tick “I agree” to sign and continue'}>
        <Button
          tone="primary"
          size="lg"
          block
          disabled={!signed}
          onClick={() => router.push('/onboarding/11')}
        >
          Continue
        </Button>
      </WizardFoot>
    </>
  );
}
