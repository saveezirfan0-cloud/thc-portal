'use client';

import { useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Alert, Avatar, Button } from '@thc/ui';
import { createClient } from '@thc/db/browser';
import { finishPhotoUpload, startPhotoUpload } from '../actions';
import { SELFIE_MIME as MIME, squareJpeg } from './selfie';
import { requestHref } from '../change-requests';
import type { StatusLine } from '../change-requests';
import { ChangeStatus } from './ChangeStatus';

/**
 * The profile photo (§1.6, §10.1).
 *
 * §1.6 wants a real face — "the selfie avatar from onboarding becomes their
 * photo across the whole system (falling back to initials)" — and §10.1
 * locks it: "The avatar is set once during onboarding and then locked;
 * changing it afterwards also goes through the office."
 *
 * Both are true here. Where a photo already exists this is a locked,
 * read-only block with the wireframe's copy. Where one does not — a worker
 * who joined before the selfie step, or whose upload failed — this is where
 * they supply it, because the alternative is a monogram forever and a
 * client who cannot recognise them at the door (§11.1). The once-only rule
 * is enforced in `staff_set_photo()`, not here: this component only decides
 * what to draw.
 *
 * `capture="user"` opens the front camera on a phone and is ignored on a
 * desktop, which is the behaviour we want from both.
 *
 * The file is squared and downscaled on the device before it leaves. A
 * modern phone camera produces 4-12 MB and the avatar is rendered at 72 px;
 * uploading the original would cost a worker on 4G their data for nothing.
 */

export function PhotoField({
  name,
  photoUrl,
  locked,
  canRequestChange = true,
  status = null,
}: {
  name: string;
  photoUrl: string | null;
  locked: boolean;
  /** ADR-0045: false while a photo change request is pending. */
  canRequestChange?: boolean;
  /** The pending / rejected line for the newest photo request. */
  status?: StatusLine;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Locked (§10.1): the photo is not editable here, but it can be asked
  // for — "Request a change" opens the office's queue (ADR-0045), hidden
  // while a request is already with them.
  if (locked) {
    return (
      <>
        <div className="photo-row">
          <Avatar name={name} {...(photoUrl ? { src: photoUrl } : {})} size="xl" />
          <div className="photo-copy">
            <div className="sm strong">Profile photo · locked</div>
            <div className="xs muted">Set once at onboarding — it’s printed on timesheets.</div>
            {canRequestChange && status?.state !== 'rejected' ? (
              <Link className="btn ghost sm" href={requestHref('photo')}>
                Request a change
              </Link>
            ) : null}
          </div>
        </div>
        <ChangeStatus kind="photo" line={status} />
      </>
    );
  }

  function choose(file: File) {
    setError(null);
    start(async () => {
      let blob: Blob;
      try {
        blob = await squareJpeg(file);
      } catch {
        setError('We couldn’t read that image. Try a photo from your camera roll.');
        return;
      }

      const slot = await startPhotoUpload();
      if (!slot.ok) {
        setError(slot.message);
        return;
      }

      // Uploaded through the worker's OWN session, not a service key:
      // `photos_worker_insert_own` (20260922183015) allows exactly
      // `<staff_id>/…`, and the path came from the server, so Storage RLS
      // is what admits this rather than a check written in the app.
      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from('photos')
        .upload(slot.path, blob, { contentType: MIME, upsert: false });
      if (uploadError) {
        setError('That upload didn’t finish. Check your connection and try again.');
        return;
      }

      const saved = await finishPhotoUpload(slot.path);
      if (!saved.ok) {
        setError(saved.message);
        return;
      }
      setPreview(URL.createObjectURL(blob));
      router.refresh();
    });
  }

  return (
    <div className="photo-row">
      {preview ? (
        <img className="photo-preview" src={preview} alt={name} />
      ) : (
        <Avatar name={name} size="xl" />
      )}
      <div className="photo-copy">
        <div className="sm strong">Profile photo</div>
        <div className="xs muted">
          A clear photo of your face, taken like a passport photo. Clients use it to recognise you
          at the door, and it’s printed on timesheets. Once it’s saved it’s locked — changing it
          afterwards goes through the office.
        </div>
        {error ? <Alert tone="coral">{error}</Alert> : null}
        <input
          ref={fileRef}
          className="photo-file"
          type="file"
          accept="image/*"
          capture="user"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) choose(file);
            event.target.value = '';
          }}
        />
        <Button
          tone="outline"
          size="sm"
          disabled={pending}
          onClick={() => fileRef.current?.click()}
        >
          {pending ? 'Uploading…' : 'Take or choose a photo'}
        </Button>
      </div>
    </div>
  );
}
