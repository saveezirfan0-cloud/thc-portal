'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Input, Pill, Radio, RadioGroup, SegToggle, Textarea } from '@thc/ui';
import { formatFileSize, formatShareCode } from '@thc/domain';
import type { DocRequirement } from '@thc/domain';
import { submitDocuments } from '../actions';
import { allUploaded, docIcon } from '../state';
import type { RequirementRow, UploadedDoc } from '../state';
import { CompletionLetterOption } from './CompletionLetterOption';
import { UploadSheet } from './UploadSheet';
import { WizardFoot, WizardTop } from './Wizard';

const TERM_LETTER = 'university_term_dates_letter';

/** A Student-visa candidate's answer to "have you finished your course?" (ADR-0187). */
type Course = 'studying' | 'finished';

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
  homeOfficeRef = null,
  today,
  completionLetter,
}: {
  branchTitle: string;
  rows: RequirementRow[];
  shareCode: string | null;
  /** ADR-0182: the Home Office check branch's reference; null on every other branch. */
  homeOfficeRef?: string | null;
  today: string;
  /** `completionLetterDoc()`: undefined hides the optional row (not a Student visa). */
  completionLetter?: UploadedDoc | null;
}) {
  const router = useRouter();
  const [sheet, setSheet] = useState<DocRequirement | null>(null);
  const [answer, setAnswer] = useState<boolean | null>(null);
  const [details, setDetails] = useState('');
  const [date, setDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // A Student-visa candidate says whether the course is finished, and is then
  // asked for ONE letter: the Term Dates Letter while studying, the Completion
  // Letter once finished — never both (ADR-0187). The database already takes
  // either for the term-letter requirement (ADR-0112), so this is a choice of
  // what to show and ask for. Opened where an upload already answers it.
  const isStudent = completionLetter !== undefined;
  const [course, setCourse] = useState<Course | null>(() => {
    if (!isStudent) return null;
    const term = rows.find((r) => r.requirement.key === TERM_LETTER);
    if (term?.viaCompletionLetter) return 'finished';
    if (term?.doc && term.doc.status !== 'rejected') return 'studying';
    if (completionLetter && completionLetter.status !== 'superseded') return 'finished';
    return term?.doc ? 'studying' : null;
  });
  const shown = isStudent
    ? rows.filter((r) => r.requirement.key !== TERM_LETTER || course === 'studying')
    : rows;
  const completionAnswered =
    completionLetter?.status === 'pending' || completionLetter?.status === 'verified';

  const missing = shown.find((r) => !r.doc || r.doc.status === 'rejected');
  const hint = missing
    ? `Upload your ${missing.requirement.label} to continue`
    : isStudent && course === null
      ? 'Tell us whether you’ve finished your course to continue'
      : isStudent && course === 'finished' && !completionAnswered
        ? 'Upload your University Completion Letter to continue'
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

      {isStudent ? (
        <div className="field">
          <span className="label">Have you finished your course?</span>
          <SegToggle<Course>
            block
            aria-label="Have you finished your course?"
            options={[
              { value: 'studying', label: 'Still studying' },
              { value: 'finished', label: 'Finished my course' },
            ]}
            // Neither is pressed until they answer: an unanswered question
            // shows no letter at all.
            value={course as Course}
            onChange={setCourse}
          />
          <div className="xs muted">
            {course === 'finished'
              ? 'You only need your Official University Completion Letter — not a Term Dates Letter.'
              : course === 'studying'
                ? 'You need this year’s University Term Dates Letter — not a Completion Letter.'
                : 'Still studying: your Term Dates Letter. Finished: your Completion Letter. You only upload one.'}
          </div>
        </div>
      ) : null}

      <div className="mlist wiz-list">
        {shown.map(({ requirement, doc, viaCompletionLetter }) => (
          <div className={`docrow ${doc ? 'pending' : ''}`} key={requirement.key}>
            <span className="ico">{viaCompletionLetter ? '—' : docIcon(doc)}</span>
            <div>
              <div className="t">{requirement.label}</div>
              <div className="m">
                {viaCompletionLetter
                  ? doc?.status === 'verified'
                    ? 'Not needed — your Completion Letter below covers it'
                    : 'Covered by your Completion Letter below once the office approves it'
                  : doc
                    ? [doc.fileName, doc.fileSize ? formatFileSize(doc.fileSize) : null]
                        .filter(Boolean)
                        .join(' · ')
                    : `Missing · ${requirement.hint ?? ''}`}
              </div>
            </div>
            <div className="right">
              {viaCompletionLetter ? (
                <Pill>{doc?.status === 'verified' ? 'Not needed' : 'Once approved'}</Pill>
              ) : doc ? (
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
              <div className="m">Checked with gov.uk automatically after you submit</div>
            </div>
            <div className="right">
              <Pill>Entered</Pill>
            </div>
          </div>
        ) : null}
        {homeOfficeRef !== null ? (
          <div className="docrow verified">
            <span className="ico">HO</span>
            <div>
              <div className="t">
                Home Office check{homeOfficeRef ? ` · reference ${homeOfficeRef}` : ''}
              </div>
              <div className="m">
                Nothing to upload. After you submit, the office checks your right to work with the
                Home Office and adds the result.
              </div>
            </div>
            <div className="right">
              <Pill>Office</Pill>
            </div>
          </div>
        ) : null}
        {isStudent && course === 'finished' ? (
          <CompletionLetterOption doc={completionLetter} required />
        ) : null}
      </div>

      <div className="mcard">
        <div className="t">Criminal conviction declaration</div>
        <div className="m">
          Do you have any <b>unspent</b> criminal convictions? This is a legal declaration. Spent
          convictions don’t need to be declared. You must also tell us about any conviction that
          happens while you work for us.
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
        {/* Always shown, as the wireframe draws it: it explains the choice
            before it is made, not only once "No" is picked. */}
        <div className="xs muted">
          “No” is recorded as verified straight away — nothing for the office to review.
        </div>
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

      {allUploaded(shown) && (!isStudent || course === 'studying' || completionAnswered) ? (
        <div className="xs muted">
          Everything here goes to the office for review as one set. You’ll see each item’s status
          once you submit.
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
