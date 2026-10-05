import type { TimeFormat } from '@thc/domain';
import { sendStatus } from '../view-model';
import type { ReportSend } from '../view-model';
import { RetrySend } from './RetrySend';

const MARK = { ok: '✓ ', fail: '✕ ', none: '', queued: '' } as const;

/**
 * "each tab shows the last-sent date/time and a status" (§9.9). The chip
 * reads the latest run for the tab's kind; a failed one carries Retry.
 */
export function SendStatus({
  send,
  detail,
  format,
}: {
  send: ReportSend | null;
  detail?: string;
  /** The operator's clock (ADR-0085); a server component, so the page passes it down. */
  format?: TimeFormat;
}) {
  const status = sendStatus(send, format);
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
