'use client';

import { useActionState } from 'react';
import { Alert, Button, Input } from '@thc/ui';
import { verifyTwoStep } from './actions';

/**
 * The code step's form (ADR-0057). One field: numeric keypad on a phone,
 * and `one-time-code` so iOS / Android offer a code from the authenticator
 * where they can. A space or dash in the pasted code is fine; the server
 * strips it (`normaliseCode`).
 */
export function VerifyForm({ next, intro }: { next?: string | undefined; intro: string }) {
  const [error, formAction, pending] = useActionState(verifyTwoStep, null);
  return (
    <form action={formAction} className="twostep-form">
      <p className="sm muted">{intro}</p>
      {error ? <Alert tone="coral">{error}</Alert> : null}
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <Input
        label="6-digit code"
        name="code"
        mono
        required
        autoFocus
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={9}
        placeholder="123 456"
        className="twostep-code"
        error={error ? ' ' : undefined}
      />
      <Button type="submit" tone="primary" size="lg" block disabled={pending}>
        {pending ? 'Checking…' : 'Continue'}
      </Button>
    </form>
  );
}
