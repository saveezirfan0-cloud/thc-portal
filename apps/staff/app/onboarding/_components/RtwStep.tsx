'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Checkbox, Input, OptionRow, SegToggle, Select } from '@thc/ui';
import {
  BRANCH_HEADING,
  GENDER_OPTIONS,
  NI_EVIDENCE_ACCEPTED,
  RTW_BRANCHES,
  VISA_TYPES,
  isValidShareCode,
  needsShareCode,
  needsVisaExpiry,
  needsVisaType,
  requiredDocuments,
  rtwErrors,
  rtwFooterHint,
} from '@thc/domain';
import type { Gender, RtwBranch, RtwForm, UkDocChoice } from '@thc/domain';
import { saveRightToWork } from '../actions';
import { WizardFoot, WizardTop } from './Wizard';

/**
 * 1/11 Right to work — §2.5, wireframes/staff/onboarding-1.html (six states).
 *
 * The branch decides the documents (§2.5 pts 1–5, exactly), DOB is asked in
 * every branch, the share code is TYPED and validated before anything goes
 * near gov.uk, and the 48-hour opt-out is offered to everyone with the
 * wireframe's per-branch caveat (it never overrides a visa limit, §4.4).
 *
 * Gender sits under the DOB, in every branch: the §9.9 New Starter (HMRC)
 * report carries "Gender (M/F)" and is sent the Monday after the first
 * paid shift, so it has to be on file by then. The two options are the two
 * HMRC's Starter Checklist takes; the shared segment control shows them.
 */
const OPT_OUT_NOTE: Record<RtwBranch, string> = {
  uk_irish: 'Optional — no visa limit applies to you (§4.4).',
  eu_settled: 'Optional (§4.4).',
  work_visa: 'Only within what your visa allows — visa conditions take precedence (§4.4).',
  international_student: 'Applies outside term time only (§4.4).',
  dependant_other: 'The conditions of your visa decide whether this applies (§4.4).',
};

export function RtwStep({ initial, today }: { initial: RtwForm; today: string }) {
  const router = useRouter();
  const [form, setForm] = useState<RtwForm>(initial);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const set = <K extends keyof RtwForm>(key: K, value: RtwForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const errors = rtwErrors(form, today);
  const hint = rtwFooterHint(form, today);
  const branch = form.branch;

  function next() {
    setError(null);
    start(async () => {
      const result = await saveRightToWork({
        branch: branch ?? '',
        dob: form.dob,
        gender: form.gender,
        shareCode: form.shareCode,
        visaType: form.visaType,
        visaExpiry: form.visaExpiry,
        ukChoice: branch === 'uk_irish' ? form.ukChoice : null,
        wtrOptOut: form.wtrOptOut,
      });
      if (!result.ok) setError(result.message);
      else router.push('/onboarding/2');
    });
  }

  if (!branch) {
    return (
      <>
        <WizardTop
          step={1}
          heading="Which describes you?"
          sub="This decides which documents we ask for. We check your right to work with gov.uk (§2.6)."
        />
        <div role="radiogroup" aria-label="Right to work" className="wiz-options">
          {RTW_BRANCHES.map((b) => (
            <OptionRow
              key={b.key}
              title={b.title}
              description={b.description}
              selected={false}
              onSelect={() =>
                setForm((f) => ({
                  ...f,
                  branch: b.key,
                  ukChoice: b.key === 'uk_irish' ? (f.ukChoice ?? 'passport') : null,
                }))
              }
            />
          ))}
        </div>
        <WizardFoot hint="Choose one to continue">
          <Button tone="primary" size="lg" block disabled>
            Continue
          </Button>
        </WizardFoot>
      </>
    );
  }

  const docs = requiredDocuments(branch, form.ukChoice ?? 'passport');
  const shareOk = isValidShareCode(form.shareCode);
  const showShareError = form.shareCode.trim() !== '' && !shareOk;

  return (
    <>
      <WizardTop
        step={1}
        heading={BRANCH_HEADING[branch]}
        aside={
          <button type="button" className="ml-auto linkbtn" onClick={() => set('branch', null)}>
            Change
          </button>
        }
      />

      <Input
        label={
          <>
            Date of birth <span className="coral">*</span>
          </>
        }
        type="date"
        mono
        value={form.dob}
        max={today}
        onChange={(e) => set('dob', e.target.value)}
        onBlur={() => setTouched(true)}
        error={touched ? errors.dob : undefined}
        hint="Required in every branch (§2.5)."
      />

      <div className="field">
        <span className="label">
          Gender <span className="coral">*</span>
        </span>
        <SegToggle<Gender | ''>
          block
          aria-label="Gender"
          options={GENDER_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          value={form.gender ?? ''}
          onChange={(v) => set('gender', v === '' ? null : v)}
        />
        <span className="hint">
          For the HMRC New Starter report only — it takes Male or Female (§9.9).
        </span>
      </div>

      {needsShareCode(branch) ? (
        <Input
          label={
            <>
              Share code <span className="coral">*</span>
            </>
          }
          mono
          autoCapitalize="characters"
          autoComplete="off"
          placeholder="W123AB4CD"
          value={form.shareCode}
          onChange={(e) => set('shareCode', e.target.value)}
          error={showShareError ? errors.shareCode : undefined}
          hint={
            shareOk
              ? '✓ 9 characters starting with W — pasted with spaces is fine.'
              : 'Get it at gov.uk/prove-right-to-work · valid for about 90 days.'
          }
        />
      ) : null}

      {needsVisaType(branch) ? (
        <Select
          label={
            <>
              Visa type <span className="coral">*</span>
            </>
          }
          value={form.visaType}
          onChange={(e) => set('visaType', e.target.value)}
        >
          <option value="">Choose…</option>
          {VISA_TYPES.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </Select>
      ) : null}

      {needsVisaExpiry(branch) ? (
        <Input
          label={
            <>
              {branch === 'work_visa' ? 'Visa expiry' : 'Visa / status expiry'}{' '}
              <span className="coral">*</span>
            </>
          }
          type="date"
          mono
          min={today}
          value={form.visaExpiry}
          onChange={(e) => set('visaExpiry', e.target.value)}
          error={form.visaExpiry ? errors.visaExpiry : undefined}
          hint="Cross-checked by the office against the document you upload and the gov.uk result."
        />
      ) : null}

      {branch === 'uk_irish' ? (
        <div className="field">
          <span className="label">Which documents will you provide?</span>
          <SegToggle<UkDocChoice>
            block
            options={[
              { value: 'passport', label: 'Passport' },
              { value: 'birth_certificate', label: 'Birth cert. + NI evidence' },
            ]}
            value={form.ukChoice ?? 'passport'}
            onChange={(v) => set('ukChoice', v)}
          />
        </div>
      ) : null}

      <div className="label">Required documents · uploaded at step 4</div>
      <div className="wiz-list">
        {docs.map((d) => (
          <div className="docrow" key={d.key}>
            <span className="ico">PDF</span>
            <div>
              <div className="t">{d.label}</div>
              <div className="m">PDF, JPG, PNG or HEIC, up to 10 MB</div>
            </div>
            <span className="pill right">Step 4</span>
          </div>
        ))}
        {branch === 'uk_irish' && form.ukChoice !== 'birth_certificate' ? (
          <div className="docrow off">
            <span className="ico">—</span>
            <div>
              <div className="t">Birth certificate + NI evidence</div>
              <div className="m">
                Only if you don’t have a passport. NI evidence: {NI_EVIDENCE_ACCEPTED.join(', ')}{' '}
                (§2.5 pt 7).
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {branch === 'international_student' ? (
        <Alert tone="cyan">
          In term time you can work up to <b>20 h/week</b> — a visa condition. Outside term: 48 h
          (or more with the opt-out below). Nobody sets this — it follows your verified term dates
          (§4.4).
        </Alert>
      ) : null}

      <Checkbox checked={form.wtrOptOut} onChange={(v) => set('wtrOptOut', v)}>
        I opt out of the 48-hour weekly working limit (Working Time Regulations). I can withdraw
        this on notice. <span className="xs muted">{OPT_OUT_NOTE[branch]}</span>
      </Checkbox>

      {branch === 'eu_settled' ? (
        <div className="note xs">
          Pre-settled status: your “right to work until” date comes back from the gov.uk check and
          becomes the expiry we remind you about (§2.6, §4.2).
        </div>
      ) : null}

      {error ? <Alert tone="coral">{error}</Alert> : null}

      <WizardFoot hint={hint ?? undefined}>
        <Button tone="primary" size="lg" block disabled={Boolean(hint) || pending} onClick={next}>
          {pending ? 'Saving…' : 'Continue'}
        </Button>
      </WizardFoot>
    </>
  );
}
