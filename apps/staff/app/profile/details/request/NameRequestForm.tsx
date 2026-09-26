'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Input, Textarea } from '@thc/ui';
import { createClient } from '@thc/db/browser';
import {
  CHANGE_NOTE_MAX,
  DOCUMENT_UPLOAD_REASONS,
  evidenceFileProblem,
  validateNameChange,
} from '@thc/domain';
import { CHANGE_REASONS } from '../../change-requests';
import { requestNameChange, startEvidenceUpload } from './actions';

/** What the evidence input accepts — §2.1's "PDF, JPG, PNG", as the documents bucket. */
const EVIDENCE_ACCEPT = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png';

/**
 * `?kind=name` — a new first and last name, the evidence, a note (ADR-0044).
 *
 * The name is tied to the right-to-work check and payroll, so the office
 * checks the evidence before anything changes (Q13). The file is uploaded
 * only when the worker presses Send — through a one-object signed upload
 * the server issues for a name it chose — so an abandoned form leaves
 * nothing behind. `validateNameChange()` is the RPC's own check, run first.
 */
export function NameRequestForm({ firstName, lastName }: { firstName: string; lastName: string }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [first, setFirst] = useState(firstName);
  const [last, setLast] = useState(lastName);
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function send() {
    setError(null);
    const check = validateNameChange({ first, last }, { first: firstName, last: lastName });
    if (!check.ok) {
      setError(CHANGE_REASONS[check.reason] ?? 'Check the name and try again.');
      return;
    }
    if (!file) {
      setError(CHANGE_REASONS['evidence_required'] ?? 'Add your evidence.');
      return;
    }
    start(async () => {
      const slot = await startEvidenceUpload({ name: file.name, type: file.type, size: file.size });
      if (!slot.ok) {
        setError(slot.message);
        return;
      }
      const { error: uploadError } = await createClient()
        .storage.from('documents')
        .uploadToSignedUrl(slot.path, slot.token, file, { contentType: file.type, upsert: false });
      if (uploadError) {
        setError('The upload did not complete. Please try again.');
        return;
      }
      const result = await requestNameChange(check.first, check.last, slot.path, note);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.push('/profile/details');
      router.refresh();
    });
  }

  return (
    <div className="req-form">
      <p className="sm muted">
        Your name is tied to your right-to-work check and payroll, so the office checks the change
        before it’s made.
      </p>
      <div className="field lockf">
        <span className="label">Now</span>
        <input className="input" value={`${firstName} ${lastName}`.trim()} readOnly />
      </div>
      <div className="row avail-pair">
        <Input
          label="First name"
          autoComplete="given-name"
          value={first}
          onChange={(event) => setFirst(event.target.value)}
        />
        <Input
          label="Last name"
          autoComplete="family-name"
          value={last}
          onChange={(event) => setLast(event.target.value)}
        />
      </div>

      <div className="field">
        <span className="label">Evidence</span>
        <input
          ref={fileRef}
          className="photo-file"
          type="file"
          accept={EVIDENCE_ACCEPT}
          aria-label="Evidence file"
          onChange={(event) => {
            const chosen = event.target.files?.[0] ?? null;
            event.target.value = '';
            if (!chosen) return;
            const problem = evidenceFileProblem({
              name: chosen.name,
              type: chosen.type,
              size: chosen.size,
            });
            if (problem) {
              setError(DOCUMENT_UPLOAD_REASONS[problem] ?? 'Upload a PDF, JPG or PNG.');
              return;
            }
            setError(null);
            setFile(chosen);
          }}
        />
        <button type="button" className="req-upload" onClick={() => fileRef.current?.click()}>
          {file ? (
            <span className="strong">
              {file.name} · {formatSize(file.size)}
            </span>
          ) : (
            <span className="strong">Choose a file</span>
          )}
          <span className="xs">
            e.g. marriage certificate, deed poll, or a passport in the new name
          </span>
        </button>
      </div>

      <Textarea
        label="Note to the office · optional"
        value={note}
        maxLength={CHANGE_NOTE_MAX}
        onChange={(event) => setNote(event.target.value)}
      />

      {error ? <Alert tone="coral">{error}</Alert> : null}
      <Button tone="primary" size="lg" block disabled={pending} onClick={send}>
        {pending ? 'Sending…' : 'Send to the office'}
      </Button>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
