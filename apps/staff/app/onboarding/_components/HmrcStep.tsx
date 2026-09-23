'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Checkbox, Input, Radio } from '@thc/ui';
import {
  HMRC_DECLARATION,
  HMRC_QUESTIONS,
  STUDENT_LOAN_OPTIONS,
  hmrcMissing,
  isValidNiNumber,
  visibleHmrcQuestions,
} from '@thc/domain';
import type { HmrcForm } from '@thc/domain';
import { submitHmrc } from '../actions';
import { WizardFoot, WizardTop } from './Wizard';

/**
 * 7/11 HMRC New Starter Checklist — §2.8, wireframes/staff/onboarding-2.html.
 *
 * Three sequential Yes/No questions (Q2 only if Q1 = No, Q3 only if Q1 and
 * Q2 are No) from which the DATABASE derives statement A/B/C. The letter
 * is never computed for display here and never sent back: "the worker
 * never sees the resulting letter". Student loan is its own radio set with
 * a separate Postgraduate tick. NI is optional and, once on file, shown
 * masked and locked. No P45 upload exists anywhere (§2.8).
 */
function YesNo({
  value,
  onChange,
  label,
}: {
  value: boolean | null;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <div className="wiz-choices" role="radiogroup" aria-label={label}>
      <Radio checked={value === true} onChange={() => onChange(true)}>
        Yes
      </Radio>
      <Radio checked={value === false} onChange={() => onChange(false)}>
        No
      </Radio>
    </div>
  );
}

export function HmrcStep({ initial, niMasked }: { initial: HmrcForm; niMasked: string | null }) {
  const router = useRouter();
  const [form, setForm] = useState<HmrcForm>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const set = <K extends keyof HmrcForm>(key: K, value: HmrcForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const { q2, q3 } = visibleHmrcQuestions(form);
  const missing = hmrcMissing(form, Boolean(niMasked));
  const hint =
    missing.length > 0
      ? `${missing.join(' and ').replace(/^./, (c) => c.toUpperCase())} to continue`
      : null;
  const niBad = form.niNumber.trim() !== '' && !isValidNiNumber(form.niNumber);
  const nextQuestion =
    form.q1OtherJob === null
      ? 1
      : q2 && form.q2Pension === null
        ? 2
        : q3 && form.q3Since6April === null
          ? 3
          : 0;

  function submit() {
    setError(null);
    start(async () => {
      const result = await submitHmrc(form);
      if (!result.ok) setError(result.message);
      else router.push('/onboarding/8');
    });
  }

  return (
    <>
      <WizardTop
        step={7}
        heading="Your tax position"
        sub="Needed for your tax code. The tax year starts 6 April. Have a P45? Read the figures off it — we don’t take the document."
      />

      <div className={`wiz-block ${nextQuestion === 1 ? 'focus' : ''}`}>
        <div className="qt">1 · {HMRC_QUESTIONS.q1OtherJob}</div>
        <YesNo label="Another job" value={form.q1OtherJob} onChange={(v) => set('q1OtherJob', v)} />
      </div>
      {q2 ? (
        <div className={`wiz-block ${nextQuestion === 2 ? 'focus' : ''}`}>
          <div className="qt">2 · {HMRC_QUESTIONS.q2Pension}</div>
          <YesNo label="Pension" value={form.q2Pension} onChange={(v) => set('q2Pension', v)} />
        </div>
      ) : null}
      {q3 ? (
        <div className={`wiz-block ${nextQuestion === 3 ? 'focus' : ''}`}>
          <div className="qt">3 · {HMRC_QUESTIONS.q3Since6April}</div>
          <YesNo
            label="Since 6 April"
            value={form.q3Since6April}
            onChange={(v) => set('q3Since6April', v)}
          />
        </div>
      ) : null}

      <div className="wiz-block">
        <div className="qt">Student loan</div>
        <div className="wiz-choices" role="radiogroup" aria-label="Student loan">
          {STUDENT_LOAN_OPTIONS.map((o) => (
            <Radio
              key={o.value}
              checked={form.studentLoan === o.value}
              onChange={() => set('studentLoan', o.value)}
            >
              {o.label}
            </Radio>
          ))}
        </div>
        <Checkbox checked={form.postgraduateLoan} onChange={(v) => set('postgraduateLoan', v)}>
          I’m also repaying a <b>Postgraduate Loan</b>{' '}
          <span className="xs muted">— can be ticked together with a plan</span>
        </Checkbox>
      </div>

      {niMasked ? (
        <Input
          label="National Insurance number · locked"
          mono
          value={niMasked}
          readOnly
          hint="On file and locked. Any correction goes through the office (§2.8)."
        />
      ) : (
        <Input
          label="National Insurance number · optional"
          mono
          autoCapitalize="characters"
          placeholder="AB 12 34 56 C"
          value={form.niNumber}
          onChange={(e) => set('niNumber', e.target.value)}
          error={
            niBad
              ? 'That doesn’t look like an NI number. It should look like AB123456C.'
              : undefined
          }
          hint="Leave blank if you don’t have one yet — you can still be onboarded and paid; add it in Profile details once HMRC issues it (§2.10). Once saved it’s shown masked and locked."
        />
      )}

      <label className={`check boxed ${form.declared ? 'on' : ''}`}>
        <input
          type="checkbox"
          className="hide"
          checked={form.declared}
          onChange={(e) => set('declared', e.target.checked)}
        />
        <span className={`box ${form.declared ? 'on' : ''}`} aria-hidden="true" />
        <span>{HMRC_DECLARATION}</span>
      </label>

      {error ? <Alert tone="coral">{error}</Alert> : null}

      <WizardFoot hint={hint ?? undefined}>
        <Button tone="primary" size="lg" block disabled={Boolean(hint) || pending} onClick={submit}>
          {pending ? 'Submitting…' : 'Submit checklist'}
        </Button>
      </WizardFoot>
    </>
  );
}
