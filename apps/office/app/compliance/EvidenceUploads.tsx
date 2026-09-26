'use client';

import { useId, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@thc/db/browser';
import { COMPLETION_EVIDENCE_FORM_LABELS, evidenceFileProblem } from '@thc/domain';
import type { CompletionEvidenceForm } from '@thc/domain';
import { Alert, Button, Input, Select } from '@thc/ui';
import {
  attachRtwReport,
  setBelowDegreeLevel,
  setVisaHourLimit,
  startOfficeUpload,
  submitOfficeCompletionLetter,
} from './actions';
import type { OfficeUploadFolder } from './actions';
import { VISA_LIMIT_HINT, belowDegreeHint, visaLimitProblem } from './conditions';
import { uploadRefusal } from './messages';
import type { ActionResult } from './types';

/**
 * What the office adds to a profile itself:
 *
 *   · the Official University Completion Letter (audit D47) — the requirement
 *     lets "the reviewer capture" the completion date, and a letter emailed to
 *     the office has to reach the profile somehow. It lands in Needs review
 *     like the worker's own upload; Approve confirms the dates.
 *   · the gov.uk right-to-work report (D31), when the share code was verified
 *     by hand (the automated check stores its own).
 *   · the course level / visa hours limit (D32, D36), outside a Verify.
 *
 * Files go browser → Storage on a one-object signed upload issued for the
 * office only (actions.ts), then the RPC judges what Storage recorded.
 */

/** PDF, JPG or PNG — as the worker's upload. */
export const EVIDENCE_ACCEPT = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png';

export async function uploadOfficeEvidence(
  staffId: string,
  folder: OfficeUploadFolder,
  file: File,
): Promise<{ ok: true; path: string } | { ok: false; message: string }> {
  const meta = { name: file.name, type: file.type, size: file.size };
  const problem = evidenceFileProblem(meta);
  if (problem) return { ok: false, message: uploadRefusal(problem) };
  const slot = await startOfficeUpload(staffId, folder, meta);
  if (!slot.ok) return slot;
  const { error } = await createClient()
    .storage.from('documents')
    .uploadToSignedUrl(slot.path, slot.token, file, { contentType: file.type, upsert: false });
  if (error) return { ok: false, message: uploadRefusal('file_not_found') };
  return { ok: true, path: slot.path };
}

function useRun() {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const run = (work: () => Promise<ActionResult>, after?: () => void) => {
    setResult(null);
    start(async () => {
      const outcome = await work();
      setResult(outcome);
      if (outcome.ok) {
        after?.();
        router.refresh();
      }
    });
  };
  return { busy, result, run };
}

function Result({ result }: { result: ActionResult | null }) {
  if (!result || (result.ok && !result.message)) return null;
  return <Alert tone={result.ok ? 'green' : 'coral'}>{result.message}</Alert>;
}

/** D47 · The office's completion-letter upload. */
export function CompletionLetterUpload({ staffId }: { staffId: string }) {
  const { busy, result, run } = useRun();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [form, setForm] = useState<CompletionEvidenceForm>('letter');
  const [date, setDate] = useState('');
  const [institution, setInstitution] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const fileId = useId();

  if (!open) {
    return (
      <div className="stack">
        <Result result={result} />
        <div>
          <Button size="sm" tone="ghost" onClick={() => setOpen(true)}>
            Upload completion letter
          </Button>
        </div>
      </div>
    );
  }

  const submit = () =>
    run(
      async () => {
        if (!file) return { ok: false, message: 'Choose the file to upload.' };
        const uploaded = await uploadOfficeEvidence(staffId, 'completion-letter', file);
        if (!uploaded.ok) return uploaded;
        return submitOfficeCompletionLetter({
          staffId,
          path: uploaded.path,
          completionDate: date,
          form,
          institution,
        });
      },
      () => {
        setOpen(false);
        setFile(null);
        setDate('');
        setInstitution('');
        if (input.current) input.current.value = '';
      },
    );

  return (
    <div className="stack" aria-label="Upload completion letter">
      <div className="label">Official University Completion Letter</div>
      <div className="field">
        <label className="label" htmlFor={fileId}>
          File (PDF, JPG or PNG, up to 10 MB)
        </label>
        <input
          id={fileId}
          ref={input}
          className="input"
          type="file"
          accept={EVIDENCE_ACCEPT}
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
      </div>
      <Select
        label="What it is"
        value={form}
        onChange={(event) => setForm(event.target.value as CompletionEvidenceForm)}
      >
        {Object.entries(COMPLETION_EVIDENCE_FORM_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </Select>
      <Input
        type="date"
        label="Course completion date on the document"
        value={date}
        onChange={(event) => setDate(event.target.value)}
        hint="As the document states it. It is confirmed again on Approve."
      />
      <Input
        label="University (optional)"
        value={institution}
        onChange={(event) => setInstitution(event.target.value)}
      />
      <div className="row">
        <Button tone="green" solid size="sm" disabled={busy || !file || !date} onClick={submit}>
          Upload for review
        </Button>
        <Button tone="ghost" size="sm" disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      <Result result={result} />
    </div>
  );
}

/** D31 · Attach the gov.uk report to a share code verified by hand. */
export function RtwReportUpload({ docId, staffId }: { docId: string; staffId: string }) {
  const { busy, result, run } = useRun();
  const input = useRef<HTMLInputElement>(null);
  const pick = (file: File | undefined) => {
    if (!file) return;
    run(async () => {
      const uploaded = await uploadOfficeEvidence(staffId, 'share-code-report', file);
      if (!uploaded.ok) return uploaded;
      return attachRtwReport(docId, staffId, uploaded.path);
    });
  };
  return (
    <span className="stack">
      <span className="row">
        <input
          ref={input}
          type="file"
          accept={EVIDENCE_ACCEPT}
          hidden
          aria-label="gov.uk report file"
          onChange={(event) => pick(event.target.files?.[0])}
        />
        <Button size="sm" tone="ghost" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? 'Attaching…' : 'Attach gov.uk report'}
        </Button>
      </span>
      <Result result={result} />
    </span>
  );
}

/**
 * The course level (student) or the visa's weekly hours limit (work or
 * dependant visa), set outside a Verify — e.g. on the candidate profile.
 * Renders nothing for any other route.
 */
export function RtwConditionsEditor({
  staffId,
  branch,
  belowDegreeLevel,
  visaHourLimit,
  checkTermLimit,
  readOnly = false,
}: {
  staffId: string;
  branch: string | null;
  belowDegreeLevel: boolean;
  visaHourLimit: number | null;
  checkTermLimit?: number | null;
  readOnly?: boolean;
}) {
  const { busy, result, run } = useRun();
  const [limit, setLimit] = useState(visaHourLimit === null ? '' : String(visaHourLimit));
  if (branch === 'international_student') {
    return (
      <div className="stack">
        <label className="row sm">
          <input
            type="checkbox"
            checked={belowDegreeLevel}
            disabled={busy || readOnly}
            onChange={(event) => {
              const next = event.target.checked;
              run(() => setBelowDegreeLevel(staffId, next));
            }}
          />
          <span>
            <b>Course is below degree level</b> — 10 hours a week in term time instead of 20.{' '}
            <span className="muted">{belowDegreeHint(checkTermLimit)}</span>
          </span>
        </label>
        <Result result={result} />
      </div>
    );
  }
  if (branch === 'work_visa' || branch === 'dependant_other') {
    const problem = visaLimitProblem(limit);
    const unchanged = limit.trim() === (visaHourLimit === null ? '' : String(visaHourLimit));
    return (
      <div className="stack">
        <div className="row wrap">
          <Input
            type="text"
            inputMode="numeric"
            label="Weekly hours limit on the visa (if any)"
            value={limit}
            disabled={busy || readOnly}
            onChange={(event) => setLimit(event.target.value)}
            hint={VISA_LIMIT_HINT}
            error={problem ?? undefined}
          />
          {readOnly ? null : (
            <Button
              size="sm"
              disabled={busy || problem !== null || unchanged}
              onClick={() => run(() => setVisaHourLimit(staffId, limit))}
            >
              Save
            </Button>
          )}
        </div>
        <Result result={result} />
      </div>
    );
  }
  return null;
}
