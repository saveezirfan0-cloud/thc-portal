'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Input } from '@thc/ui';
import { parseShareCode } from '@thc/domain';
import type { DocType } from '@thc/domain';
import { finishDocumentUpload } from '../actions';
import { EVIDENCE_ACCEPT, uploadEvidence } from './upload';

/**
 * Upload / Re-upload for one document (§10.4, §4.1).
 *
 * A share code is TYPED (§2.5) and checked against gov.uk with the date of
 * birth on the profile — automatically when the check is on (ADR-0025), by
 * the office otherwise — so that row asks for the code and makes the file
 * optional. Every other document is a file: PDF, JPG or PNG, up to 10 MB.
 *
 * The copy says what happens next and nothing more.
 */
export function UploadForm({
  docType,
  label,
  automaticCheck = false,
}: {
  docType: DocType;
  label: string;
  /** settings.rtw_check.enabled: a share code is checked with gov.uk at once. */
  automaticCheck?: boolean;
}) {
  const router = useRouter();
  const share = docType === 'share_code_report';
  const [file, setFile] = useState<File | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const codeOk = !share || parseShareCode(code) !== null;
  const ready = share ? codeOk : file !== null;

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
      const result = await finishDocumentUpload(docType, path, share ? code : null);
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
            We check it with gov.uk straight away, with the date of birth on your profile. If gov.uk
            confirms your right to work, it is verified — your current one keeps counting until
            then.
          </div>
          <div className="xs muted">
            If gov.uk doesn’t recognise it, you’ll get a notification saying why and can enter it
            again. If your date of birth on file is wrong, tell the office.
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
