'use client';

import { useId, useState } from 'react';
import { Button, Note, Pill, Switch } from '@thc/ui';
import {
  BUFFER_RULE_LIMITS,
  type BufferRounding,
  type BufferSuggestionRule,
  bufferRuleProblem,
  formatAllocationPair,
  suggestBuffer,
} from '@thc/domain';
import { saveBufferSuggestion } from './actions';
import { Block, Feedback, SaveAction, useSave } from './SettingsScreen';

/** The two counts as typed, so a cleared box is refused rather than read as 0. */
interface Draft {
  enabled: boolean;
  per: string;
  rounding: BufferRounding;
  minimum: string;
}

const toDraft = (rule: BufferSuggestionRule): Draft => ({
  enabled: rule.enabled,
  per: String(rule.per),
  rounding: rule.rounding,
  minimum: String(rule.minimum),
});

const typed = (value: string): number => (value.trim() === '' ? Number.NaN : Number(value));

const fromDraft = (draft: Draft): BufferSuggestionRule => ({
  enabled: draft.enabled,
  per: typed(draft.per),
  rounding: draft.rounding,
  minimum: typed(draft.minimum),
});

/** A few headcounts and what the rule makes of them: "5 → 5 (+1)". */
export function bufferExamples(rule: BufferSuggestionRule): string | null {
  if (bufferRuleProblem({ ...rule, enabled: true }) !== null) return null;
  const on = { ...rule, enabled: true };
  return [4, 5, 7, 10, 20]
    .map(
      (headcount) =>
        `${headcount} → ${formatAllocationPair(headcount, suggestBuffer(headcount, on)!)}`,
    )
    .join(' · ');
}

/**
 * ADR-0181: "Suggested overs" — THC's one extra for every five staff, as
 * the buffer a new role section starts with in the Shift Builder. Every
 * part of the rule is here because two of its answers are still with the
 * client (under five: 0 or 1? seven: 1 or 2?).
 */
export function BufferSuggestionBlock({ rule }: { rule: BufferSuggestionRule }) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(rule));
  const { note, error, pending, run } = useSave();
  const id = useId();
  const next = fromDraft(draft);
  const dirty = JSON.stringify(next) !== JSON.stringify(rule);
  const examples = bufferExamples(next);
  const { perMin, perMax, minimumMin, minimumMax } = BUFFER_RULE_LIMITS;
  // Fields are marked only after a refused save, as in every other block.
  const perBad =
    Boolean(error) && !(Number.isInteger(next.per) && next.per >= perMin && next.per <= perMax);
  const minimumBad =
    Boolean(error) &&
    !(Number.isInteger(next.minimum) && next.minimum >= minimumMin && next.minimum <= minimumMax);

  return (
    <Block
      title="Suggested overs"
      sub="Overs are the extra staff booked on top of what the client asked for, to cover late arrivals and drop-outs."
      actions={<Pill tone={rule.enabled ? 'green' : 'neutral'}>{rule.enabled ? 'On' : 'Off'}</Pill>}
    >
      <Switch
        checked={draft.enabled}
        onChange={(enabled) => setDraft((current) => ({ ...current, enabled }))}
        label={
          draft.enabled
            ? 'On — new role sections start with the suggested buffer'
            : 'Off — new role sections start with no buffer'
        }
      />
      <div className="row wrap" role="group" aria-labelledby={`${id}-rule`}>
        <span id={`${id}-rule`} className="sr-only">
          Suggested overs rule
        </span>
        <span>One extra for every</span>
        <input
          className="input mono"
          style={{ width: '5.5em' }}
          type="number"
          min={perMin}
          max={perMax}
          step={1}
          aria-label="Staff for each extra"
          aria-invalid={perBad || undefined}
          value={draft.per}
          onChange={(event) => setDraft((current) => ({ ...current, per: event.target.value }))}
        />
        <span>staff, rounded</span>
        <select
          className="input"
          style={{ width: 'auto' }}
          aria-label="Rounding"
          value={draft.rounding}
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              rounding: event.target.value === 'up' ? 'up' : 'down',
            }))
          }
        >
          <option value="down">down</option>
          <option value="up">up</option>
        </select>
        <span>, at least</span>
        <input
          className="input mono"
          style={{ width: '5.5em' }}
          type="number"
          min={minimumMin}
          max={minimumMax}
          step={1}
          aria-label="At least this many extras per role"
          aria-invalid={minimumBad || undefined}
          value={draft.minimum}
          onChange={(event) => setDraft((current) => ({ ...current, minimum: event.target.value }))}
        />
        <span>per role.</span>
      </div>
      <p className="sm muted">The Shift Builder fills this in; you can always change it.</p>
      {draft.enabled && examples ? <p className="sm mono muted">{examples}</p> : null}
      <Note>
        Applies to role sections added from now on. A buffer already saved on an event is never
        changed by it, and a duplicated event keeps the buffers it copies.
      </Note>
      <Feedback note={note} error={error} />
      <SaveAction id="buffer-suggestion" title="Suggested overs" dirty={dirty}>
        <Button
          tone="primary"
          disabled={pending || !dirty}
          onClick={() => run(() => saveBufferSuggestion(next))}
        >
          {pending ? 'Saving…' : 'Save suggested overs'}
        </Button>
      </SaveAction>
    </Block>
  );
}
