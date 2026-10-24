'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Modal, toast } from '@thc/ui';
import { documentLink } from '../onboarding/actions';
import { rotateDocument } from './rotateActions';

/**
 * "Rotate" (ADR-0212, ADR-0214, TK-30): opens the document in a window and
 * turns the picture there — ↺ and ↻ a quarter at a time — so the reviewer
 * sees it the right way up before anything is saved. Save writes the net
 * turn once; Cancel changes nothing.
 */
export function RotateDocumentButton({
  docId,
  mimeType,
  disabled = false,
}: {
  docId: string;
  /** A PDF is shown in the browser's own viewer, a photo as an image. */
  mimeType: string | null;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [turn, setTurn] = useState(0);
  const [pending, start] = useTransition();
  const pdf = mimeType === 'application/pdf';

  const openViewer = () =>
    start(async () => {
      const result = await documentLink(docId, 'file');
      if (!result.ok || !result.url) {
        toast(result.message ?? 'The file could not be opened.', { tone: 'coral' });
        return;
      }
      setUrl(result.url);
      setTurn(0);
      setOpen(true);
    });

  const close = () => {
    setOpen(false);
    setUrl(null);
  };

  const save = () =>
    start(async () => {
      const result = await rotateDocument(docId, turn as 90 | 180 | 270);
      toast(result.message ?? (result.ok ? 'Saved.' : 'The document could not be turned.'), {
        tone: result.ok ? 'green' : 'coral',
      });
      if (result.ok) close();
      router.refresh();
    });

  // A quarter turn swaps width and height: the picture is fitted to the
  // shorter side so it stays inside the frame whichever way it faces.
  const sideways = turn === 90 || turn === 270;

  return (
    <>
      <Button
        size="sm"
        tone="ghost"
        disabled={disabled || pending}
        title="Open the document, turn it the right way up, then save"
        onClick={openViewer}
      >
        {pending && !open ? 'Opening…' : 'Rotate ↻'}
      </Button>
      <Modal
        open={open}
        title="Turn the document the right way up"
        wide
        onClose={close}
        dirty={turn !== 0}
        footer={
          <>
            <Button tone="ghost" onClick={close} disabled={pending}>
              Cancel
            </Button>
            <Button tone="primary" onClick={save} disabled={pending || turn === 0}>
              {pending ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      >
        <div className="rotate-tools">
          <Button
            size="sm"
            tone="outline"
            onClick={() => setTurn((t) => (t + 270) % 360)}
            disabled={pending}
            aria-label="Turn a quarter anticlockwise"
          >
            ↺ Left
          </Button>
          <Button
            size="sm"
            tone="outline"
            onClick={() => setTurn((t) => (t + 90) % 360)}
            disabled={pending}
            aria-label="Turn a quarter clockwise"
          >
            Right ↻
          </Button>
          <span className="muted sm">
            {turn === 0 ? 'As uploaded' : `Turned ${turn}° clockwise — press Save to keep it`}
          </span>
        </div>
        <div className="rotate-frame">
          {url ? (
            pdf ? (
              <iframe
                title="Document preview"
                src={`${url}#toolbar=0&navpanes=0&view=Fit`}
                className={`rotate-view ${sideways ? 'sideways' : ''}`}
                style={{ transform: `rotate(${turn}deg)` }}
              />
            ) : (
              <img
                src={url}
                alt="Document preview"
                className={`rotate-view ${sideways ? 'sideways' : ''}`}
                style={{ transform: `rotate(${turn}deg)` }}
              />
            )
          ) : null}
        </div>
      </Modal>
    </>
  );
}
