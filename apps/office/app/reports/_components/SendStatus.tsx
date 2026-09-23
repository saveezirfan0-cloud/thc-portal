import { sendStatus } from '../view-model';
import type { ReportSend } from '../view-model';
import { RetrySend } from './RetrySend';

const MARK = { ok: '✓ ', fail: '✕ ', none: '', queued: '' } as const;

/**
 * "each tab shows the last-sent date/time and a status" (§9.9). The chip
 * reads the latest run for the tab's kind; a failed one carries Retry.
 */
export function SendStatus({ send, detail }: { send: ReportSend | null; detail?: string }) {
  const status = sendStatus(send);
  return (
    <>
      <span className={`sent ${status.tone}`} title={send?.error ?? undefined}>
        {MARK[status.tone]}
        {status.text}
        {detail ? ` · ${detail}` : ''}
      </span>
      {send && send.status === 'failed' ? <RetrySend sendId={send.id} /> : null}
    </>
  );
}
