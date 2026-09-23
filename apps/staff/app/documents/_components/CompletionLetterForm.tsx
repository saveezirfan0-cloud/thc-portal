'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Input, OptionRow } from '@thc/ui';
import { COMPLETION_EVIDENCE_FORMS, COMPLETION_EVIDENCE_FORM_LABELS } from '@thc/domain';
import type { CompletionEvidenceForm } from '@thc/domain';
import { finishCompletionLetter } from '../actions';
import { EVIDENCE_ACCEPT, uploadEvidence } from './upload';

/**
 * The Official University Completion Letter — requirement §2.1, §4.5.
 *
 *   · one document, three acceptable forms (the official letter, a final /
 *     completers transcript showing the award or completion date, or an
 *     official university email confirming completion);
 *   · PDF, JPG or PNG, up to 10 MB;
 *   · the worker enters the course completion date the document states;
 *   · it lands pending and changes NOTHING until the office approves it
 *     (acceptance criterion 2) — and the copy says so before the button,
 *     because a worker who thinks uploading lifted their limit will accept
 *     a 30-hour week and be refused.
 */
export function CompletionLetterForm({ currentLimit }: { currentLimit: string }) {
  const router = useRouter();
  const [form, setForm] = useState<CompletionEvidenceForm | null>(null);
  const [date, setDate] = useState('');
  const [institution, setInstitution] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const ready = form !== null && /^\d{4}-\d{2}-\d{2}$/.test(date) && file !== null;

  function submit() {
    if (!form || !file) return;
    setError(null);
    start(async () => {
      const up = await uploadEvidence({ kind: 'completion-letter' }, file);
      if (!up.ok) {
        setError(up.message);
        return;
      }
      const result = await finishCompletionLetter({
        path: up.path,
        completionDate: date,
        form,
        institution,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.replace('/documents?sent=completion');
      router.refresh();
    });
  }

  return (
    <div className="docs-form">
      <div className="field">
        <span className="label">What kind of document is it?</span>
        <div role="radiogroup" className="mlist">
          {COMPLETION_EVIDENCE_FORMS.map((value) => (
            <OptionRow
              key={value}
              title={COMPLETION_EVIDENCE_FORM_LABELS[value]}
              selected={form === value}
              onSelect={() => setForm(value)}
            />
          ))}
        </div>
      </div>

      <Input
        label="Course completion date shown on the document"
        type="date"
        value={date}
        onChange={(event) => setDate(event.target.value)}
        hint="The date your course ends or ended — not today’s date, and not your graduation ceremony."
      />

      <Input
        label="University · optional"
        value={institution}
        onChange={(event) => setInstitution(event.target.value)}
        placeholder="e.g. University of Westminster"
      />

      <label className="file-pick field">
        <span className="label">The document · PDF, JPG or PNG, up to 10 MB</span>
        <input
          type="file"
          accept={EVIDENCE_ACCEPT}
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
      </label>

      <div className="notice">
        <div className="strong">Nothing changes until it’s approved</div>
        <div>
          Uploading does <b>not</b> change your weekly limit. You stay on {currentLimit} until the
          office has checked the document and approved it.
        </div>
        <div>
          Once approved, your limit becomes 48 h/week from the course completion date on the
          document — not from the day you upload it, so a letter issued before your final exams
          lifts nothing until that date. It never runs past your visa.
        </div>
        <div className="xs muted">
          If it can’t be accepted, you’ll get a notification with the reason and can upload again.
        </div>
      </div>

      {error ? <Alert tone="coral">{error}</Alert> : null}

      <Button tone="primary" size="lg" block disabled={!ready || pending} onClick={submit}>
        {pending ? 'Uploading…' : 'Send for review'}
      </Button>
    </div>
  );
}
