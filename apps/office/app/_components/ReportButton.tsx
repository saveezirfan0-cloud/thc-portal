'use client';

import Link from 'next/link';
import { useEffect, useId, useState, useTransition } from 'react';
import { Alert, Button, Modal, toast } from '@thc/ui';
import { createTicket } from '../tickets/actions';
import { finishTicketFile, startTicketFileUpload } from '../tickets/file-actions';
import {
  FILES_PER_TICKET,
  FILE_EXTENSIONS,
  RECORDING_BITS_PER_SECOND,
  RECORDING_MAX_SECONDS,
  baseMime,
  fileProblem,
  kindFor,
  sizeLabel,
} from '../tickets/ticket-files';
import type { TicketFileKind } from '../tickets/ticket-files';
import {
  DETAILS_MAX,
  KINDS,
  KIND_LABEL,
  SEVERITIES,
  SEVERITY_LABEL,
  TITLE_MAX,
  validateDraft,
} from '../tickets/view-model';
import { lengthHint } from '../_lib/length';
import { appendDictation } from '../_lib/dictation';
import {
  captureProblem,
  captureScreenshot,
  recordingSupported,
  screenshotSupported,
  startRecording,
} from '../_lib/screenCapture';
import type { Recording } from '../_lib/screenCapture';
import { putSignedUpload } from '../_lib/signed-upload';
import { useSharedState } from '../_lib/sharedState';
import './report-button.css';
import { DictateButton } from './DictateButton';

const BLANK = { kind: 'bug', severity: '', title: '', details: '', link: '' };
const NO_FILES: PendingFile[] = [];

/** A file chosen or captured, waiting for the ticket to exist. */
interface PendingFile {
  key: string;
  blob: Blob;
  name: string;
  type: string;
  kind: TicketFileKind;
}

const ACCEPT = Object.keys(FILE_EXTENSIONS).join(',');

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Files are numbered across pages too, so two never share a key. */
let fileCounter = 0;

/**
 * The top bar's "Ticket" button (ADR-0202): anyone in the Back Office says
 * what is broken, what they need or what has changed (a Viewer is refused
 * `read_only` by the database, ADR-0060, as everywhere). It
 * becomes a numbered ticket (TK-12), is emailed to the owner, and is
 * followed up on /tickets. The page the person was on is sent with it,
 * and so can screenshots, videos and a screen recording (ADR-0204): the
 * ticket is saved first, then each file is uploaded to it, so a failed upload
 * never loses the report.
 *
 * The draft, the files and a recording in progress are kept in
 * `useSharedState`, not in the component: Next remounts this button on every
 * route change, and a recording is only worth having if the reporter can
 * click through the screens they are showing.
 */
export function ReportButton() {
  const ids = useId();
  // Read when the dialog opens: the page the report is about, not a router hook.
  const [page, setPage] = useSharedState('ticket.page', '');
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useSharedState('ticket.draft', BLANK);
  const [problem, setProblem] = useSharedState<string | null>('ticket.problem', null);
  const [pending, start] = useTransition();
  const [files, setFiles] = useSharedState('ticket.files', NO_FILES);
  const [recording, setRecording] = useSharedState<Recording | null>('ticket.recording', null);
  const [startedAt, setStartedAt] = useSharedState('ticket.recordingStart', 0);
  // Set when a capture ends, wherever the reporter is by then: the dialog comes back.
  const [reopen, setReopen] = useSharedState('ticket.reopen', false);
  const [now, setNow] = useState(0);
  // Known only after mount: it is a property of the browser.
  const [canShoot, setCanShoot] = useState(false);
  const [canRecord, setCanRecord] = useState(false);

  useEffect(() => {
    setCanShoot(screenshotSupported());
    setCanRecord(recordingSupported());
  }, []);

  useEffect(() => {
    if (reopen) {
      setReopen(false);
      setOpen(true);
    }
  }, [reopen, setReopen]);

  useEffect(() => {
    if (!recording) return;
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [recording]);

  const seconds = recording && now > 0 ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;

  const set = (key: keyof typeof BLANK) => (value: string) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(BLANK) || files.length > 0;

  /** Queue a file for the ticket; the reason it cannot be, or null. Reads the store, not a stale render. */
  const add = (blob: Blob, name: string, recorded = false): string | null => {
    const type = baseMime(blob.type);
    const kind = kindFor(type, recorded);
    const refused = fileProblem({ name, type, size: blob.size });
    if (refused || !kind) return refused ?? 'That file cannot be attached.';
    let added = false;
    setFiles((current) => {
      if (current.length >= FILES_PER_TICKET) return current;
      added = true;
      fileCounter += 1;
      return [...current, { key: `f${fileCounter}`, blob, name, type, kind }];
    });
    return added ? null : `At most ${FILES_PER_TICKET} files on one ticket.`;
  };
  const room = FILES_PER_TICKET - files.length;

  const choose = (list: FileList | null) => {
    if (!list) return;
    const problems: string[] = [];
    Array.from(list).forEach((file) => {
      const refused = add(file, file.name);
      if (refused) problems.push(refused);
    });
    setProblem(problems.length > 0 ? Array.from(new Set(problems)).join(' ') : null);
  };

  // The dialog steps aside so it is not in the picture; the draft stays.
  const shoot = async () => {
    setOpen(false);
    setProblem(null);
    try {
      const blob = await captureScreenshot();
      setProblem(add(blob, `Screenshot ${files.length + 1}.png`));
    } catch (error) {
      setProblem(captureProblem(error));
    }
    setReopen(true);
  };

  const record = async () => {
    setOpen(false);
    setProblem(null);
    try {
      const running = await startRecording(RECORDING_MAX_SECONDS, RECORDING_BITS_PER_SECOND);
      setStartedAt(Date.now());
      setRecording(running);
      const blob = await running.done;
      setRecording(null);
      const extension = baseMime(blob.type) === 'video/mp4' ? 'mp4' : 'webm';
      setProblem(
        blob.size > 0 ? add(blob, `Recording.${extension}`, true) : 'Nothing was recorded.',
      );
    } catch (error) {
      setRecording(null);
      setProblem(captureProblem(error));
    }
    setReopen(true);
  };

  // Cancel keeps the draft and its files, as it always kept the draft.
  const close = () => {
    setOpen(false);
    setProblem(null);
  };

  const submit = () => {
    const invalid = validateDraft(draft);
    if (invalid) {
      setProblem(invalid);
      return;
    }
    setProblem(null);
    start(async () => {
      const result = await createTicket(draft, page);
      if (!result.ok) {
        setProblem(result.message);
        return;
      }
      setDraft(BLANK);
      setOpen(false);
      const sent = result.ref ? `Sent as ${result.ref}.` : 'Sent.';
      const ticketId = result.id;
      const waiting = files;
      if (waiting.length === 0) {
        toast(`${sent} Thank you.`, { tone: 'green' });
        return;
      }
      setFiles(NO_FILES);
      if (!ticketId) {
        toast(`${sent} The files could not be attached. Add a link on the ticket instead.`, {
          tone: 'coral',
        });
        return;
      }
      toast(
        `${sent} Uploading ${waiting.length === 1 ? 'your file' : `${waiting.length} files`}…`,
        {
          tone: 'green',
        },
      );
      let failed = 0;
      for (const file of waiting) {
        const slot = await startTicketFileUpload(ticketId, {
          name: file.name,
          type: file.type,
          size: file.blob.size,
        });
        const stored = slot.ok && (await putSignedUpload(slot.signedUrl, file.blob, file.type));
        const attached =
          slot.ok && stored && (await finishTicketFile(ticketId, slot.path, file.kind, file.name));
        if (!attached || !attached.ok) failed += 1;
      }
      toast(
        failed === 0
          ? `${sent} Files attached. Thank you.`
          : `${sent} ${failed === 1 ? 'One file' : `${failed} files`} could not be attached. Add a link instead, or tell us on the ticket.`,
        { tone: failed === 0 ? 'green' : 'coral' },
      );
    });
  };

  return (
    <>
      <Button
        size="sm"
        onClick={() => {
          setPage(window.location.pathname + window.location.search);
          setOpen(true);
        }}
      >
        Ticket
      </Button>
      <Modal
        open={open}
        title="New ticket"
        onClose={close}
        dismissible={!pending}
        dirty={dirty}
        onSubmit={submit}
        footer={
          <>
            <Button type="button" onClick={close} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" tone="primary" disabled={pending}>
              {pending ? 'Sending…' : 'Send'}
            </Button>
          </>
        }
      >
        <div className="field">
          <label className="label" htmlFor={`${ids}-kind`}>
            What kind of report?
          </label>
          <select
            id={`${ids}-kind`}
            className="input"
            value={draft.kind}
            disabled={pending}
            onChange={(e) => set('kind')(e.target.value)}
          >
            {KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {KIND_LABEL[kind]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor={`${ids}-severity`}>
            How bad is it?
          </label>
          <select
            id={`${ids}-severity`}
            className="input"
            value={draft.severity}
            disabled={pending}
            onChange={(e) => set('severity')(e.target.value)}
          >
            <option value="">— Optional —</option>
            {SEVERITIES.map((severity) => (
              <option key={severity} value={severity}>
                {SEVERITY_LABEL[severity]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <div className="label-row">
            <label className="label" htmlFor={`${ids}-title`}>
              One-line summary *
            </label>
            <DictateButton
              label="Dictate summary"
              disabled={pending}
              onText={(spoken) =>
                setDraft((d) => ({ ...d, title: appendDictation(d.title, spoken, TITLE_MAX) }))
              }
            />
          </div>
          <input
            id={`${ids}-title`}
            className="input"
            value={draft.title}
            maxLength={TITLE_MAX}
            disabled={pending}
            autoFocus
            placeholder='e.g. "Event card vanishes after I drag it on Scheduling"'
            onChange={(e) => set('title')(e.target.value)}
          />
        </div>
        <div className="field">
          <div className="label-row">
            <label className="label" htmlFor={`${ids}-details`}>
              Details — what did you do, what did you expect, what happened?
            </label>
            <DictateButton
              label="Dictate details"
              disabled={pending}
              onText={(spoken) =>
                setDraft((d) => ({
                  ...d,
                  details: appendDictation(d.details, spoken, DETAILS_MAX),
                }))
              }
            />
          </div>
          <textarea
            id={`${ids}-details`}
            className="input"
            rows={5}
            value={draft.details}
            maxLength={DETAILS_MAX}
            disabled={pending}
            onChange={(e) => set('details')(e.target.value)}
          />
          {lengthHint(draft.details.length, DETAILS_MAX) ? (
            <span className="hint">{lengthHint(draft.details.length, DETAILS_MAX)}</span>
          ) : null}
        </div>
        <div className="field">
          <div className="label">Screenshot, video or screen recording (optional)</div>
          <div className="tk-attach">
            <label className="btn sm tk-attach-file">
              Attach a file
              <input
                type="file"
                accept={ACCEPT}
                multiple
                hidden
                disabled={pending || room <= 0}
                onChange={(e) => {
                  choose(e.target.files);
                  e.target.value = '';
                }}
              />
            </label>
            {canShoot ? (
              <Button type="button" size="sm" disabled={pending || room <= 0} onClick={shoot}>
                Take a screenshot
              </Button>
            ) : null}
            {canRecord ? (
              <Button type="button" size="sm" disabled={pending || room <= 0} onClick={record}>
                Record my screen
              </Button>
            ) : null}
          </div>
          {files.length > 0 ? (
            <ul className="tk-attach-list">
              {files.map((file) => (
                <li key={file.key}>
                  <span>
                    {file.name} · {sizeLabel(file.blob.size)}
                  </span>
                  <button
                    type="button"
                    className="tk-attach-remove"
                    aria-label={`Remove ${file.name}`}
                    disabled={pending}
                    onClick={() => setFiles((current) => current.filter((f) => f.key !== file.key))}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <span className="hint">
            Up to {FILES_PER_TICKET} files, 50 MB each.{' '}
            {canRecord
              ? `A recording stops by itself after ${RECORDING_MAX_SECONDS / 60} minutes.`
              : 'Screen capture is not available in this browser: attach a file or paste a link.'}
          </span>
        </div>
        <div className="field">
          <label className="label" htmlFor={`${ids}-link`}>
            Or a link to a screenshot or recording (optional)
          </label>
          <input
            id={`${ids}-link`}
            className="input"
            inputMode="url"
            value={draft.link}
            disabled={pending}
            placeholder="https://… (Loom, Teams, SharePoint)"
            onChange={(e) => set('link')(e.target.value)}
          />
        </div>
        <p className="hint">
          We send the page you are on ({page}) with it, and email it to the owner. Everything sent
          is on the <Link href="/tickets">Tickets</Link> page.
        </p>
        {problem ? <Alert tone="coral">{problem}</Alert> : null}
      </Modal>
      {recording ? (
        <div className="tk-recording" role="status">
          <span className="tk-recording-dot" aria-hidden="true" /> Recording your screen ·{' '}
          {clock(seconds)}
          <Button type="button" size="sm" tone="primary" onClick={() => recording.stop()}>
            Stop and attach
          </Button>
        </div>
      ) : null}
    </>
  );
}
