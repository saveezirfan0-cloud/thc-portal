'use client';

import { useRef, useState, useTransition } from 'react';
import type { RefObject } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, SegToggle, Sheet } from '@thc/ui';
import { UPLOAD_ACCEPT_ATTR, uploadError } from '@thc/domain';
import { putSignedUpload } from '../../_lib/signed-upload';
import type { DocRequirement, DocType } from '@thc/domain';
import { finishDocumentUpload, startDocumentUpload } from '../actions';
import { docLabel } from '../state';

/**
 * The upload sheet — wireframes/staff/onboarding-1.html "Upload sheet":
 * Take a photo · Choose from photos · Browse files, and the limits line.
 *
 * Three steps, each the right side's: the server mints a signed upload URL
 * for a path it builds from the session; the browser sends the file
 * straight to the private `documents` bucket with it, in one PUT and with
 * no Supabase client (app/_lib/signed-upload.ts); the server then
 * records the upload as the worker (`onboarding_attach_document()`), with
 * the size and type Storage measured. See actions.ts.
 */
export function UploadSheet({
  requirement,
  onClose,
}: {
  requirement: DocRequirement | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const camera = useRef<HTMLInputElement>(null);
  const photos = useRef<HTMLInputElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const [choice, setChoice] = useState<DocType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!requirement) return null;
  const docType: DocType = choice ?? requirement.accepts[0]!;

  function upload(file: File) {
    setError(null);
    const invalid = uploadError(file);
    if (invalid) {
      setError(invalid);
      return;
    }
    start(async () => {
      const slot = await startDocumentUpload({
        docType,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
      });
      if (!slot.ok) return setError(slot.message);
      const sent = await putSignedUpload(slot.url, file, slot.contentType);
      if (!sent) return setError('That upload didn’t finish. Check your connection and try again.');
      const done = await finishDocumentUpload({ docType, path: slot.path, fileName: file.name });
      if (!done.ok) return setError(done.message);
      onClose();
      router.refresh();
    });
  }

  const input = (
    ref: RefObject<HTMLInputElement | null>,
    accept: string,
    capture?: 'environment',
  ) => (
    <input
      ref={ref}
      className="file-hidden"
      type="file"
      accept={accept}
      {...(capture ? { capture } : {})}
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) upload(f);
        e.target.value = '';
      }}
    />
  );

  return (
    <Sheet open onClose={pending ? () => undefined : onClose} label={`Upload ${requirement.label}`}>
      <div className="strong">Upload {requirement.label}</div>
      {requirement.accepts.length > 1 ? (
        <SegToggle<DocType>
          block
          options={requirement.accepts.map((t) => ({ value: t, label: docLabel(t) }))}
          value={docType}
          onChange={setChoice}
        />
      ) : null}
      <div>
        <button
          type="button"
          className="src"
          disabled={pending}
          onClick={() => camera.current?.click()}
        >
          <span aria-hidden="true">📷</span> Take a photo
        </button>
        <button
          type="button"
          className="src"
          disabled={pending}
          onClick={() => photos.current?.click()}
        >
          <span aria-hidden="true">🖼</span> Choose from photos
        </button>
        <button
          type="button"
          className="src"
          disabled={pending}
          onClick={() => files.current?.click()}
        >
          <span aria-hidden="true">📁</span> Browse files
        </button>
      </div>
      {input(camera, 'image/*', 'environment')}
      {input(photos, 'image/*')}
      {input(files, UPLOAD_ACCEPT_ATTR)}
      <div className="xs muted">
        PDF, JPG, PNG or HEIC · up to 10 MB · all pages of a multi-page letter, please.
      </div>
      {/* TK-14 (THC, 24.10.2026): a photo with glare or a reflection on it is rejected. */}
      {docType === 'passport' || docType === 'national_id' ? (
        <Alert tone="cyan">
          <b>Turn the flash off.</b> Lay your {docType === 'passport' ? 'passport' : 'ID card'} flat
          in good light and make sure the whole photo page is sharp and readable. A photo with glare
          or a reflection on it can’t be accepted and will be rejected.
        </Alert>
      ) : null}
      {docType === 'university_term_dates_letter' ? (
        <Alert tone="cyan">
          <b>Your letter must be in date.</b> The term dates printed on it must not have already
          passed — an out-of-date letter can’t be accepted, so upload the one for the current
          academic year.
        </Alert>
      ) : null}
      {pending ? <Alert tone="cyan">Uploading…</Alert> : null}
      {error ? <Alert tone="coral">{error}</Alert> : null}
      <Button tone="ghost" block onClick={onClose} disabled={pending}>
        Cancel
      </Button>
    </Sheet>
  );
}
