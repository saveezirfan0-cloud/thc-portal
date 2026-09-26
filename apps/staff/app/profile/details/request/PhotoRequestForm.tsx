'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Avatar, Button, Input } from '@thc/ui';
import { createClient } from '@thc/db/browser';
import { CHANGE_NOTE_MAX } from '@thc/domain';
import { SELFIE_MIME, squareJpeg } from '../selfie';
import { requestPhotoChange, startChangePhotoUpload } from './actions';

/**
 * `?kind=photo` — a new profile photo for the office to approve (ADR-0045).
 *
 * The selfie capture again (`squareJpeg`, the front camera through
 * `capture="user"`), so the proposal is the same square JPEG the photos
 * bucket takes. It is uploaded under a FRESH name in the worker's own
 * folder with their own session (photos_worker_insert_own); the current
 * photo stays on timesheets and the line-up until the office approves.
 */
export function PhotoRequestForm({
  name,
  currentUrl,
}: {
  name: string;
  currentUrl: string | null;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function capture(file: File) {
    setError(null);
    start(async () => {
      try {
        const square = await squareJpeg(file);
        setBlob(square);
        setPreview(URL.createObjectURL(square));
      } catch {
        setError('We couldn’t read that image. Try a photo from your camera roll.');
      }
    });
  }

  function send() {
    if (!blob) return;
    setError(null);
    start(async () => {
      const slot = await startChangePhotoUpload();
      if (!slot.ok) {
        setError(slot.message);
        return;
      }
      const { error: uploadError } = await createClient()
        .storage.from('photos')
        .upload(slot.path, blob, { contentType: SELFIE_MIME, upsert: false });
      if (uploadError) {
        setError('That upload didn’t finish. Check your connection and try again.');
        return;
      }
      const result = await requestPhotoChange(slot.path, note);
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
        Face the camera in good light, no hat or sunglasses. The office approves it before it
        replaces your current photo.
      </p>
      <div className="req-cam">
        {preview ? (
          <img className="req-cam-shot" src={preview} alt="Your new photo" />
        ) : (
          <div className="req-cam-now">
            <Avatar name={name} {...(currentUrl ? { src: currentUrl } : {})} size="xl" />
            <span className="xs muted">Your current photo</span>
          </div>
        )}
      </div>
      <input
        ref={fileRef}
        className="photo-file"
        type="file"
        accept="image/*"
        capture="user"
        aria-label="Take a photo"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) capture(file);
          event.target.value = '';
        }}
      />
      <Button
        tone={blob ? 'outline' : 'primary'}
        size="lg"
        block
        disabled={pending}
        onClick={() => fileRef.current?.click()}
      >
        {blob ? 'Retake' : 'Take photo'}
      </Button>
      <Input
        label="Note to the office · optional"
        placeholder="e.g. new haircut"
        maxLength={CHANGE_NOTE_MAX}
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      {error ? <Alert tone="coral">{error}</Alert> : null}
      {blob ? (
        <Button tone="primary" size="lg" block disabled={pending} onClick={send}>
          {pending ? 'Sending…' : 'Send to the office'}
        </Button>
      ) : null}
    </div>
  );
}
