'use client';

import { useState, useTransition } from 'react';
import { Alert, Button, Input, Modal, Pill, Textarea } from '@thc/ui';
import { createRole, updateRole } from './actions';
import {
  finalPence,
  formatAddition,
  formatPounds,
  holidayPence,
  parseRate,
  poundsInput,
  toPence,
} from './money';
import type { Role } from './types';

export interface RoleModalProps {
  /** Null creates; a role edits it, pre-filled. */
  role: Role | null;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Create / edit a role (§9.8) — a modal, never inline, as the scope says.
 *
 * Three fields only: name, base rate and the internal description. There is
 * deliberately no dress code and no charge rate: both are client-specific
 * and live on that client's rate card (§9.7). The calculation strip under
 * the rate is the §9.8 table's three columns, moving as the rate is typed,
 * so the manager sees what the change does to the final rate before saving.
 */
export function RoleModal({ role, onClose, onSaved }: RoleModalProps) {
  const editing = role !== null;

  const [name, setName] = useState(role?.name ?? '');
  const [rate, setRate] = useState(role ? poundsInput(toPence(role.pay_rate)) : '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  const pence = parseRate(rate);
  const rateIsBlank = rate.trim() === '';
  const ready = name.trim().length > 0 && pence !== null;

  const wasPence = role ? toPence(role.pay_rate) : null;
  const changed = wasPence !== null && pence !== null && pence !== wasPence;

  const save = () => {
    if (pence === null) return;
    setError(null);
    startSaving(async () => {
      const draft = { name, pay_rate_pence: pence, description };
      const result = role ? await updateRole(role.id, draft) : await createRole(draft);
      if (result.ok) onSaved();
      else setError(result.message);
    });
  };

  return (
    <Modal
      open
      title={editing ? 'Edit role' : 'New role'}
      onClose={onClose}
      footer={
        <>
          <Button tone="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button tone="primary" onClick={save} disabled={!ready || saving}>
            {saving ? 'Saving…' : editing ? 'Save role' : 'Create role'}
          </Button>
        </>
      }
    >
      {editing ? (
        <div className="row">
          <Pill>{role.name}</Pill>
        </div>
      ) : null}

      {error ? <Alert tone="coral">{error}</Alert> : null}

      <Input
        label={
          <>
            Role name <span className="coral">*</span>
          </>
        }
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="e.g. Event Supervisor"
        required
      />

      <div className="field">
        <label className="label" htmlFor="role-rate">
          Staff pay rate (base £/h) <span className="coral">*</span>
        </label>
        <div className="input-row rate-row">
          <span className="addon l">£</span>
          <input
            id="role-rate"
            className="input mono"
            inputMode="decimal"
            value={rate}
            onChange={(event) => setRate(event.target.value)}
            placeholder="0.00"
            aria-describedby="role-rate-hint"
          />
          <span className="addon">/h</span>
        </div>
        <span className="hint" id="role-rate-hint">
          {pence === null && !rateIsBlank
            ? 'Enter a rate to the penny, e.g. 14.50.'
            : changed && wasPence !== null
              ? `Was ${formatPounds(wasPence)}. Applies to events built from now on; the holiday element and the final rate recalculate automatically.`
              : 'The base rate. Holiday and the final rate are calculated from it.'}
        </span>
      </div>

      {/* The §9.8 table's three columns, live. */}
      <div className="calc" aria-live="polite">
        <div className="c">
          <span className="label">Base</span>
          <span className="v">{pence === null ? '—' : formatPounds(pence)}</span>
        </div>
        <div className="c">
          <span className="label">Holiday +12.07%</span>
          <span className="v muted">
            {pence === null ? '—' : formatAddition(holidayPence(pence))}
          </span>
        </div>
        <div className="c">
          <span className="label">Final rate</span>
          <span className="v cyan">{pence === null ? '—' : formatPounds(finalPence(pence))}</span>
        </div>
      </div>

      <Textarea
        label={
          <>
            Description <span className="muted">· internal, optional</span>
          </>
        }
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        rows={3}
        hint="Never shown to the client."
      />

      <div className="note">
        No dress code here and no charge rate — both are client-specific and live on that
        client&rsquo;s rate card.
        {editing && changed && role.rate_card_count > 0 ? (
          <>
            {' '}
            This role is on <b>{role.rate_card_count}</b>{' '}
            {role.rate_card_count === 1 ? 'rate card' : 'rate cards'}; their margin moves unless
            those charge rates are updated too.
          </>
        ) : null}
      </div>
    </Modal>
  );
}
