'use client';

import { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Addon,
  Alert,
  Button,
  Checkbox,
  Input,
  InputRow,
  OptionRow,
  SegToggle,
  Select,
} from '@thc/ui';
import {
  BRANCH_HEADING,
  NI_EVIDENCE_ACCEPTED,
  RTW_BRANCHES,
  VISA_TYPES,
  isValidShareCode,
  needsHomeOfficeRef,
  needsShareCode,
  needsVisaType,
  requiredDocuments,
  rtwErrors,
  rtwFooterHint,
} from '@thc/domain';
import type { RtwBranch, RtwForm, UkDocChoice } from '@thc/domain';
import { saveRightToWork } from '../actions';
import { WizardFoot, WizardTop } from './Wizard';

/**
 * 1/11 Right to work — §2.5, wireframes/staff/onboarding-1.html (six states).
 *
 * The branch decides the documents (§2.5 pts 1–5 as narrowed by ADR-0078),
 * DOB is asked in every branch, the share code is TYPED and validated before
 * anything goes near gov.uk, and the 48-hour opt-out is offered to everyone
 * with the wireframe's per-branch caveat (it never overrides a visa limit,
 * §4.4). No visa or status expiry is typed in any branch: the gov.uk
 * share-code check returns the right-to-work-until date (ADR-0078).
 *
 * The Home Office check branch (ADR-0177, THC 21.10.2026) has no share code:
 * it asks for the Home Office reference the office puts on its Employer
 * Checking Service form, and nothing is uploaded at step 4.
 */
const OPT_OUT_NOTE: Record<RtwBranch, string> = {
  uk_irish: 'Optional — no visa limit applies to you.',
  eu_settled: 'Optional.',
  work_visa: 'Only within what your visa allows — visa conditions take precedence.',
  international_student: 'Applies outside term time only.',
  dependant_other: 'The conditions of your visa decide whether this applies.',
  home_office_check: 'The conditions of your permission to work decide whether this applies.',
};

export function RtwStep({ initial, today }: { initial: RtwForm; today: string }) {
  const router = useRouter();
  const [form, setForm] = useState<RtwForm>(initial);
  const [touched, setTouched] = useState(false);
  const [refTouched, setRefTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // Every hook runs before the branch picker's early return: a hook called
  // only once a branch is chosen changes the hook count between renders,
  // and React throws on the click that picks the branch.
  const shareId = useId();

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
        shareCode: branch && needsShareCode(branch) ? form.shareCode : '',
        homeOfficeRef: branch && needsHomeOfficeRef(branch) ? form.homeOfficeRef : '',
        visaType: form.visaType,
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
          sub="This decides which documents we ask for. We check your right to work with gov.uk."
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
        hint="Required in every branch."
      />

      {needsShareCode(branch) ? (
        // Hand-built rather than <Input>, for the wireframe's green ✓ addon
        // welded to the field once the code is valid (onboarding-1.html,
        // "share code valid").
        <div className="field">
          <label className="label" htmlFor={shareId}>
            Share code <span className="coral">*</span>
          </label>
          <InputRow>
            <input
              id={shareId}
              className={`input mono${showShareError ? ' err' : ''}`}
              autoCapitalize="characters"
              autoComplete="off"
              placeholder="W123AB4CD"
              aria-invalid={showShareError ? true : undefined}
              value={form.shareCode}
              onChange={(e) => set('shareCode', e.target.value)}
            />
            {shareOk ? (
              <Addon>
                <span className="green">✓</span>
              </Addon>
            ) : null}
          </InputRow>
          {showShareError ? (
            <span className="error" role="alert">
              {errors.shareCode}
            </span>
          ) : (
            <span className="hint">
              {shareOk
                ? '9 characters starting with W, e.g. W123AB4CD — pasted with spaces is fine.'
                : 'Get it at gov.uk/prove-right-to-work · valid for about 90 days.'}
            </span>
          )}
        </div>
      ) : null}

      {needsHomeOfficeRef(branch) ? (
        <Input
          label={
            <>
              Home Office reference <span className="coral">*</span>
            </>
          }
          mono
          autoCapitalize="characters"
          autoComplete="off"
          placeholder="e.g. ABC123456"
          value={form.homeOfficeRef}
          onChange={(e) => set('homeOfficeRef', e.target.value)}
          onBlur={() => setRefTouched(true)}
          error={refTouched && form.homeOfficeRef.trim() !== '' ? errors.homeOfficeRef : undefined}
          hint="The number on your Application Registration Card (ARC), or the reference on your latest letter from the Home Office. The office uses it to check your right to work."
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

      {docs.length > 0 ? (
        <div className="label">Required documents · uploaded at step 4</div>
      ) : null}
      {branch === 'home_office_check' ? (
        <div className="wiz-list">
          <div className="docrow">
            <span className="ico">HO</span>
            <div>
              <div className="t">Home Office check</div>
              <div className="m">
                Nothing to upload. After you submit step 4, the office checks your right to work
                with the Home Office and adds the result to your profile.
              </div>
            </div>
            <span className="pill right">Office</span>
          </div>
        </div>
      ) : null}
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
                Only if you don’t have a passport. NI evidence: {NI_EVIDENCE_ACCEPTED.join(', ')}.
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {branch === 'home_office_check' ? (
        <Alert tone="cyan">
          You can start shifts once the office has your result from the Home Office. It usually
          lasts about six months — the office renews it, so you don’t need to upload anything.
        </Alert>
      ) : null}

      {branch === 'international_student' ? (
        <Alert tone="cyan">
          In term time you can work up to <b>20 h/week</b> — a visa condition. Outside term: 48 h
          (or more with the opt-out below). Nobody sets this — it follows your verified term dates.
        </Alert>
      ) : null}

      <Checkbox checked={form.wtrOptOut} onChange={(v) => set('wtrOptOut', v)}>
        I opt out of the 48-hour weekly working limit (Working Time Regulations). I can withdraw
        this on notice. <span className="xs muted">{OPT_OUT_NOTE[branch]}</span>
      </Checkbox>

      {branch === 'eu_settled' ? (
        <div className="note xs">
          Pre-settled status: your “right to work until” date comes back from the gov.uk check and
          becomes the expiry we remind you about.
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
