'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, toast } from '@thc/ui';
import { rescanDocument } from './rescanActions';

/** "Retry AI scan": read the document again and pre-fill what it finds. */
export function RescanButton({ docId, disabled = false }: { docId: string; disabled?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      tone="ghost"
      disabled={disabled || pending}
      title="Read the document again with the AI. It only pre-fills; you still verify."
      onClick={() =>
        start(async () => {
          const result = await rescanDocument(docId);
          toast(result.message ?? (result.ok ? 'AI scan done.' : 'The AI scan failed.'), {
            tone: result.ok ? 'green' : 'coral',
          });
          router.refresh();
        })
      }
    >
      {pending ? 'Scanning…' : 'Retry AI scan'}
    </Button>
  );
}
