'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Input, Modal, Note, Select } from '@thc/ui';
import { RTW_LABEL } from '../staff';
import { changeRtwBranch } from './actions';

const BRANCHES = [
  'uk_irish',
  'eu_settled',
  'work_visa',
  'international_student',
  'dependant_other',
] as const;

/**
 * "Change" on the Right to Work row of the Overview card (§2.5, completion
 * letter requirement §7). The branch is the worker's own pick in the wizard;
 * when gov.uk's report shows it was the wrong one — settled status chosen as
 * "Dependant / other" is the case that blocks Verify, because every branch but
 * EU settled always has an end date — the office corrects it here.
 *
 * Owners and managers (`officeCan(role, 'identity')`): it is a statement about
 * a person's immigration status. The change is audited as `rtw.changed` and
 * leaves the 48-hour opt-out alone. It does NOT verify anything: the share
 * code report still goes through Verify (or the automatic check) afterwards.
 */
export function RtwBranchChange({
  staffId,
  name,
  branch,
  until,
  allowed,
}: {
  staffId: string;
  /** For the dialog's title. */
  name: string;
  branch: string | null;
  /** `yyyy-mm-dd` on file, if any. */
  until: string | null;
  /** `officeCan(role, 'identity')`, false on a removed profile. */
  allowed: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [next, setNext] = useState<string>(branch ?? '');
  const [date, setDate] = useState(until ?? '');
  const [failure, setFailure] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!allowed) return null;

  const openDialog = () => {
    setNext(branch ?? '');
    setDate(until ?? '');
    setFailure(null);
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    setFailure(null);
  };

  const unchanged = next === (branch ?? '') && date === (until ?? '');
  const settled = next === 'eu_settled';

  const save = () => {
    setFailure(null);
    start(async () => {
      const result = await changeRtwBranch(
        staffId,
        next,
        next === 'uk_irish' ? null : date || null,
      );
      if (!result.ok) {
        setFailure(result.message);
        return;
      }
      setSaved(`Branch changed to ${RTW_LABEL[next] ?? next}.`);
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <>
      <Button size="sm" tone="ghost" disabled={pending} onClick={openDialog}>
        Change
      </Button>
      {saved ? (
        <>
          <br />
          <span className="green sm">{saved}</span>
        </>
      ) : null}

      <Modal
        open={open}
        title={`Change right-to-work branch — ${name}`}
        onClose={close}
        footer={
          <>
            <Button tone="ghost" onClick={close}>
              Cancel
            </Button>
            <Button tone="primary" disabled={pending || !next || unchanged} onClick={save}>
              {pending ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      >
        <div className="stack">
          {failure ? <Alert tone="coral">{failure}</Alert> : null}
          <Select
            label="Right-to-work branch"
            value={next}
            onChange={(event) => setNext(event.target.value)}
          >
            {branch ? null : <option value="">Choose…</option>}
            {BRANCHES.map((key) => (
              <option key={key} value={key}>
                {RTW_LABEL[key]}
              </option>
            ))}
          </Select>
          {next === 'uk_irish' ? null : (
            <Input
              type="date"
              label="Right to work until"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              hint={
                settled
                  ? 'Leave blank for settled status (no time limit). Pre-settled status has an end date: enter it.'
                  : 'Leave blank to keep none on file — it is then set when the share code report is verified.'
              }
            />
          )}
          {settled ? (
            <Note>
              Choose this for someone whose gov.uk record says there is no limit on how long they
              can stay (settled status, or indefinite leave). Then verify the share code report with
              “no time limit”, or run the automatic check again.
            </Note>
          ) : null}
          <Note>
            This only corrects the branch — it does not verify anything. It is recorded in the
            activity log under your name, and the 48-hour opt-out is not touched.
          </Note>
        </div>
      </Modal>
    </>
  );
}
