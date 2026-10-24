'use client';

import { useTransition } from 'react';
import { Button, toast } from '@thc/ui';
import { documentLink } from '../onboarding/actions';

/**
 * "View" on a Needs review row (ADR-0210, TK-12): the uploaded file in a new
 * tab, so a passport is read and decided from this screen instead of the
 * profile's Documents tab. The same short-lived link that tab signs
 * (`documentLink`): the path is read through the manager's session, never
 * taken from the browser.
 */
export function ViewDocumentButton({
  docId,
  disabled = false,
}: {
  docId: string;
  disabled?: boolean;
}) {
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      tone="outline"
      disabled={disabled || pending}
      title="Open the uploaded file in a new tab"
      onClick={() =>
        start(async () => {
          const result = await documentLink(docId, 'file');
          if (result.ok && result.url) window.open(result.url, '_blank', 'noopener');
          else if (!result.ok)
            toast(result.message ?? 'The file could not be opened.', { tone: 'coral' });
        })
      }
    >
      {pending ? 'Opening…' : 'View'}
    </Button>
  );
}
