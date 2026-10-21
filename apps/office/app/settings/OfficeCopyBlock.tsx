'use client';

import { useState } from 'react';
import { Button, Textarea } from '@thc/ui';
import { Block, Feedback, SaveAction, useSave } from './SettingsScreen';
import { OFFICE_COPY_MAX, officeCopyText, splitAddresses, validateOfficeCopy } from './officeCopy';
import { saveDocumentOfficeCopy } from './officeCopyActions';

/**
 * ADR-0179: who gets a hidden copy (BCC) of every Allocation Timesheet and
 * Completed Timesheet sent to a client. One box, up to five addresses; empty
 * is off. Saved like every block here, and audited by the database.
 */
export function OfficeCopyBlock({ emails }: { emails: string[] }) {
  const [draft, setDraft] = useState(() => officeCopyText(emails));
  const { note, error, pending, run } = useSave();
  const typed = splitAddresses(draft);
  const dirty = typed.join('\n') !== emails.join('\n');
  const invalid = validateOfficeCopy(draft);

  return (
    <Block
      title="Office copy of timesheets"
      sub="These addresses get a hidden copy (BCC) of every Allocation Timesheet and Completed Timesheet sent to a client — automatic sends, updates and manual sends. Clients never see them."
    >
      <Textarea
        label={`Addresses · up to ${OFFICE_COPY_MAX}`}
        rows={3}
        value={draft}
        placeholder="sam@thehospitalitycompany.co.uk"
        spellCheck={false}
        autoCapitalize="off"
        hint={
          emails.length === 0
            ? 'One per line. Leave empty and no copy is sent.'
            : 'One per line. Clear the box to stop the copy.'
        }
        error={(error && !invalid.ok && invalid.message) || undefined}
        onChange={(event) => setDraft(event.target.value)}
      />
      <Feedback note={note} error={error} />
      <SaveAction id="office-copy" title="Office copy of timesheets" dirty={dirty}>
        <Button
          tone="primary"
          disabled={pending || !dirty}
          onClick={() =>
            run(async () => {
              const saved = await saveDocumentOfficeCopy(draft);
              if (saved.ok) setDraft(officeCopyText(typed));
              return saved;
            })
          }
        >
          {pending ? 'Saving…' : 'Save office copy'}
        </Button>
      </SaveAction>
    </Block>
  );
}
