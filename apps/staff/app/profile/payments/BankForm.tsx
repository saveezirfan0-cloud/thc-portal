'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Input, Note } from '@thc/ui';
import { saveBankDetails } from '../actions';
import type { BankDetails } from '../types';

/**
 * Bank & payroll — §2.10, editable again here per §10.1.
 *
 * "The same account holder / sort code / account number fields as
 * onboarding, editable here via a 'Save changes' button, which triggers the
 * same E5 notification as at onboarding."
 *
 * E5 is queued by `staff_save_bank()` in the same transaction as the write,
 * so a saved change cannot exist without the office and payroll hearing
 * about it. The note below says who is told, because a worker who does not
 * know their bank change is reviewed will ring the office to ask.
 */
export function BankForm({ bank }: { bank: BankDetails | null }) {
  const router = useRouter();
  const [holder, setHolder] = useState(bank?.accountHolder ?? '');
  const [sort, setSort] = useState(bank?.sortCode ?? '');
  const [account, setAccount] = useState(bank?.accountNumber ?? '');
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    setNote(null);
    setError(null);
    start(async () => {
      const result = await saveBankDetails(holder, sort, account);
      if (!result.ok) setError(result.message);
      else {
        setNote(result.note ?? 'Saved.');
        router.refresh();
      }
    });
  }

  return (
    <>
      <Input
        label="Account holder name"
        value={holder}
        onChange={(event) => setHolder(event.target.value)}
        autoComplete="name"
      />
      <div className="row" style={{ gap: 'var(--sp-10)', alignItems: 'flex-start' }}>
        <div style={{ width: 130 }}>
          <Input
            label="Sort code"
            mono
            inputMode="numeric"
            placeholder="40-47-84"
            value={sort}
            onChange={(event) => setSort(event.target.value)}
          />
        </div>
        <div style={{ flex: 1 }}>
          <Input
            label="Account number"
            mono
            inputMode="numeric"
            placeholder="31926819"
            value={account}
            onChange={(event) => setAccount(event.target.value)}
          />
        </div>
      </div>

      {error ? <Alert tone="coral">{error}</Alert> : null}
      {note ? <Alert tone="green">{note}</Alert> : null}

      <Button tone="primary" size="lg" block disabled={pending} onClick={save}>
        {pending ? 'Saving…' : 'Save changes'}
      </Button>

      <Note>
        Changes apply from the next payroll run. When you save, an email goes to the office and to
        payroll to flag the change.
      </Note>
    </>
  );
}
