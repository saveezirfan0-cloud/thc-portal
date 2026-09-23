import Link from 'next/link';
import type { ReactNode } from 'react';
import { Alert } from '@thc/ui';
import { StaffShell } from '../../_components/StaffShell';
import { documentsGate } from '../gate';
import { loadDocuments, supabaseConfigured } from '../data';
import type { DocumentsData } from '../types';

/**
 * The frame every Documents sub-screen shares (upload, completion letter,
 * opt-out, declaration): "‹ Documents" above the title, the Documents tab
 * active, and the same lock handling as the tab itself (`documentsGate`).
 */
export async function SubScreen({
  title,
  children,
}: {
  title: string;
  children: (data: DocumentsData) => ReactNode | Promise<ReactNode>;
}) {
  const gate = await documentsGate();
  const heading = (
    <>
      <Link className="back-link" href="/documents">
        ‹ Documents
      </Link>
      {title}
    </>
  );

  if (!supabaseConfigured()) {
    return (
      <StaffShell title={heading} active="/documents">
        <Alert tone="coral">
          This environment has no Supabase project, so nothing can be uploaded. See
          docs/04-setup-github-vercel-supabase.md.
        </Alert>
      </StaffShell>
    );
  }

  const data = gate.open ? await loadDocuments() : null;
  return (
    <StaffShell title={heading} active="/documents" ignoreLock={gate.ignoreLock}>
      {data ? (
        await children(data)
      ) : (
        <Alert tone="coral">We couldn’t load your documents. Please try again.</Alert>
      )}
    </StaffShell>
  );
}

export function NotAvailable({ children }: { children: ReactNode }) {
  return (
    <div className="static-screen">
      <p>{children}</p>
      <Link className="btn outline block" href="/documents">
        Back to Documents
      </Link>
    </div>
  );
}
