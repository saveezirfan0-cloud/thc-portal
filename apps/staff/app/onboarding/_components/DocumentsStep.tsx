'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Input, Pill, Radio, RadioGroup, Textarea } from '@thc/ui';
import { formatFileSize, formatShareCode } from '@thc/domain';
import type { DocRequirement } from '@thc/domain';
import { submitDocuments } from '../actions';
import { allUploaded, docIcon } from '../state';
import type { RequirementRow } from '../state';
import { UploadSheet } from './UploadSheet';
import { WizardFoot, WizardTop } from './Wizard';

/**
 * 4/11 Documents — §2.5, §2.10, §10.3; wireframes/staff/onboarding-1.html
 * (term letter missing · upload sheet · all uploaded with declaration Yes).
 *
 * The set is exactly the branch's (§2.5 pt 8). The share code is shown as
 * entered, never uploaded. The criminal-conviction declaration sits here so
 * the office has one combined blocker: No is verified on submission, Yes
 * needs details and is reviewed like a document (§2.10).
 */
export function DocumentsStep({
  branchTitle,
  rows,
  shareCode,
  today,
}: {
  branchTitle: string;
  rows: RequirementRow[];
  shareCode: string | null;
  today: string;
}) {
  const router = useRouter();
  const [sheet, setSheet] = useState<DocRequirement | null>(null);
  const [answer, setAnswer] = useState<boolean | null>(null);
  const [details, setDetails] = useState('');
  const [date, setDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const missing = rows.find((r) => !r.doc || r.doc.status === 'rejected');
  const hint = missing
    ? `Upload your ${missing.requirement.label} to continue`
    : answer === null
      ? 'Answer the criminal conviction question to continue'
      : answer && details.trim() === ''
        ? 'Add the details of the conviction to continue'
        : null;

  function submit() {
    setError(null);
    start(async () => {
      const result = await submitDocuments({
        hasConviction: answer,
        details,
        convictionDate: date,
      });
      if (!result.ok) setError(result.message);
      else router.push('/onboarding');
    });
  }

  return (
    <>
      <WizardTop
        step={4}
        heading="Your documents"
        sub={`For your branch: ${branchTitle}. PDF, JPG, PNG or HEIC, up to 10 MB per file.`}
      />

      <div className="mlist wiz-list">
        {rows.map(({ requirement, doc }) => (
          <div className={`docrow ${doc ? 'pending' : ''}`} key={requirement.key}>
            <span className="ico">{docIcon(doc)}</span>
            <div>
              <div className="t">{requirement.label}</div>
              <div className="m">
                {doc
                  ? [doc.fileName, doc.fileSize ? formatFileSize(doc.fileSize) : null]
                      .filter(Boolean)
                      .join(' · ')
                  : `Missing · ${requirement.hint ?? ''}`}
              </div>
            </div>
            <div className="right">
              {doc ? (
                <>
                  <Pill tone="amber">Uploaded</Pill>
                  <button
                    type="button"
                    className="linkbtn xs"
                    onClick={() => setSheet(requirement)}
                  >
                    Replace
                  </button>
                </>
              ) : (
                <Button tone="primary" size="sm" onClick={() => setSheet(requirement)}>
                  Upload
                </Button>
              )}
            </div>
          </div>
        ))}
        {shareCode ? (
          <div className="docrow verified">
            <span className="ico">✓</span>
            <div>
              <div className="t">Share code · {formatShareCode(shareCode)}</div>
              <div className="m">Checked with gov.uk after you submit</div>
            </div>
            <div className="right">
              <Pill>Entered</Pill>
            </div>
          </div>
        ) : null}
      </div>

      <div className="mcard">
        <div className="t">Criminal conviction declaration</div>
        <div className="m">
          Do you have any <b>unspent</b> criminal convictions? This is a legal declaration. Spent
          convictions don’t need to be declared. You must also tell us about any conviction that
          happens while you work for us (§10.7).
        </div>
        <RadioGroup
          className="wiz-choices"
          aria-label="Unspent criminal convictions"
          name="unspent-convictions"
        >
          <Radio checked={answer === true} onChange={() => setAnswer(true)}>
            Yes
          </Radio>
          <Radio checked={answer === false} onChange={() => setAnswer(false)}>
            No
          </Radio>
        </RadioGroup>
        {answer === false ? (
          <div className="xs muted">
            “No” is recorded as verified straight away — nothing for the office to review.
          </div>
        ) : null}
        {answer === true ? (
          <>
            <Textarea
              label={
                <>
                  Details <span className="coral">*</span>
                </>
              }
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              hint="Offence, date and outcome. Reviewed by the office together with your documents — it is not shown anywhere else."
            />
            <Input
              label="Date of conviction · optional"
              type="date"
              mono
              max={today}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </>
        ) : null}
      </div>

      {allUploaded(rows) ? (
        <div className="xs muted">
          Everything here goes to the office for review as one set (§2.10). You’ll see each item’s
          status once you submit.
        </div>
      ) : null}

      {error ? <Alert tone="coral">{error}</Alert> : null}

      <UploadSheet
        key={sheet?.key ?? 'closed'}
        requirement={sheet}
        onClose={() => setSheet(null)}
      />

      <WizardFoot hint={hint ?? undefined}>
        <Button tone="primary" size="lg" block disabled={Boolean(hint) || pending} onClick={submit}>
          {pending ? 'Submitting…' : 'Submit documents'}
        </Button>
      </WizardFoot>
    </>
  );
}
