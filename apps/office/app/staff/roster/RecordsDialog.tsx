'use client';

import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';
import { Alert, Button, EmptyState, Modal, useTimeFormat } from '@thc/ui';
import { Pager } from '../../_components/Pager';
import { ukStampFull } from '../../_lib/rtwCheck';
import { loadEmailRecords } from './actions';
import { RECORDS_PAGE, RECORD_KIND_LABEL, failureReason } from './emails';
import type { EmailRecordKind, EmailRecordsPage, StaffEmail } from './emails';

/**
 * The records behind one count on "Emails staff receive" (ADR-0144): who
 * the email went to, when, and for one not delivered, why. Read a page at a
 * time from `staff_email_records()` when it opens; nothing is held in the
 * page until then.
 */
export function RecordsDialog({
  email,
  kind,
  onClose,
}: {
  email: StaffEmail;
  kind: EmailRecordKind;
  onClose: () => void;
}) {
  const format = useTimeFormat();
  const [page, setPage] = useState(0);
  const [data, setData] = useState<EmailRecordsPage | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const label = RECORD_KIND_LABEL[kind];

  useEffect(() => {
    start(async () => {
      const result = await loadEmailRecords(email.id, kind, page * RECORDS_PAGE, RECORDS_PAGE);
      if (result.ok) {
        setData(result.page);
        setProblem(null);
      } else setProblem(result.message);
    });
  }, [email.id, kind, page]);

  return (
    <Modal
      open
      wide
      title={`${email.name} · ${label.title}${data ? ` (${data.total.toLocaleString('en-GB')})` : ''}`}
      onClose={onClose}
      footer={
        <Button tone="primary" onClick={onClose}>
          Close
        </Button>
      }
    >
      {problem ? <Alert tone="coral">{problem}</Alert> : null}
      {!data ? (
        <p className="muted sm" role="status">
          {pending ? 'Loading…' : ''}
        </p>
      ) : data.rows.length === 0 ? (
        <EmptyState>
          <h3>Nothing to show</h3>
          <p>No records for this count right now.</p>
        </EmptyState>
      ) : (
        <>
          {/* A plain sideways scroller: the page's TableScroll pins its header
              to the window, which inside a dialog lands over the first row. */}
          <div
            className="roster-records-wrap"
            role="region"
            aria-label={`${email.name}: ${label.title}`}
            tabIndex={0}
          >
            <table className="tbl roster-records" aria-busy={pending}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email address</th>
                  <th>{label.when}</th>
                  {kind === 'people' ? <th className="num">Times</th> : null}
                  {kind === 'failed' ? <th>Why</th> : null}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, i) => (
                  <tr key={`${row.email}-${row.at ?? ''}-${i}`}>
                    <td>
                      {row.staffId ? (
                        <Link href={`/staff/${row.staffId}`}>{row.name || 'Their profile'}</Link>
                      ) : (
                        (row.name ?? <span className="muted">—</span>)
                      )}
                    </td>
                    <td className="sm">{row.email}</td>
                    <td className="sm">{row.at ? ukStampFull(row.at, format) : '—'}</td>
                    {kind === 'people' ? <td className="num">{row.times}</td> : null}
                    {kind === 'failed' ? (
                      <td className="sm">
                        {failureReason(row.error)}
                        {row.error && failureReason(row.error) !== row.error ? (
                          <div className="muted">{row.error}</div>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.total > RECORDS_PAGE ? (
            <Pager total={data.total} page={page} pageSize={RECORDS_PAGE} onPage={setPage} />
          ) : null}
        </>
      )}
    </Modal>
  );
}
