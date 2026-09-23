'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Input } from '@thc/ui';
import { bankErrors, formatSortCode } from '@thc/domain';
import { saveBank } from '../actions';
import { WizardFoot, WizardTop } from './Wizard';

/**
 * 9/11 Bank & payroll — §2.10, wireframes/staff/onboarding-3.html.
 *
 * The save is `staff_save_bank()` — the same door Profile → Payment
 * information uses later — so E5 goes to the office and payroll here too.
 *
 * Deviation from the wireframe, recorded: its "HSBC UK · sort code
 * recognised" line needs a sort-code directory (a paid Vocalink/bank data
 * feed) that is not an input to this project. The format check is shown
 * instead, with the wireframe's own caveat that the account is not
 * verified with the bank.
 */
export function BankStep({
  initial,
}: {
  initial: { accountHolder: string; sortCode: string; accountNumber: string };
}) {
  const router = useRouter();
  const [holder, setHolder] = useState(initial.accountHolder);
  const [sort, setSort] = useState(initial.sortCode);
  const [account, setAccount] = useState(initial.accountNumber);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const errors = bankErrors({ accountHolder: holder, sortCode: sort, accountNumber: account });
  const complete = Object.keys(errors).length === 0;

  function next() {
    setError(null);
    start(async () => {
      const result = await saveBank({
        accountHolder: holder,
        sortCode: sort,
        accountNumber: account,
      });
      if (!result.ok) setError(result.message);
      else router.push('/onboarding/10');
    });
  }

  return (
    <>
      <WizardTop
        step={9}
        heading="Where should we pay you?"
        sub="A UK account in your own name. You’re paid by bank transfer on the Friday after the week you worked (Mon–Sun weeks)."
      />
      <Input
        label={
          <>
            Account holder name <span className="coral">*</span>
          </>
        }
        value={holder}
        onChange={(e) => setHolder(e.target.value)}
        autoComplete="name"
        hint="Exactly as it appears on your bank card or statement."
      />
      <div className="row top">
        <div className="sort-field">
          <Input
            label={
              <>
                Sort code <span className="coral">*</span>
              </>
            }
            mono
            inputMode="numeric"
            placeholder="40-47-84"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            onBlur={() => setSort((s) => formatSortCode(s))}
            error={sort && errors.sortCode ? errors.sortCode : undefined}
          />
        </div>
        <div className="grow">
          <Input
            label={
              <>
                Account number <span className="coral">*</span>
              </>
            }
            mono
            inputMode="numeric"
            placeholder="31926819"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            error={account && errors.accountNumber ? errors.accountNumber : undefined}
          />
        </div>
      </div>
      {complete ? (
        <div className="mcard">
          <div className="row">
            <span className="green">✓</span>
            <div>
              <div className="sm strong">Sort code and account number look right</div>
              <div className="xs muted">
                Format check only — we don’t verify the account with the bank.
              </div>
            </div>
          </div>
        </div>
      ) : null}
      <div className="note xs">
        You can change these later in Profile → Payment information → Bank &amp; payroll. Each
        change is emailed to the office and payroll (E5, §2.10).
      </div>
      {error ? <Alert tone="coral">{error}</Alert> : null}
      <WizardFoot hint={complete ? undefined : 'Enter your account details to continue'}>
        <Button tone="primary" size="lg" block disabled={!complete || pending} onClick={next}>
          {pending ? 'Saving…' : 'Continue'}
        </Button>
      </WizardFoot>
    </>
  );
}
