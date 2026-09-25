'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Avatar, Button } from '@thc/ui';
import { createClient } from '@thc/db/browser';
import { confirmSelfie, saveSelfie, startSelfieUpload } from '../actions';
import { WizardFoot, WizardTop } from './Wizard';

/**
 * 3/11 Profile selfie — §10.3, §10.1, wireframes/staff/onboarding-1.html
 * (viewfinder, then review with Retake / Use this photo).
 *
 * "This photo becomes their avatar across the system and is printed on the
 * timesheet." It is set once and then locked (§10.1): `staff_set_photo()`
 * refuses a second one. A returning worker (§2.12) therefore sees the photo
 * already on file and confirms it rather than taking a new one.
 *
 * `capture="user"` opens the front camera on a phone. The image is cropped
 * square and downscaled on the device, as the profile screen does, and
 * uploaded by the worker's OWN session into `photos/<staff_id>/…`
 * (photos_worker_insert_own) — no service key.
 */
const MAX_EDGE = 512;

export function SelfieStep({
  name,
  existingUrl,
  locked,
}: {
  name: string;
  existingUrl: string | null;
  locked: boolean;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  async function take(file: File) {
    setError(null);
    try {
      const square = await squareJpeg(file);
      setBlob(square);
      setPreview(URL.createObjectURL(square));
    } catch {
      setError('We couldn’t read that image. Try again, or choose a photo from your camera roll.');
    }
  }

  function use() {
    if (!blob) return;
    setError(null);
    start(async () => {
      const slot = await startSelfieUpload();
      if (!slot.ok) return setError(slot.message);
      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from('photos')
        .upload(slot.path, blob, { contentType: 'image/jpeg', upsert: false });
      if (uploadError)
        return setError('That upload didn’t finish. Check your connection and try again.');
      const saved = await saveSelfie(slot.path);
      if (!saved.ok) return setError(saved.message);
      router.push('/onboarding/4');
    });
  }

  function keep() {
    setError(null);
    start(async () => {
      const result = await confirmSelfie();
      if (!result.ok) setError(result.message);
      else router.push('/onboarding/4');
    });
  }

  if (locked) {
    return (
      <>
        <WizardTop
          step={3}
          heading="Your profile photo"
          // Neutral on purpose: steps 1–4 stay open until Submit, so the
          // candidate who took this photo a minute ago lands here too, and
          // "from your previous time with us" would be false for them. The
          // one sentence the wireframe fixes is the lock (§10.1).
          sub="Your photo is already on file and locked — changing it goes through the office."
        />
        <div className="cam">
          {existingUrl ? <img src={existingUrl} alt={name} /> : <Avatar name={name} size="xl" />}
        </div>
        {error ? <Alert tone="coral">{error}</Alert> : null}
        <WizardFoot>
          <Button tone="primary" size="lg" block disabled={pending} onClick={keep}>
            Continue
          </Button>
        </WizardFoot>
      </>
    );
  }

  const file = (
    <input
      ref={input}
      className="file-hidden"
      type="file"
      accept="image/*"
      capture="user"
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) void take(f);
        e.target.value = '';
      }}
    />
  );

  if (!preview) {
    return (
      <>
        <WizardTop
          step={3}
          heading="Take your profile photo"
          sub={
            <>
              <b className="cyan">This becomes your photo across the system and on the timesheet</b>{' '}
              — the office and the client see it. Plain background, face the camera, no hat or
              sunglasses.
            </>
          }
        />
        <button
          type="button"
          className="cam"
          onClick={() => input.current?.click()}
          aria-label="Open the camera"
        >
          <span className="guide" />
          <span className="lbl">Front camera · square crop</span>
        </button>
        <button
          type="button"
          className="shutter"
          onClick={() => input.current?.click()}
          aria-label="Take photo"
        >
          <i />
        </button>
        {file}
        <div className="xs muted center-text">
          You’ll be able to check it before you continue. It’s set once — changing it later goes
          through the office.
        </div>
        {error ? <Alert tone="coral">{error}</Alert> : null}
        <WizardFoot hint="Take a photo to continue">
          <Button tone="primary" size="lg" block disabled>
            Continue
          </Button>
        </WizardFoot>
      </>
    );
  }

  return (
    <>
      <WizardTop step={3} heading="Happy with this one?" />
      <div className="cam">
        <img src={preview} alt="Your photo" />
      </div>
      <div className="row">
        <Button
          tone="outline"
          block
          className="grow"
          onClick={() => input.current?.click()}
          disabled={pending}
        >
          Retake
        </Button>
        <Button tone="primary" block className="grow" onClick={use} disabled={pending}>
          {pending ? 'Saving…' : 'Use this photo'}
        </Button>
      </div>
      {file}
      <div className="row">
        <Avatar name={name} src={preview} size="lg" />
        <Avatar name={name} src={preview} />
        <Avatar name={name} src={preview} size="sm" />
        <span className="xs muted">
          How it appears in the app, the Back Office and on the timesheet.
        </span>
      </div>
      {error ? <Alert tone="coral">{error}</Alert> : null}
      <WizardFoot hint="Choose “Use this photo” to continue">
        <Button tone="primary" size="lg" block disabled>
          Continue
        </Button>
      </WizardFoot>
    </>
  );
}

/** Centre-crop to a square and downscale, as JPEG (the profile screen's rule). */
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
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', 0.85);
  });
}
