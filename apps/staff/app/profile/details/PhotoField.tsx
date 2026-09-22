'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Avatar, Button } from '@thc/ui';
import { createClient } from '@thc/db/browser';
import { finishPhotoUpload, startPhotoUpload } from '../actions';

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

/** Long edge of the stored image. Generous for a 72 px avatar on a 3× screen. */
const MAX_EDGE = 512;
const MIME = 'image/jpeg';
const QUALITY = 0.85;

export function PhotoField({
  name,
  photoUrl,
  locked,
}: {
  name: string;
  photoUrl: string | null;
  locked: boolean;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (locked) {
    return (
      <div className="photo-row">
        <Avatar name={name} {...(photoUrl ? { src: photoUrl } : {})} size="xl" />
        <div className="photo-copy">
          <div className="sm strong">Profile photo · locked</div>
          <div className="xs muted">
            Set once at onboarding — it’s printed on timesheets. To change it, contact the office.
          </div>
        </div>
      </div>
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

/**
 * Centre-crop to a square and downscale to `MAX_EDGE`, as JPEG.
 *
 * Square because the avatar is square in the scope rendering and circular
 * in the warm one, and a circle is a square with a radius: cropping here
 * means neither ground has to guess which part of a portrait to show, and
 * the same file works on a timesheet.
 */
async function squareJpeg(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const edge = Math.min(bitmap.width, bitmap.height);
  const size = Math.min(edge, MAX_EDGE);

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('no 2d context');
  context.drawImage(
    bitmap,
    (bitmap.width - edge) / 2,
    (bitmap.height - edge) / 2,
    edge,
    edge,
    0,
    0,
    size,
    size,
  );
  bitmap.close();

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('encode failed'))),
      MIME,
      QUALITY,
    );
  });
}
