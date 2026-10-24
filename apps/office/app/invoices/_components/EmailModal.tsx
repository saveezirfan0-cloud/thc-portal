'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Checkbox, Input, Modal, toast } from '@thc/ui';
import { sendInvoiceEmail } from '../_lib/actions';
import {
  bccKey,
  emailProblem,
  fileSize,
  parseAddresses,
  safeEditorHtml,
  signatureKey,
} from '../_lib/email';

export interface EmailAttachmentOption {
  /** Storage path in the timesheets bucket (what `queue_timesheet_invoice_email` receives). */
  path: string;
  label: string;
  size: number | null;
}

export interface EmailInit {
  /** The signed-in user: who replies go to, and the key the Bcc / signature are remembered under. */
  userId: string;
  userName: string;
  userEmail: string | null;
  /** The platform sender the mail leaves from (`settings.senders.timesheets`). */
  platformSender: string;
  to: string[];
  cc: string[];
  subject: string;
  bodyHtml: string;
  attachments: EmailAttachmentOption[];
}

/** Rich text limited to what the sender allows: bold, italic, underline, links. */
function Editor({
  html,
  onChange,
  label,
  className,
}: {
  html: string;
  onChange: (html: string) => void;
  label: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [url, setUrl] = useState('https://');
  const saved = useRef<Range | null>(null);

  // Set once per opening; the editor is uncontrolled while it is typed in.
  useEffect(() => {
    if (ref.current) ref.current.innerHTML = safeEditorHtml(html);
    try {
      document.execCommand('defaultParagraphSeparator', false, 'p');
    } catch {
      /* not every browser knows it; the sender flattens divs to text anyway */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = (command: 'bold' | 'italic' | 'underline') => {
    ref.current?.focus();
    document.execCommand(command);
    onChange(ref.current?.innerHTML ?? '');
  };

  const openLink = () => {
    const selection = window.getSelection();
    saved.current =
      selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
    setLinkOpen(true);
  };

  const applyLink = () => {
    const href = url.trim();
    if (/^(https?:\/\/|mailto:)\S+$/i.test(href) && href !== 'https://') {
      ref.current?.focus();
      const selection = window.getSelection();
      if (saved.current && selection) {
        selection.removeAllRanges();
        selection.addRange(saved.current);
      }
      document.execCommand('createLink', false, href);
      onChange(ref.current?.innerHTML ?? '');
    }
    setLinkOpen(false);
    setUrl('https://');
  };

  return (
    <div className="stack tight">
      <div className="inv-toolbar" role="toolbar" aria-label={`${label} formatting`}>
        <Button
          size="sm"
          aria-label="Bold"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => run('bold')}
        >
          <b>B</b>
        </Button>
        <Button
          size="sm"
          aria-label="Italic"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => run('italic')}
        >
          <i>I</i>
        </Button>
        <Button
          size="sm"
          aria-label="Underline"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => run('underline')}
        >
          <u>U</u>
        </Button>
        <Button
          size="sm"
          aria-label="Link"
          onMouseDown={(e) => e.preventDefault()}
          onClick={openLink}
        >
          Link
        </Button>
      </div>
      {linkOpen ? (
        <div className="row">
          <input
            className="input"
            aria-label="Link address"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                applyLink();
              }
            }}
          />
          <Button size="sm" tone="primary" onClick={applyLink}>
            Add link
          </Button>
        </div>
      ) : null}
      <div
        ref={ref}
        className={`inv-editor${className ? ` ${className}` : ''}`}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={label}
        onInput={(event) => onChange(event.currentTarget.innerHTML)}
        onPaste={(event) => {
          // Plain text only: pasted styling would be cut by the sender anyway.
          event.preventDefault();
          document.execCommand('insertText', false, event.clipboardData.getData('text/plain'));
        }}
      />
    </div>
  );
}

/**
 * Email Invoice (audit §2.5, ADR-0210): From shows the signed-in user and
 * the platform sender it leaves from; To starts as the client's invoice
 * emails; Cc as the client card's CC; Bcc is remembered per user in this
 * browser. Subject and body are the notifications package's wording, with
 * the user's own signature (kept in this browser — "Save template"). The
 * attachments are tick boxes: the invoice PDF, the Excel, every original
 * timesheet. Attaching a file from the computer is out of scope.
 */
export function EmailModal({
  invoiceId,
  number,
  init,
  open,
  onClose,
}: {
  invoiceId: string;
  number: number;
  init: EmailInit;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [to, setTo] = useState(init.to.join(', '));
  const [cc, setCc] = useState(init.cc.join(', '));
  const [bcc, setBcc] = useState('');
  const [subject, setSubject] = useState(init.subject);
  const [body, setBody] = useState(init.bodyHtml);
  const [signature, setSignature] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set(init.attachments.map((a) => a.path)));
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // Bump to remount the editors with remembered values when the modal opens.
  const [session, setSession] = useState(0);
  const [initialSignature, setInitialSignature] = useState('');

  useEffect(() => {
    if (!open) return;
    let remembered = '';
    let rememberedBcc = '';
    try {
      remembered = safeEditorHtml(window.localStorage.getItem(signatureKey(init.userId)) ?? '');
      rememberedBcc = window.localStorage.getItem(bccKey(init.userId)) ?? '';
    } catch {
      /* private mode: nothing is remembered */
    }
    setTo(init.to.join(', '));
    setCc(init.cc.join(', '));
    setBcc(rememberedBcc);
    setSubject(init.subject);
    setBody(init.bodyHtml);
    setSignature(remembered);
    setInitialSignature(remembered);
    setPicked(new Set(init.attachments.map((a) => a.path)));
    setError(null);
    setNote(null);
    setSession((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const draft = () => ({
    to: parseAddresses(to),
    cc: parseAddresses(cc),
    bcc: parseAddresses(bcc),
    subject,
    bodyHtml: body + signature,
  });

  const saveTemplate = () => {
    try {
      window.localStorage.setItem(signatureKey(init.userId), signature);
      setNote(
        'Signature saved as your default for every invoice. The greeting and the invoice line fill in by themselves.',
      );
    } catch {
      setNote('This browser would not keep it (private mode?).');
    }
  };

  const send = () => {
    const email = draft();
    const problem = emailProblem(email);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    start(async () => {
      const result = await sendInvoiceEmail(invoiceId, {
        ...email,
        attachmentPaths: init.attachments.filter((a) => picked.has(a.path)).map((a) => a.path),
        replyTo: init.userEmail,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      try {
        window.localStorage.setItem(bccKey(init.userId), bcc.trim());
      } catch {
        /* nothing remembered */
      }
      toast(result.message ?? `Invoice ${number} queued.`, { tone: 'green' });
      onClose();
      router.refresh();
    });
  };

  const dirty = subject !== init.subject || body !== init.bodyHtml;

  return (
    <Modal
      open={open}
      wide
      title={`Email invoice #${number}`}
      onClose={onClose}
      dismissible={!pending}
      dirty={dirty}
      footer={
        <>
          <Button tone="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button tone="green" onClick={send} disabled={pending}>
            {pending ? 'Sending…' : 'Send'}
          </Button>
        </>
      }
    >
      <div className="inv-mail" key={session}>
        <div className="kvrow">
          <span className="label">From</span>
          <span className="sm">
            {init.userName}
            {init.userEmail ? ` <${init.userEmail}>` : ''}{' '}
            <span className="muted">
              · sent from {init.platformSender}; replies go to {init.userEmail ?? 'the sender'}
            </span>
          </span>
        </div>
        <Input
          label="To"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          hint="Separate addresses with commas. Starts as the client's invoice emails."
        />
        <Input
          label="Cc"
          value={cc}
          onChange={(e) => setCc(e.target.value)}
          placeholder="cc@example.com"
        />
        <Input
          label="Bcc"
          value={bcc}
          onChange={(e) => setBcc(e.target.value)}
          placeholder="bcc@example.com"
          hint="Remembered for you in this browser."
        />
        <Input
          label="Subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={300}
        />

        <div className="stack tight">
          <span className="label">Message</span>
          <Editor html={init.bodyHtml} onChange={setBody} label="Message" />
        </div>
        <div className="stack tight">
          <span className="label">Signature</span>
          <Editor
            html={initialSignature}
            onChange={setSignature}
            label="Signature"
            className="sig"
          />
          <div className="row">
            <Button size="sm" onClick={saveTemplate}>
              Save template
            </Button>
            <span className="muted xs">
              Your signature is saved as the default for every invoice, in this browser.
            </span>
          </div>
          {note ? <span className="muted xs">{note}</span> : null}
        </div>

        <div className="inv-attach">
          <span className="label">Attachments</span>
          {init.attachments.length === 0 ? (
            <span className="muted sm">This invoice has no files to attach yet.</span>
          ) : (
            init.attachments.map((attachment) => (
              <Checkbox
                key={attachment.path}
                checked={picked.has(attachment.path)}
                onChange={(checked) =>
                  setPicked((current) => {
                    const next = new Set(current);
                    if (checked) next.add(attachment.path);
                    else next.delete(attachment.path);
                    return next;
                  })
                }
              >
                {attachment.label}{' '}
                {attachment.size !== null ? (
                  <span className="muted">({fileSize(attachment.size)})</span>
                ) : null}
              </Checkbox>
            ))
          )}
        </div>

        {error ? <Alert tone="coral">{error}</Alert> : null}
      </div>
    </Modal>
  );
}
