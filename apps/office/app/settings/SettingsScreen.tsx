'use client';

import { createContext, useCallback, useContext, useEffect, useState, useTransition } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Alert, Button, Input, Note, Panel, Pill, SaveBar, Select } from '@thc/ui';
import { OfficeShell } from '../_components/OfficeShell';
import {
  saveAutoAssignNumbers,
  saveRotaGuardMode,
  saveSenders,
  saveVenueRadius,
  saveWeights,
  saveWilloMap,
  saveWilloReviewUrlTemplate,
} from './actions';
import { MAX_RADIUS_M, MIN_RADIUS_M, WEIGHT_FIELDS, weightTotal } from './validate';
import { KANBAN_STAGES } from './types';
import type {
  ActionResult,
  RotaGuardMode,
  ScoringWeights,
  SettingsData,
  Senders,
  WilloStageMap,
} from './types';
import './settings.css';

/**
 * /settings — what the scope called Django Admin (§6, §2.4, §9.11, §9.12).
 *
 * Four blocks, one per thing THC was promised it could change without a
 * release, each saved on its own so a typo in an email address cannot
 * block a change to a scoring weight.
 *
 * This screen has no wireframe (docs/08 says "simple form"), so it borrows
 * the Back Office's existing furniture rather than inventing a style: the
 * `Panel` blocks of /roles, the same field components, the same
 * inline-alert-per-block feedback.
 */
export function SettingsScreen({ data }: { data: SettingsData }) {
  // The save bar (packages/ui SaveBar). A block with unsaved edits moves its
  // own Save button into the bar at the bottom of the screen, so the action
  // is in reach wherever the manager has scrolled to; a clean block keeps it
  // in place. Each button keeps its label, its disabled rule and its action.
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const [dirty, setDirty] = useState<Readonly<Record<string, string>>>({});
  const mark = useCallback((id: string, title: string, isDirty: boolean) => {
    setDirty((current) => {
      if (isDirty === id in current) return current;
      const next = { ...current };
      if (isDirty) next[id] = title;
      else delete next[id];
      return next;
    });
  }, []);
  const titles = Object.values(dirty);

  return (
    <OfficeShell
      activeHref="/settings"
      title="System settings"
      crumbs={<>Values THC can change without a release · §6 · §2.4 · §9.11 · §9.12</>}
      timezone="All times UK (Europe/London)"
    >
      {data.problem ? <Alert tone="coral">{data.problem}</Alert> : null}

      <SaveSlot.Provider value={{ slot, mark }}>
        <div className="settings-grid">
          <WeightsBlock weights={data.weights} />
          <AutoAssignBlock
            gapMinutes={data.bookedElsewhereGapMinutes}
            escalationMiles={data.escalationRadiusMiles}
          />
          <RotaGuardBlock mode={data.rotaGuardMode} />
          <WilloBlock map={data.willo} reviewUrlTemplate={data.willoReviewUrlTemplate} />
          <SendersBlock senders={data.senders} recipients={data.recipients} />
          <RadiiBlock types={data.venueTypes} />
        </div>

        <SaveBar
          label="Unsaved settings"
          dirty
          hint={titles.join(' · ')}
          className={titles.length === 0 ? 'hide' : undefined}
        >
          <div className="settings-savebar-slot" ref={setSlot} />
        </SaveBar>
      </SaveSlot.Provider>
    </OfficeShell>
  );
}

const SaveSlot = createContext<{
  slot: HTMLElement | null;
  mark: (id: string, title: string, dirty: boolean) => void;
} | null>(null);

/**
 * Where a block's Save button is drawn: in the block while it is clean, in
 * the page's save bar while it has unsaved edits. The button is the same
 * element either way — only its place on the screen changes.
 */
function SaveAction({
  id,
  title,
  dirty,
  children,
}: {
  id: string;
  title: string;
  dirty: boolean;
  children: ReactNode;
}) {
  const bar = useContext(SaveSlot);
  const mark = bar?.mark;
  useEffect(() => {
    mark?.(id, title, dirty);
    return () => mark?.(id, title, false);
  }, [mark, id, title, dirty]);
  if (dirty && bar?.slot) return createPortal(children, bar.slot);
  return <>{children}</>;
}

/** One block's save button, its pending state and its one line of feedback. */
function useSave() {
  const router = useRouter();
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = (action: () => Promise<ActionResult>, success = 'Saved.') => {
    setNote(null);
    setError(null);
    start(async () => {
      const result = await action();
      if (result.ok) {
        setNote(success);
        router.refresh();
      } else {
        setError(result.message);
      }
    });
  };

  return { note, error, pending, run };
}

/**
 * `Panel` has a title and an actions slot but no sub-line, so the one-line
 * statement of WHICH section of the scope each block implements is rendered
 * as the first thing in the body. Every block here needs it: the values are
 * unrecognisable without the rule behind them.
 */
function Block({
  title,
  sub,
  actions,
  children,
}: {
  title: ReactNode;
  sub: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Panel title={title} {...(actions ? { actions } : {})}>
      <p className="sm muted">{sub}</p>
      {children}
    </Panel>
  );
}

/** Plain settings values (numbers, strings, flat records) compared by content. */
function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function Feedback({ note, error }: { note: string | null; error: string | null }) {
  if (error) return <Alert tone="coral">{error}</Alert>;
  if (note) return <Alert tone="green">{note}</Alert>;
  return null;
}

/**
 * §6's five scoring weights.
 *
 * The running total is shown next to the heading because it is the only
 * thing on this block that can be wrong in a way nothing else reveals: a
 * set summing to 0.9 ranks the pool identically and caps every score at
 * 90. The save refuses anything that is not 1.00.
 */
function WeightsBlock({ weights }: { weights: ScoringWeights }) {
  const [draft, setDraft] = useState<ScoringWeights>(weights);
  const { note, error, pending, run } = useSave();
  const total = weightTotal(draft);
  const balanced = Math.abs(total - 1) < 0.0005;

  return (
    <Block
      title="Auto-assign scoring weights"
      sub="§6. Read on every auto-assign round — a change here takes effect on the next hourly round, with no deployment."
      actions={<Pill tone={balanced ? 'green' : 'coral'}>Total {total.toFixed(2)}</Pill>}
    >
      {WEIGHT_FIELDS.map((field) => (
        <Input
          key={field.key}
          label={field.label}
          type="number"
          step="0.01"
          min="0"
          max="1"
          mono
          value={String(draft[field.key])}
          hint={field.hint}
          onChange={(event) => setDraft({ ...draft, [field.key]: Number(event.target.value) })}
        />
      ))}
      <Note>
        Client qualification is not a weight and never becomes one: it is an ORDERING (RULE-17,
        §3.4). Qualified workers are scored and exhausted as Wave 1, then everyone else as Wave 2 —
        a weighting could be out-scored by proximity.
      </Note>
      <Feedback note={note} error={error} />
      <SaveAction id="weights" title="Scoring weights" dirty={!sameValue(draft, weights)}>
        <Button tone="primary" disabled={pending} onClick={() => run(() => saveWeights(draft))}>
          {pending ? 'Saving…' : 'Save weights'}
        </Button>
      </SaveAction>
    </Block>
  );
}

/** The two auto-assign numbers that are policy rather than maths (§3.4). */
function AutoAssignBlock({
  gapMinutes,
  escalationMiles,
}: {
  gapMinutes: number;
  escalationMiles: number;
}) {
  const [gap, setGap] = useState(gapMinutes);
  const [miles, setMiles] = useState(escalationMiles);
  const { note, error, pending, run } = useSave();

  return (
    <Block title="Auto-assign limits" sub="§3.4. Hard gates, not weights.">
      <Input
        label="Different-venue gap (minutes)"
        type="number"
        step="15"
        min="0"
        mono
        value={String(gap)}
        hint="A worker booked elsewhere is only offered a shift at a different venue with at least this much clear time between the two."
        onChange={(event) => setGap(Number(event.target.value))}
      />
      <Input
        label="Escalation radius (miles)"
        type="number"
        step="0.5"
        min="0"
        mono
        value={String(miles)}
        hint="How far out the escalation round looks when a role section is still short."
        onChange={(event) => setMiles(Number(event.target.value))}
      />
      <Feedback note={note} error={error} />
      <SaveAction
        id="limits"
        title="Auto-assign limits"
        dirty={gap !== gapMinutes || miles !== escalationMiles}
      >
        <Button
          tone="primary"
          disabled={pending}
          onClick={() => run(() => saveAutoAssignNumbers(gap, miles))}
        >
          {pending ? 'Saving…' : 'Save limits'}
        </Button>
      </SaveAction>
    </Block>
  );
}

/**
 * Completion letter requirement §4: warn or block when a shift would breach
 * the worker's weekly cap. The choice covers the Working Time 48 only; the
 * block says so, because a manager who picks "warn" must not come away
 * thinking a student can now be rostered past 20 hours.
 */
function RotaGuardBlock({ mode }: { mode: RotaGuardMode }) {
  const [draft, setDraft] = useState<RotaGuardMode>(mode);
  const { note, error, pending, run } = useSave();

  return (
    <Block
      title="Rota guard"
      sub="Completion letter requirement §4. What happens when a shift would take a worker over 48 hours in a week without a 48-hour opt-out."
    >
      <Select
        label="Over the 48-hour limit"
        value={draft}
        onChange={(event) => setDraft(event.target.value as RotaGuardMode)}
        hint="Warn lets the booking through and lists it on Compliance → Radar for the office."
      >
        <option value="block">Block the booking (default)</option>
        <option value="warn">Allow it and warn the office</option>
      </Select>
      <Note>
        Never configurable: a Student visa worker over 20 hours (10 below degree level) in term, and
        any shift past a worker’s right-to-work expiry, are always refused — by the database, on
        every booking path.
      </Note>
      <Feedback note={note} error={error} />
      <SaveAction id="rota" title="Rota guard" dirty={draft !== mode}>
        <Button
          tone="primary"
          disabled={pending || draft === mode}
          onClick={() => run(() => saveRotaGuardMode(draft))}
        >
          {pending ? 'Saving…' : 'Save rota guard'}
        </Button>
      </SaveAction>
    </Block>
  );
}

/** §2.4, Appendix B: Willo's stage names → the onboarding kanban's. */
function WilloBlock({
  map,
  reviewUrlTemplate,
}: {
  map: WilloStageMap;
  reviewUrlTemplate: string | null;
}) {
  const [draft, setDraft] = useState<WilloStageMap>(map);
  const [template, setTemplate] = useState(reviewUrlTemplate ?? '');
  const link = useSave();
  const { note, error, pending, run } = useSave();

  const rows: { key: keyof WilloStageMap; label: string; hint: string }[] = [
    {
      key: 'new_response',
      label: 'Willo: new response',
      hint: 'The candidate has finished the interview. Their card moves here on its own.',
    },
    {
      key: 'accepted',
      label: 'Willo: accepted',
      hint: 'The manager accepted inside Willo. The decision is not repeated here.',
    },
    {
      key: 'rejected',
      label: 'Willo: rejected',
      hint: 'A Willo rejection rejects automatically, so this must stay on Rejected.',
    },
  ];

  return (
    <Block
      title="Willo stage map"
      sub="§2.4. Editable so a change to the Willo pipeline does not need a release."
    >
      {rows.map((row) => (
        <Select
          key={row.key}
          label={row.label}
          hint={row.hint}
          value={draft[row.key]}
          onChange={(event) => setDraft({ ...draft, [row.key]: event.target.value })}
        >
          {KANBAN_STAGES.map((stage) => (
            <option key={stage} value={stage}>
              {stage.replace(/_/g, ' ')}
            </option>
          ))}
        </Select>
      ))}
      <Feedback note={note} error={error} />
      <SaveAction id="willo-map" title="Willo stage map" dirty={!sameValue(draft, map)}>
        <Button tone="primary" disabled={pending} onClick={() => run(() => saveWilloMap(draft))}>
          {pending ? 'Saving…' : 'Save stage map'}
        </Button>
      </SaveAction>
      <hr />
      {/* §2.4: "The candidate profile carries a direct 'Review interview on
          Willo' link" — the template is the one B1 input, entered here so
          connecting Willo needs no release. */}
      <Input
        label="Review interview on Willo — link template"
        type="url"
        value={template}
        placeholder="https://app.willo.video/…/{id}"
        hint="THC’s Willo account URL with {id} where the candidate id goes. Blank until Willo is connected: the cards then say “not connected”."
        onChange={(event) => setTemplate(event.target.value)}
      />
      <Feedback note={link.note} error={link.error} />
      <SaveAction id="willo-link" title="Willo link" dirty={template !== (reviewUrlTemplate ?? '')}>
        <Button
          tone="primary"
          disabled={link.pending}
          onClick={() => link.run(() => saveWilloReviewUrlTemplate(template))}
        >
          {link.pending ? 'Saving…' : 'Save Willo link'}
        </Button>
      </SaveAction>
    </Block>
  );
}

/** §9.12. Two addresses, and no others are used anywhere. */
function SendersBlock({
  senders,
  recipients,
}: {
  senders: Senders;
  recipients: SettingsData['recipients'];
}) {
  const [draft, setDraft] = useState<Senders>(senders);
  const { note, error, pending, run } = useSave();

  return (
    <Block title="Sender addresses" sub="§9.12. All outgoing mail comes from one of these two.">
      <Input
        label="Allocation sheets & timesheets"
        type="email"
        value={draft.timesheets}
        hint="§11.4's two documents, and nothing else."
        onChange={(event) => setDraft({ ...draft, timesheets: event.target.value })}
      />
      <Input
        label="Everything else"
        type="email"
        value={draft.admin}
        hint="Password resets, activation and invitation emails, finance reports, and the office alerts (E5–E9)."
        onChange={(event) => setDraft({ ...draft, admin: event.target.value })}
      />
      <Note>
        Replies to both go to a monitored THC mailbox — no-reply addresses are not used, and this
        form refuses one. The office and payroll notifications go to fixed §8 addresses, not a
        setting: E5 and E6 to <b>{recipients.e5e6.join(', ')}</b>; E7 to{' '}
        <b>{recipients.e7.join(', ')}</b>.
      </Note>
      <Feedback note={note} error={error} />
      <SaveAction id="senders" title="Sender addresses" dirty={!sameValue(draft, senders)}>
        <Button tone="primary" disabled={pending} onClick={() => run(() => saveSenders(draft))}>
          {pending ? 'Saving…' : 'Save senders'}
        </Button>
      </SaveAction>
    </Block>
  );
}

/**
 * §9.11's standard radii table, in the scope's own order — by radius,
 * except that "Other" is last whatever its radius is. That order is
 * reference data and lives on `venue_types.sort_order`, so this renders
 * what the database says rather than a list hard-coded here.
 */
function RadiiBlock({ types }: { types: SettingsData['venueTypes'] }) {
  return (
    <Block
      title="Standard geofence radii by venue type"
      sub="§9.11. These pre-fill the slider when a venue is created. Changing one never moves an existing venue or a scheduled event."
    >
      {types.length === 0 ? (
        <Note>No venue types are loaded.</Note>
      ) : (
        types.map((type) => <RadiusRow key={type.key} type={type} />)
      )}
    </Block>
  );
}

function RadiusRow({ type }: { type: SettingsData['venueTypes'][number] }) {
  const [metres, setMetres] = useState(type.default_radius_m);
  const { note, error, pending, run } = useSave();
  const dirty = metres !== type.default_radius_m;

  return (
    <div className="radius-row">
      <span className="radius-label">{type.label}</span>
      <input
        className="radius-slider"
        type="range"
        min={MIN_RADIUS_M}
        max={MAX_RADIUS_M}
        step={50}
        value={metres}
        aria-label={`${type.label} default radius in metres`}
        onChange={(event) => setMetres(Number(event.target.value))}
      />
      <span className="radius-value mono">{metres} m</span>
      <Button
        size="sm"
        tone={dirty ? 'primary' : 'ghost'}
        disabled={pending || !dirty}
        onClick={() => run(() => saveVenueRadius(type.key, type.label, metres))}
      >
        {pending ? 'Saving…' : 'Save'}
      </Button>
      <span className="radius-feedback">
        <Feedback note={note} error={error} />
      </span>
    </div>
  );
}
