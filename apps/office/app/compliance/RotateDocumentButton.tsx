'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, toast } from '@thc/ui';
import { rotateDocument } from './rotateActions';

/**
 * "Rotate" (ADR-0212, TK-18): a photo the wrong way round is turned a
 * quarter clockwise per press and kept that way — no rejection needed.
 */
export function RotateDocumentButton({
  docId,
  disabled = false,
}: {
  docId: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      tone="ghost"
      disabled={disabled || pending}
      title="Turn the photo a quarter clockwise and keep it that way"
      onClick={() =>
        start(async () => {
          const result = await rotateDocument(docId);
          toast(result.message ?? (result.ok ? 'Turned.' : 'The photo could not be turned.'), {
            tone: result.ok ? 'green' : 'coral',
          });
          router.refresh();
        })
      }
    >
      {pending ? 'Turning…' : 'Rotate ↻'}
    </Button>
  );
}
