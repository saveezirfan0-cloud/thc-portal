'use client';

import { useState, useTransition } from 'react';
import { Alert, Button, Input, Modal, Note, Panel } from '@thc/ui';
import {
  EMERGENCY_CONTACT_NAME_MAX,
  EMERGENCY_CONTACT_RELATIONSHIP_MAX,
  EMERGENCY_RELATIONSHIP_SUGGESTIONS,
  validateEmergencyContact,
} from '@thc/domain';
import type { EmergencyContactField } from '@thc/domain';
import { contactUpdatedLine, formatPhone } from './additions';
import { clearEmergencyContact, saveEmergencyContact } from './actions';
import type { EmergencyContact } from './types';

/**
 * The Emergency contact card on the Overview tab (ADR-0044),
 * `wireframes/backoffice/change-requests.html` → "Overview cards".
 *
 * Office-only worker personal data. It is shown here and — in Phase 2 — on
 * the /checkin worker detail, and nowhere a client can reach: not the
 * Client Portal, not a client_* view, not the allocation sheet or the
 * timesheet (§11.3 unchanged). Edit and Clear are audited in the database.
 * Empty reads "Not provided": the contact is optional (Q11).
 */
export function EmergencyContactCard({
  staffId,
  contact,
  problem,
  editable,
}: {
  staffId: string;
  contact: EmergencyContact | null;
  problem?: string | null;
  /** False on a removed profile: §1.7 deleted it and nothing puts it back. */
  editable: boolean;
}) {
  const [dialog, setDialog] = useState<'edit' | 'clear' | null>(null);
  const [name, setName] = useState('');
  const [relationship, setRelationship] = useState('');
  const [phone, setPhone] = useState('');
  const [errors, setErrors] = useState<Partial<Record<EmergencyContactField, string>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const openEdit = () => {
    setName(contact?.name ?? '');
    setRelationship(contact?.relationship ?? '');
    setPhone(contact?.phone ?? '');
    setErrors({});
    setFailure(null);
    setDialog('edit');
  };
  const close = () => {
    setDialog(null);
    setFailure(null);
  };

  const save = () => {
    const checked = validateEmergencyContact({ name, relationship, phone });
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    setFailure(null);
    start(async () => {
      const result = await saveEmergencyContact(staffId, checked.value);
      if (result.ok) close();
      else setFailure(result.message);
    });
  };

  const clear = () => {
    setFailure(null);
    start(async () => {
      const result = await clearEmergencyContact(staffId);
      if (result.ok) close();
      else setFailure(result.message);
    });
  };

  return (
    <Panel
      title="Emergency contact"
      actions={
        <>
          <span className="muted sm">office only · never on a client document</span>
          {editable ? (
            <>
              <Button size="sm" tone="ghost" disabled={pending} onClick={openEdit}>
                {contact ? 'Edit' : 'Add'}
              </Button>
              {contact ? (
                <Button
                  size="sm"
                  tone="ghost"
                  disabled={pending}
                  onClick={() => {
                    setFailure(null);
                    setDialog('clear');
                  }}
                >
                  Clear
                </Button>
              ) : null}
            </>
          ) : null}
        </>
      }
    >
      {problem ? (
        <Alert tone="coral">The emergency contact could not be read: {problem}</Alert>
      ) : contact ? (
        <div className="kv">
          <span className="k">Name</span>
          <span>{contact.name}</span>
          <span className="k">Relationship</span>
          <span>{contact.relationship}</span>
          <span className="k">Phone</span>
          <span>
            <a href={`tel:${contact.phone}`} className="mono">
              {formatPhone(contact.phone)}
            </a>
          </span>
          <span className="k">Updated</span>
          <span className="mono sm muted">{contactUpdatedLine(contact)}</span>
        </div>
      ) : (
        <Note>Not provided. It is optional — the worker adds it in the app (Profile details).</Note>
      )}

      <Modal
        open={dialog === 'edit'}
        title={contact ? 'Edit emergency contact' : 'Add emergency contact'}
        onClose={close}
        footer={
          <>
            <Button tone="ghost" onClick={close}>
              Cancel
            </Button>
            <Button tone="primary" disabled={pending} onClick={save}>
              Save
            </Button>
          </>
        }
      >
        <div className="stack">
          {failure ? <Alert tone="coral">{failure}</Alert> : null}
          <Input
            label="Name"
            value={name}
            maxLength={EMERGENCY_CONTACT_NAME_MAX}
            error={errors.name}
            onChange={(event) => setName(event.target.value)}
          />
          <Input
            label="Relationship"
            value={relationship}
            maxLength={EMERGENCY_CONTACT_RELATIONSHIP_MAX}
            list="emergency-relationships"
            error={errors.relationship}
            onChange={(event) => setRelationship(event.target.value)}
          />
          <datalist id="emergency-relationships">
            {EMERGENCY_RELATIONSHIP_SUGGESTIONS.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
          <Input
            label="Phone"
            type="tel"
            inputMode="tel"
            value={phone}
            placeholder="+44 7700 900123"
            hint="With the country code, as on /apply."
            error={errors.phone}
            onChange={(event) => setPhone(event.target.value)}
          />
          <span className="muted xs">
            Saved to the audit log with your name. The worker sees the corrected contact in the app.
          </span>
        </div>
      </Modal>

      <Modal
        open={dialog === 'clear'}
        title="Clear the emergency contact?"
        onClose={close}
        footer={
          <>
            <Button tone="ghost" onClick={close}>
              Cancel
            </Button>
            <Button tone="danger" solid disabled={pending} onClick={clear}>
              Clear
            </Button>
          </>
        }
      >
        {failure ? <Alert tone="coral">{failure}</Alert> : null}
        <p className="sm">
          The profile will read &ldquo;Not provided&rdquo; until the worker adds one again in the
          app. The clear is written to the audit log.
        </p>
      </Modal>
    </Panel>
  );
}
