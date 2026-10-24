'use client';

import { useId, useMemo, useRef, useState } from 'react';
import { Alert, Button, Panel, SearchInput, Textarea } from '@thc/ui';
import { createClient } from '@thc/db/browser';
import { abandonUpload, finishUpload, startUpload } from '../actions';
import {
  ACCEPT_ATTR,
  FILE_HELP,
  MAX_FILES,
  mimeFor,
  sizeLabel,
  validateFiles,
} from '../validators';
import type { TimesheetClient } from '../types';

/**
 * Step 1 · Upload (audit §2.2). Pick the client, drop one or more files,
 * add a note, "Upload & process". The files go straight to the private
 * `timesheets` bucket on short-lived signed URLs (a server action cannot
 * carry 10 × 25 MB); the server checks them again, creates the job, and
 * reads them after the response. File type and size are validated here
 * first and again on the server.
 */
export function UploadForm({ clients, canAct }: { clients: TimesheetClient[]; canAct: boolean }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const id = useId();
  const [clientId, setClientId] = useState('');
  const [query, setQuery] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [notes, setNotes] = useState('');
  const [dragging, setDragging] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? clients.filter((c) => c.name.toLowerCase().includes(q)) : clients;
  }, [clients, query]);
  const chosen = clients.find((c) => c.id === clientId) ?? null;

  function addFiles(list: FileList | File[]) {
    const next = [...files];
    for (const f of Array.from(list)) {
      if (!next.some((x) => x.name === f.name && x.size === f.size)) next.push(f);
    }
    setFiles(next);
    setErrors(validateFiles(next));
  }

  function removeFile(index: number) {
    const next = files.filter((_, i) => i !== index);
    setFiles(next);
    setErrors(next.length > 0 ? validateFiles(next) : []);
  }

  async function submit() {
    const problems = [...(clientId ? [] : ['Choose a client.']), ...validateFiles(files)];
    setErrors(problems);
    if (problems.length > 0 || !canAct) return;

    setBusy('Preparing the upload…');
    const plan = await startUpload({
      clientId,
      files: files.map((f) => ({ name: f.name, size: f.size, type: f.type })),
    });
    if ('error' in plan) {
      setBusy(null);
      setErrors([plan.error]);
      return;
    }

    const storage = createClient().storage.from('timesheets');
    const uploaded: { fileId: string; name: string; size: number; type: string }[] = [];
    try {
      for (let i = 0; i < files.length; i += 1) {
        const file = files[i]!;
        const slot = plan.uploads[i]!;
        setBusy(`Uploading ${i + 1} of ${files.length}: ${file.name}`);
        const res = await storage.uploadToSignedUrl(slot.path, slot.token, file, {
          contentType: mimeFor(file.name),
        });
        if (res.error) throw new Error(res.error.message);
        uploaded.push({ fileId: slot.fileId, name: file.name, size: file.size, type: file.type });
      }
    } catch {
      await abandonUpload(plan.jobId, plan.uploads.map((u) => u.path));
      setBusy(null);
      setErrors(['The upload did not finish. Check your connection and try again.']);
      return;
    }

    setBusy('Starting…');
    const result = await finishUpload({ jobId: plan.jobId, clientId, notes, files: uploaded });
    // A success redirects to the job; only a refusal comes back.
    setBusy(null);
    if (result && 'error' in result) setErrors([result.error]);
  }

  const total = files.reduce((n, f) => n + f.size, 0);

  return (
    <Panel title="Upload timesheet">
      <form
        className="pr-upload stack"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <p className="sm muted">Select a client and upload one or more timesheet files to begin processing.</p>

        <fieldset className="pr-client" disabled={!canAct || busy !== null}>
          <legend className="label">Client</legend>
          <SearchInput
            label="Search clients"
            placeholder="Search clients…"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
          />
          <div className="pr-client-list" role="radiogroup" aria-label="Client">
            {visible.length === 0 ? (
              <p className="sm muted">No timesheet client matches “{query}”.</p>
            ) : (
              visible.map((c) => (
                <label key={c.id} className={`pr-client-opt${c.id === clientId ? ' on' : ''}`}>
                  <input
                    type="radio"
                    name={`${id}-client`}
                    value={c.id}
                    checked={c.id === clientId}
                    onChange={() => setClientId(c.id)}
                  />
                  <span>{c.name}</span>
                  <span className="xs muted">
                    {c.invoiceFormat === 'aggregated' ? 'Role aggregated' : 'Named staff'}
                    {c.poRequired ? ' · PO required' : ''}
                  </span>
                </label>
              ))
            )}
          </div>
          <span className="hint">Only clients set to timesheet invoicing on their client card are listed.</span>
        </fieldset>

        <div className="field">
          <span className="label" id={`${id}-files`}>
            Timesheet files
          </span>
          <div
            className={`pr-drop${dragging ? ' on' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              if (canAct && busy === null) addFiles(e.dataTransfer.files);
            }}
          >
            <p className="strong">Drag files here</p>
            <p className="sm muted">or</p>
            <Button
              size="sm"
              disabled={!canAct || busy !== null}
              onClick={() => fileInput.current?.click()}
              aria-describedby={`${id}-files`}
            >
              Choose files
            </Button>
            <input
              ref={fileInput}
              className="sr-only"
              type="file"
              multiple
              accept={ACCEPT_ATTR}
              tabIndex={-1}
              aria-label="Timesheet files"
              onChange={(e) => {
                if (e.currentTarget.files) addFiles(e.currentTarget.files);
                e.currentTarget.value = '';
              }}
            />
            <p className="xs muted">{FILE_HELP}</p>
          </div>
          {files.length > 0 ? (
            <ul className="pr-files" aria-label="Chosen files">
              {files.map((f, i) => (
                <li key={`${f.name}-${f.size}`}>
                  <span className="pr-file-name" title={f.name}>
                    {f.name}
                  </span>
                  <span className="xs muted">{sizeLabel(f.size)}</span>
                  <Button
                    size="sm"
                    tone="ghost"
                    aria-label={`Remove ${f.name}`}
                    disabled={busy !== null}
                    onClick={() => removeFile(i)}
                  >
                    ✕
                  </Button>
                </li>
              ))}
              <li className="xs muted">
                {files.length} of {MAX_FILES} files · {sizeLabel(total)}
              </li>
            </ul>
          ) : null}
        </div>

        <Textarea
          label="Notes (optional)"
          rows={2}
          maxLength={1000}
          value={notes}
          disabled={!canAct || busy !== null}
          onChange={(e) => setNotes(e.currentTarget.value)}
        />

        {errors.length > 0 ? (
          <Alert tone="coral">
            <ul className="pr-errors">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </Alert>
        ) : null}
        {busy ? (
          <p className="sm" role="status">
            {busy}
          </p>
        ) : null}

        <div className="row pr-actions">
          <Button type="submit" tone="primary" disabled={!canAct || busy !== null || !chosen || files.length === 0}>
            {busy ? 'Working…' : 'Upload & process'}
          </Button>
          {!canAct ? <span className="xs muted">Your login is read-only, so uploading is switched off.</span> : null}
        </div>
      </form>
    </Panel>
  );
}
