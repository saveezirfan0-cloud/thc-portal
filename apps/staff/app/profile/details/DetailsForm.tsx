'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Input, Note } from '@thc/ui';
import {
  confirmEmailChange,
  requestEmailChange,
  saveContactDetails,
  saveNiNumber,
} from '../actions';
import type { StaffProfile } from '../types';
import { PhotoField } from './PhotoField';

/**
 * Profile details — §10.1, `wireframes/staff/profile.html`.
 *
 * What is editable and what is not is the whole screen:
 *
 *   Full name     LOCKED. "Tied to your right-to-work check and payroll —
 *                 corrections go through the office." No function in
 *                 actions.ts writes it, so this is a statement of fact
 *                 rather than a disabled input hiding a live field.
 *   NI number     Masked and locked ONCE ENTERED. A worker who joined
 *                 without one — which is allowed (§2.10) — can add it
 *                 here, and doing so sends E6.
 *   Avatar        Set once, then locked (§10.1). See PhotoField.
 *   Mobile        Editable, silently.
 *   Email         Editable, but only through a confirmation code sent to
 *                 the NEW address; the old one stays until the code is
 *                 entered. Then E7.
 *   Home address  Editable. E7, because the office needs to know: it
 *                 drives the home-to-venue distance in §6 scoring.
 */
export function DetailsForm({
  profile,
  photoUrl,
}: {
  profile: StaffProfile;
  photoUrl: string | null;
}) {
  const router = useRouter();
  const name = `${profile.firstName} ${profile.lastName}`.trim();

  const [phone, setPhone] = useState(profile.phone);
  const [address, setAddress] = useState(profile.homeAddress ?? '');
  const [ni, setNi] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    setNote(null);
    setError(null);
    start(async () => {
      const result = await saveContactDetails(phone, address);
      if (!result.ok) setError(result.message);
      else {
        setNote(result.note ?? 'Saved.');
        router.refresh();
      }
    });
  }

  function addNi() {
    setNote(null);
    setError(null);
    start(async () => {
      const result = await saveNiNumber(ni);
      if (!result.ok) setError(result.message);
      else {
        setNi('');
        setNote('Saved. Payroll has been notified.');
        router.refresh();
      }
    });
  }

  return (
    <>
      <PhotoField name={name} photoUrl={photoUrl} locked={profile.photoLocked} />

      <div className="field lockf">
        <span className="label">Full name</span>
        <input className="input" value={name} readOnly />
        <span className="hint">
          Tied to your right-to-work check and payroll — corrections go through the office.
        </span>
      </div>

      {profile.hasNiNumber ? (
        <div className="field lockf">
          <span className="label">National Insurance number</span>
          <input className="input mono" value={profile.niMasked ?? ''} readOnly />
          <span className="hint">Masked and locked once entered.</span>
        </div>
      ) : (
        <>
          <Input
            label="National Insurance number"
            mono
            value={ni}
            onChange={(event) => setNi(event.target.value)}
            placeholder="AB123456C"
            hint="You joined without one. Add it here once HMRC issues it — we’ll pass it to payroll. It locks once saved."
          />
          <Button tone="outline" block disabled={pending || ni.trim().length === 0} onClick={addNi}>
            Save National Insurance number
          </Button>
        </>
      )}

      <Input
        label="Mobile"
        mono
        type="tel"
        value={phone}
        onChange={(event) => setPhone(event.target.value)}
      />

      <EmailField current={profile.email} />

      <Input
        label="Home address"
        value={address}
        onChange={(event) => setAddress(event.target.value)}
        hint="Used for venue distances. Changing it notifies the office (E7)."
      />

      {error ? <Alert tone="coral">{error}</Alert> : null}
      {note ? <Alert tone="green">{note}</Alert> : null}

      <Button tone="primary" size="lg" block disabled={pending} onClick={save}>
        {pending ? 'Saving…' : 'Save changes'}
      </Button>

      <Note>
        We don’t move the map pin you dropped during onboarding when you edit this address — the
        office does that, so a typo can’t quietly change which shifts you’re offered.
      </Note>
    </>
  );
}

/**
 * The email change and its confirmation code (§10.1).
 *
 * "A new email is verified via a confirmation code before it replaces the
 * old one." Supabase Auth owns the code and the address on `auth.users`;
 * `staff_sync_email()` copies the verified address onto the profile and
 * queues E7. Until the code is accepted, nothing anywhere has changed — so
 * an abandoned attempt leaves no trace and sends no email.
 */
function EmailField({ current }: { current: string }) {
  const router = useRouter();
  const [step, setStep] = useState<'idle' | 'entering' | 'verifying'>('idle');
  const [next, setNext] = useState('');
  const [code, setCode] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (step === 'idle') {
    return (
      <div className="field">
        <span className="label">Email</span>
        <div className="input-row">
          <input className="input" value={current} readOnly />
          <button type="button" className="addon" onClick={() => setStep('entering')}>
            Change
          </button>
        </div>
        <span className="hint">
          A new email is verified with a code before it replaces this one.
        </span>
      </div>
    );
  }

  if (step === 'entering') {
    return (
      <>
        <Input
          label="New email address"
          type="email"
          autoFocus
          value={next}
          onChange={(event) => setNext(event.target.value)}
          hint={`We’ll send a 6-digit code there. ${current} stays in place until you enter it.`}
        />
        {error ? <Alert tone="coral">{error}</Alert> : null}
        <div className="row" style={{ gap: 'var(--sp-8)' }}>
          <Button
            tone="primary"
            block
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                const result = await requestEmailChange(next);
                if (!result.ok) setError(result.message);
                else {
                  setNote(result.note ?? null);
                  setStep('verifying');
                }
              })
            }
          >
            Send code
          </Button>
          <Button tone="ghost" block onClick={() => setStep('idle')} disabled={pending}>
            Cancel
          </Button>
        </div>
      </>
    );
  }

  return (
    <div className="field">
      <span className="label">Verify your new email</span>
      <p className="sm muted">{note}</p>
      <div className="code-row">
        <input
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
          aria-label="6-digit code"
        />
      </div>
      {error ? <Alert tone="coral">{error}</Alert> : null}
      <Button
        tone="primary"
        size="lg"
        block
        disabled={pending || code.length < 6}
        onClick={() =>
          start(async () => {
            setError(null);
            const result = await confirmEmailChange(next, code);
            if (!result.ok) setError(result.message);
            else {
              setStep('idle');
              setCode('');
              router.refresh();
            }
          })
        }
      >
        Verify &amp; save
      </Button>
      <Button tone="ghost" block onClick={() => setStep('idle')} disabled={pending}>
        Cancel — keep {current}
      </Button>
    </div>
  );
}
