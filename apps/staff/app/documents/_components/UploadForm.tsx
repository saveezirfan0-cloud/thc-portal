'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Input } from '@thc/ui';
import { DOCUMENT_UPLOAD_REASONS, dobProblem, parseShareCode, ukToday } from '@thc/domain';
import type { DocType } from '@thc/domain';
import { DobInput } from '../../apply/DobInput';
import { finishDocumentUpload, finishShareCode } from '../actions';
import { EVIDENCE_ACCEPT, uploadEvidence } from './upload';

/**
 * Upload / Re-upload for one document (§10.4, §4.1).
 *
 * A share code is TYPED (§2.5) and checked against gov.uk with a date of
 * birth — automatically when the check is on (ADR-0025), by the office
 * otherwise — so that row asks for the code AND the date of birth, the
 * date pre-filled from the profile the way the onboarding re-entry sheet
 * pre-fills it (ADR-0070): gov.uk matches the pair, so a wrong date on
 * file is corrected here, with the code, rather than being a dead end.
 * `submit_share_code_with_dob()` files the code and keeps a changed date
 * WITH it: gov.uk is asked with that date, and the profile takes it only
 * when the office verifies the code — a code that is not found or is
 * rejected changes nothing. The file is optional. Every other document is
 * a file: PDF, JPG or PNG, up to 10 MB.
 *
 * The copy says what happens next and nothing more. Since ADR-0041 the
 * office confirms every gov.uk result, so it says that.
 */
export function UploadForm({
  docType,
  label,
  automaticCheck = false,
  dob = null,
}: {
  docType: DocType;
  label: string;
  /** settings.rtw_check.enabled: a share code is checked with gov.uk at once. */
  automaticCheck?: boolean;
  /** `yyyy-mm-dd` on file — the share code form's date of birth starts here. */
  dob?: string | null;
}) {
  const router = useRouter();
  const share = docType === 'share_code_report';
  const [file, setFile] = useState<File | null>(null);
  const [code, setCode] = useState('');
  const [birth, setBirth] = useState(dob?.slice(0, 10) ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const codeOk = !share || parseShareCode(code) !== null;
  // Only a complete, real date is judged; half-typed is simply not ready.
  const birthProblem = share ? dobProblem(birth, ukToday()) : null;
  const birthComplete = /^\d{4}-\d{2}-\d{2}$/.test(birth);
  const ready = share ? codeOk && birthProblem === null : file !== null;

  function submit() {
    setError(null);
    start(async () => {
      let path: string | null = null;
      if (file) {
        const up = await uploadEvidence({ kind: 'document', docType }, file);
        if (!up.ok) {
          setError(up.message);
          return;
        }
        path = up.path;
      }
      const result = share
        ? await finishShareCode(path, code, birth)
        : await finishDocumentUpload(docType, path, null);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.replace(share && automaticCheck ? '/documents?sent=share' : '/documents?sent=1');
      router.refresh();
    });
  }

  return (
    <div className="docs-form">
      {share ? (
        <Input
          label="New share code"
          mono
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="W98 7ZY 6XK"
          hint="From gov.uk/prove-right-to-work. 9 letters and numbers."
          {...(code && !codeOk ? { error: 'That doesn’t look like a share code.' } : {})}
        />
      ) : null}

      {share ? (
        <DobInput
          label="Date of birth"
          value={birth}
          onChange={setBirth}
          hint="Must match the date of birth gov.uk holds for you."
          {...(birthComplete && birthProblem
            ? { error: DOCUMENT_UPLOAD_REASONS[birthProblem] ?? 'Check your date of birth.' }
            : {})}
        />
      ) : null}

      <label className="file-pick field">
        <span className="label">
          {share ? 'The gov.uk report · optional' : `${label} · PDF, JPG or PNG, up to 10 MB`}
        </span>
        <input
          type="file"
          accept={EVIDENCE_ACCEPT}
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
      </label>

      {share && automaticCheck ? (
        <div className="notice">
          <div className="strong">What happens next</div>
          <div>
            We check it with gov.uk straight away, with the date of birth above, and the office
            confirms the result. Nothing changes on your account until they do — your current right
            to work keeps counting until then.
          </div>
          <div className="xs muted">
            If gov.uk doesn’t recognise the code with that date, the office will tell you why and
            you can enter them again. The date above is used for this check, and saved to your
            profile once the office verifies it.
          </div>
        </div>
      ) : share ? (
        <div className="notice">
          <div className="strong">What happens next</div>
          <div>
            The office checks it with gov.uk, with the date of birth above. Nothing changes on your
            account until they verify it — your current right to work keeps counting until then.
          </div>
          <div className="xs muted">
            If it can’t be accepted, you’ll get a notification with the reason and can enter it
            again. The date above is used for this check, and saved to your profile once the office
            verifies it.
          </div>
        </div>
      ) : (
        <div className="notice">
          <div className="strong">What happens next</div>
          <div>
            It goes to the office for review. Nothing changes on your account until they verify it —
            if your current one is still in date, it keeps counting until then.
          </div>
          <div className="xs muted">
            If it can’t be accepted, you’ll get a notification with the reason and can upload again.
          </div>
        </div>
      )}

      {error ? <Alert tone="coral">{error}</Alert> : null}

      <Button tone="primary" size="lg" block disabled={!ready || pending} onClick={submit}>
        {pending ? 'Uploading…' : share ? 'Send new share code' : 'Upload'}
      </Button>
    </div>
  );
}
