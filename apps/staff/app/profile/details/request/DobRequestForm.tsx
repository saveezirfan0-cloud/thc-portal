'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Textarea } from '@thc/ui';
import { createClient } from '@thc/db/browser';
import {
  CHANGE_NOTE_MAX,
  DOCUMENT_UPLOAD_REASONS,
  dobChangeProblem,
  evidenceFileProblem,
  ukToday,
} from '@thc/domain';
import { DobInput } from '../../../apply/DobInput';
import { CHANGE_REASONS, dobLine } from '../../change-requests';
import { requestDobChange, startEvidenceUpload } from './actions';

/** What the evidence input accepts — §2.1's "PDF, JPG, PNG", as the documents bucket. */
const EVIDENCE_ACCEPT = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png';

/**
 * `?kind=dob` — a corrected date of birth, the evidence, a note (ADR-0069).
 *
 * gov.uk matches the share code against the date of birth, so the office
 * checks the evidence (a passport or birth certificate) before anything
 * changes, as it does for a name. The date is typed the way /apply types it
 * (`DobInput`, ADR-0068). `dobChangeProblem()` is `request_dob_change()`'s
 * own rule, run first; the file is uploaded only when the worker presses
 * Send, through the same one-object signed upload a name's evidence uses.
 *
 * A worker renewing a share code does not need this: the Documents hub's
 * New share code form carries the date of birth itself.
 */
export function DobRequestForm({ dob }: { dob: string | null }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [birth, setBirth] = useState(dob?.slice(0, 10) ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function send() {
    setError(null);
    const problem = dobChangeProblem(birth, dob, ukToday());
    if (problem) {
      setError(CHANGE_REASONS[problem] ?? 'Check the date and try again.');
      return;
    }
    if (!file) {
      setError(
        'Add a photo or scan of your evidence — for example your passport or birth certificate.',
      );
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
      const result = await requestDobChange(birth, slot.path, note);
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
        Your date of birth is checked with gov.uk alongside your share code, so the office checks
        the change before it’s made.
      </p>
      <div className="field lockf">
        <span className="label">Now</span>
        <input className="input" value={dobLine(dob)} readOnly />
      </div>
      <DobInput
        label="Date of birth"
        value={birth}
        onChange={setBirth}
        hint="As on your passport or birth certificate."
      />

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
            e.g. the photo page of your passport, or your birth certificate
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
