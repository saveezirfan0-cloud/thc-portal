'use client';

import { useState } from 'react';
import { Button, Input, Note, Pill, Select, Switch, TimeField, useTimeFormat } from '@thc/ui';
import {
  BUFFER_RULE_LIMITS,
  type BufferRounding,
  type BufferSuggestionRule,
  bufferRuleProblem,
  bufferRuleSentence,
  clockLabel,
  formatAllocationPair,
  suggestBuffer,
  ukInputLabel,
} from '@thc/domain';
import { saveBufferSuggestion } from './actions';
import { Block, Feedback, SaveAction, useSave } from './blocks';

/** The counts as typed, so a cleared box is refused rather than read as 0. */
interface Draft {
  enabled: boolean;
  per: string;
  rounding: BufferRounding;
  from_headcount: string;
  /** "HH:MM", or '' for no early-start rule. */
  early_start_before: string;
  early_start_extra: string;
}

const toDraft = (rule: BufferSuggestionRule): Draft => ({
  enabled: rule.enabled,
  per: String(rule.per),
  rounding: rule.rounding,
  from_headcount: String(rule.from_headcount),
  early_start_before: rule.early_start_before ?? '',
  early_start_extra: String(rule.early_start_extra),
});

const EARLY_TIME_PROBLEM = 'The early start is a time like 08:00, or blank for none.';

const typed = (value: string): number => (value.trim() === '' ? Number.NaN : Number(value));

const fromDraft = (draft: Draft): BufferSuggestionRule => ({
  enabled: draft.enabled,
  per: typed(draft.per),
  rounding: draft.rounding,
  from_headcount: typed(draft.from_headcount),
  early_start_before: draft.early_start_before === '' ? null : draft.early_start_before,
  early_start_extra: typed(draft.early_start_extra),
});

/**
 * A few role sizes and what the rule makes of them, in the "6 (+1)" form:
 * "4 → 4 (+0) · 4 before 08:00 → 4 (+1) · 5 → 5 (+1) · …". Null while the
 * rule cannot be read.
 */
export function bufferExamples(
  rule: BufferSuggestionRule,
  clock: (hhmm: string) => string = (hhmm) => hhmm,
): string | null {
  const on = { ...rule, enabled: true };
  if (bufferRuleProblem(on) !== null) return null;
  // A start that is never early under this rule, and one that is.
  const late = on.early_start_before ?? '12:00';
  const pair = (headcount: number, start: string) =>
    formatAllocationPair(headcount, suggestBuffer(headcount, on, start)!);
  const lines = [4, 5, 6, 7, 10, 11].map((n) => `${n} → ${pair(n, late)}`);
  if (on.early_start_before !== null && on.early_start_before > '00:00' && 4 < on.from_headcount) {
    lines.splice(1, 0, `4 before ${clock(on.early_start_before)} → ${pair(4, '00:00')}`);
  }
  return lines.join(' · ');
}

/**
 * ADR-0181: "Suggested overs" — the buffer a new role section starts with in
 * the Shift Builder. One extra for every five staff, rounded up; smaller
 * roles none, unless they start early. Every part is editable, so the
 * office can tune it without a release.
 */
export function BufferSuggestionBlock({ rule }: { rule: BufferSuggestionRule }) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(rule));
  const [timeInvalid, setTimeInvalid] = useState(false);
  const { note, error, pending, run } = useSave();
  const format = useTimeFormat();
  const clock = (hhmm: string) => clockLabel(hhmm, format);
  const next = fromDraft(draft);
  const readable = bufferRuleProblem(next) === null && !timeInvalid;
  const dirty = JSON.stringify(next) !== JSON.stringify(rule) || timeInvalid;
  const examples = bufferExamples(next, clock);
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  const { perMin, perMax, fromMin, fromMax, extraMin, extraMax } = BUFFER_RULE_LIMITS;
  // Fields are marked only after a refused save, as in every other block.
  const bad = (value: number, min: number, max: number) =>
    error && !(Number.isInteger(value) && value >= min && value <= max)
      ? 'A whole number from ' + min + ' to ' + max + '.'
      : undefined;

  return (
    <Block
      title="Suggested overs"
      sub="Overs are the extra staff booked on top of what the client asked for, to cover late arrivals and drop-outs."
      actions={<Pill tone={rule.enabled ? 'green' : 'neutral'}>{rule.enabled ? 'On' : 'Off'}</Pill>}
    >
      <Switch
        checked={draft.enabled}
        onChange={(enabled) => set({ enabled })}
        label={
          draft.enabled
            ? 'On — new role sections start with the suggested buffer'
            : 'Off — new role sections start with no buffer'
        }
      />
      <div className="settings-overs">
        <Input
          label="One extra for every (staff)"
          type="number"
          min={perMin}
          max={perMax}
          step={1}
          mono
          value={draft.per}
          error={bad(next.per, perMin, perMax)}
          onChange={(event) => set({ per: event.target.value })}
        />
        <Select
          label="Rounded"
          value={draft.rounding}
          onChange={(event) => set({ rounding: event.target.value === 'down' ? 'down' : 'up' })}
        >
          <option value="up">up</option>
          <option value="down">down</option>
        </Select>
        <Input
          label="Roles under (staff) get none"
          type="number"
          min={fromMin}
          max={fromMax}
          step={1}
          mono
          value={draft.from_headcount}
          error={bad(next.from_headcount, fromMin, fromMax)}
          onChange={(event) => set({ from_headcount: event.target.value })}
        />
        <TimeField
          label={ukInputLabel('Unless they start before')}
          value={draft.early_start_before}
          hint="Blank: no extra for an early start."
          error={error && timeInvalid ? EARLY_TIME_PROBLEM : undefined}
          onInvalidChange={setTimeInvalid}
          onChange={(early_start_before) => set({ early_start_before })}
        />
        <Input
          label="Then this many extra"
          type="number"
          min={extraMin}
          max={extraMax}
          step={1}
          mono
          value={draft.early_start_extra}
          error={bad(next.early_start_extra, extraMin, extraMax)}
          onChange={(event) => set({ early_start_extra: event.target.value })}
        />
      </div>
      {readable ? <p className="settings-overs-rule">{bufferRuleSentence(next, clock)}</p> : null}
      <p className="sm muted">The Shift Builder fills this in; you can always change it.</p>
      {draft.enabled && readable && examples ? <p className="sm mono muted">{examples}</p> : null}
      <Note>
        The start that counts is each role&rsquo;s own start time. Applies to role sections added
        from now on: a buffer already saved on an event is never changed by it, and a duplicated
        event keeps the buffers it copies.
      </Note>
      <Feedback note={note} error={error} />
      <SaveAction id="buffer-suggestion" title="Suggested overs" dirty={dirty}>
        <Button
          tone="primary"
          disabled={pending || !dirty}
          onClick={() =>
            run(async () =>
              // A half-typed time reads as blank; never save it as "no early start".
              timeInvalid ? { ok: false, message: EARLY_TIME_PROBLEM } : saveBufferSuggestion(next),
            )
          }
        >
          {pending ? 'Saving…' : 'Save suggested overs'}
        </Button>
      </SaveAction>
    </Block>
  );
}
