'use client';

import { useId, useState, useTransition } from 'react';
import { Alert, Button, Modal, toast } from '@thc/ui';
import { createTicket } from '../tickets/actions';
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

const BLANK = { kind: 'bug', severity: '', title: '', details: '', link: '' };

/**
 * The top bar's "Report" button (ADR-0198): anyone in the Back Office, a
 * Viewer too, says what is broken, what they need or what has changed. It
 * becomes a numbered ticket (TK-12), is emailed to the owner, and is
 * followed up on /tickets. The page the person was on is sent with it.
 */
export function ReportButton() {
  const ids = useId();
  // Read when the dialog opens: the page the report is about, not a router hook.
  const [page, setPage] = useState('');
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(BLANK);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const set = (key: keyof typeof BLANK) => (value: string) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(BLANK);

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
      toast(result.ref ? `Sent as ${result.ref}. Thank you.` : 'Sent. Thank you.', {
        tone: 'green',
      });
    });
  };

  return (
    <>
      <Button
        size="sm"
        onClick={() => {
          setPage(window.location.pathname);
          setOpen(true);
        }}
      >
        Report
      </Button>
      <Modal
        open={open}
        title="Report something"
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
          <label className="label" htmlFor={`${ids}-title`}>
            One-line summary *
          </label>
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
          <label className="label" htmlFor={`${ids}-details`}>
            Details — what did you do, what did you expect, what happened?
          </label>
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
          <label className="label" htmlFor={`${ids}-link`}>
            Link to a screenshot or recording (optional)
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
          We send the page you are on ({page}) with your report, and email it to the owner.
        </p>
        {problem ? <Alert tone="coral">{problem}</Alert> : null}
      </Modal>
    </>
  );
}
