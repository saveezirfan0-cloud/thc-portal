'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@thc/ui';
import type { RecordNews } from '../view-model';

/** Records whose flash-up this browser has already shown and closed. */
export const SEEN_RECORDS_KEY = 'thc.events.records-seen';

function readSeen(): string[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(SEEN_RECORDS_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function markSeen(keys: string[]) {
  try {
    const seen = new Set([...readSeen(), ...keys]);
    // Records only ever move forward; the last few are all worth keeping.
    window.localStorage.setItem(SEEN_RECORDS_KEY, JSON.stringify([...seen].slice(-20)));
  } catch {
    // Private window or blocked storage: the flash-up shows again next time.
  }
}

const CONFETTI = 36;

/**
 * The "record" badge in the Week / Day totals bar, and the congratulations
 * it flashes up the first time this browser opens a period that holds a
 * record. The badge stays (and opens the message again); the flash-up does
 * not repeat on every 60-second refresh, or every visit.
 */
export function RecordFlash({ records }: { records: RecordNews[] }) {
  const [open, setOpen] = useState(false);
  const keys = records.map((r) => r.key).join('|');

  useEffect(() => {
    if (!keys) return;
    const seen = new Set(readSeen());
    if (keys.split('|').some((key) => !seen.has(key))) setOpen(true);
  }, [keys]);

  if (records.length === 0) return null;

  const close = () => {
    markSeen(records.map((r) => r.key));
    setOpen(false);
  };

  return (
    <>
      {records.map((record) => (
        <button
          key={record.key}
          type="button"
          className="record-badge"
          onClick={() => setOpen(true)}
          title={record.headline}
        >
          <Trophy />
          {record.badge}
        </button>
      ))}
      {open ? (
        <div className="record-confetti" aria-hidden="true">
          {Array.from({ length: CONFETTI }, (_, i) => (
            <i key={i} style={{ ['--i' as string]: i, ['--d' as string]: i % 9 }} />
          ))}
        </div>
      ) : null}
      <Modal
        open={open}
        onClose={close}
        title={records.length > 1 ? 'Congratulations — two records!' : 'Congratulations!'}
        footer={
          <button type="button" className="btn primary sm" onClick={close} autoFocus>
            Brilliant
          </button>
        }
      >
        <div className="record-flash">
          <span className="record-trophy">
            <Trophy />
          </span>
          {records.map((record) => (
            <div key={record.key} className="record-news">
              <b>{record.headline}</b>
              <span className="muted sm">{record.detail}</span>
            </div>
          ))}
          <span className="sm">Well done, everyone.</span>
        </div>
      </Modal>
    </>
  );
}

function Trophy() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" focusable="false">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8 4h8v5a4 4 0 0 1-8 0V4ZM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 21h8M9 17h6"
      />
    </svg>
  );
}
