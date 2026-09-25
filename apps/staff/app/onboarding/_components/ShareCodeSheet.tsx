'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Input, Sheet } from '@thc/ui';
import { shareCodeError } from '@thc/domain';
import { reenterShareCode } from '../actions';

/**
 * Enter the share code again — after the automated gov.uk check did not
 * recognise it with this date of birth, or the office rejected it (§2.5,
 * §2.6, N8; ADR-0025). Both fields, because "check both and try again" is
 * what the reason asks: a mistyped date of birth is as likely as a mistyped
 * code. Validated as step 1 validates it before anything goes to gov.uk.
 */
export function ShareCodeSheet({
  open,
  dob,
  reason,
  onClose,
}: {
  open: boolean;
  /** YYYY-MM-DD on file. */
  dob: string | null;
  /** The reason the last code was rejected, word for word. */
  reason: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [birth, setBirth] = useState(dob?.slice(0, 10) ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const codeError = code ? shareCodeError(code) : null;
  const ready = code !== '' && codeError === null && birth !== '';

  function submit() {
    setError(null);
    start(async () => {
      const result = await reenterShareCode({ shareCode: code, dob: birth });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onClose();
      router.refresh();
    });
  }

  return (
    <Sheet
      open={open}
      onClose={pending ? () => undefined : onClose}
      label="Enter your share code again"
    >
      <div className="strong">Enter your share code again</div>
      {reason ? <Alert tone="amber">{reason}</Alert> : null}
      <Input
        label="Share code"
        mono
        value={code}
        onChange={(event) => setCode(event.target.value)}
        placeholder="W12 3AB 4CD"
        hint="From gov.uk/prove-right-to-work · 9 letters and numbers starting with W."
        {...(codeError ? { error: codeError } : {})}
      />
      <Input
        label="Date of birth"
        type="date"
        value={birth}
        onChange={(event) => setBirth(event.target.value)}
        hint="Must match the date of birth gov.uk holds for you."
      />
      {error ? <Alert tone="coral">{error}</Alert> : null}
      <Button tone="primary" block disabled={!ready || pending} onClick={submit}>
        {pending ? 'Sending…' : 'Check with gov.uk'}
      </Button>
      <Button tone="ghost" block onClick={onClose} disabled={pending}>
        Cancel
      </Button>
    </Sheet>
  );
}
