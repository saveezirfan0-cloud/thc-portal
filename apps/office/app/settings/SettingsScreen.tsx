'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useTransition,
} from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import {
  Alert,
  Button,
  Input,
  Note,
  Panel,
  Pill,
  SaveBar,
  Select,
  Tabs,
  useUnsavedChanges,
} from '@thc/ui';
import { OfficeShell } from '../_components/OfficeShell';
import { NotificationsTab } from './NotificationsTab';
import {
  saveAutoAssignNumbers,
  saveClientPortalPhone,
  saveRotaGuardMode,
  saveSenders,
  saveVenueRadius,
  saveWeights,
  saveWilloMap,
  saveWilloInterviewUrl,
  saveWilloReviewUrlTemplate,
} from './actions';
import {
  CLIENT_PORTAL_PHONE_MAX,
  MAX_RADIUS_M,
  MIN_RADIUS_M,
  WEIGHT_FIELDS,
  validateClientPortalPhone,
  validateEscalationRadius,
  validateGap,
  validateWilloInterviewUrl,
  validateWilloReviewUrlTemplate,
  weightTotal,
} from './validate';
import { KANBAN_STAGES } from './types';
import type {
  ActionResult,
  RotaGuardMode,
  ScoringWeights,
  SettingsData,
  SettingsTab,
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
 *
 * Two tabs: General (the blocks above) and Notifications (ADR-0083), the
 * on/off switch for every notification the platform sends.
 */
export function SettingsScreen({
  data,
  tab: initialTab,
}: {
  data: SettingsData;
  tab: SettingsTab;
}) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const choose = (next: SettingsTab) => {
    setTab(next);
    // The address follows, so a refresh or a shared link lands on the same tab.
    window.history.replaceState(
      null,
      '',
      next === 'general' ? '/settings' : `/settings?tab=${next}`,
    );
  };

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
  // Release audit m1: a sidebar link, Cancel-by-navigation or closing the
  // tab with an unsaved block asks first. A radius row counts too, though
  // its Save stays beside its slider rather than in the bar.
  const guard = useUnsavedChanges(titles.length > 0, {
    message: `Unsaved: ${titles.join(', ')}. Leave and these changes are lost.`,
  });
  const barTitles = Object.entries(dirty)
    .filter(([id]) => !id.startsWith('radius:'))
    .map(([, title]) => title);

  return (
    <OfficeShell
      activeHref="/settings"
      title="System settings"
      crumbs={<>Values THC can change without a release</>}
      timezone="All times UK (Europe/London)"
    >
      {data.problem ? <Alert tone="coral">{data.problem}</Alert> : null}

      <Tabs<SettingsTab>
        aria-label="Settings section"
        value={tab}
        onChange={choose}
        options={[
          { value: 'general', label: 'General' },
          {
            value: 'notifications',
            label: 'Notifications',
            count: data.notificationsOff.length > 0 ? data.notificationsOff.length : undefined,
            alert: true,
          },
        ]}
      />

      {tab === 'notifications' ? <NotificationsTab off={data.notificationsOff} /> : null}

      <SaveSlot.Provider value={{ slot, mark }}>
        <div className="settings-grid" hidden={tab !== 'general'}>
          <WeightsBlock weights={data.weights} />
          <AutoAssignBlock
            gapMinutes={data.bookedElsewhereGapMinutes}
            escalationMiles={data.escalationRadiusMiles}
          />
          <RotaGuardBlock mode={data.rotaGuardMode} />
          <WilloBlock
            map={data.willo}
            reviewUrlTemplate={data.willoReviewUrlTemplate}
            interviewUrl={data.willoInterviewUrl}
          />
          <SendersBlock senders={data.senders} recipients={data.recipients} />
          <ClientPortalBlock phone={data.clientPortalPhone} />
          <RadiiBlock types={data.venueTypes} />
        </div>

        <SaveBar
          label="Unsaved settings"
          dirty
          hint={barTitles.join(' · ')}
          className={barTitles.length === 0 ? 'hide' : undefined}
        >
          <div className="settings-savebar-slot" ref={setSlot} />
        </SaveBar>
      </SaveSlot.Provider>
      {guard.dialog}
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
  useMarkDirty(id, title, dirty);
  if (dirty && bar?.slot) return createPortal(children, bar.slot);
  return <>{children}</>;
}

/** Tells the screen a block has unsaved edits (the save bar's list and the guard). */
function useMarkDirty(id: string, title: string, dirty: boolean) {
  const mark = useContext(SaveSlot)?.mark;
  useEffect(() => {
    mark?.(id, title, dirty);
    return () => mark?.(id, title, false);
  }, [mark, id, title, dirty]);
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
  className,
  children,
}: {
  title: ReactNode;
  sub: ReactNode;
  actions?: ReactNode;
  /** `settings-wide`: across every column (the radii table). */
  className?: string;
  children: ReactNode;
}) {
  return (
    <Panel title={title} {...(actions ? { actions } : {})} {...(className ? { className } : {})}>
      <p className="sm muted">{sub}</p>
      {children}
    </Panel>
  );
}

/** Plain settings values (numbers, strings, flat records) compared by content. */
function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * A block's one line of feedback. A refusal is brought into view (release
 * audit m1): the Save that failed may have been pressed in the save bar at
 * the bottom of the screen, far from the block — so the page scrolls to
 * the first field marked invalid in the block, or to this line, and puts
 * the keyboard there.
 */
function Feedback({ note, error }: { note: string | null; error: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!error) return;
    const line = ref.current;
    const field = line
      ?.closest('.panel, .radius-row')
      ?.querySelector<HTMLElement>('[aria-invalid="true"]');
    const target = field ?? line;
    target?.scrollIntoView({ block: 'center' });
    target?.focus({ preventScroll: true });
  }, [error]);
  if (!error && !note) return null;
  return (
    <div ref={ref} tabIndex={-1} className="settings-feedback">
      {error ? <Alert tone="coral">{error}</Alert> : <Alert tone="green">{note}</Alert>}
    </div>
  );
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
      sub="Read on every auto-assign round — a change here takes effect on the next hourly round, with no deployment."
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
        Client qualification is not a weight and never becomes one: it is an ORDERING. Qualified
        workers are scored and exhausted as Wave 1, then everyone else as Wave 2 — a weighting could
        be out-scored by proximity.
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
    <Block title="Auto-assign limits" sub="Hard gates, not weights.">
      <Input
        label="Different-venue gap (minutes)"
        type="number"
        step="15"
        min="0"
        mono
        value={String(gap)}
        hint="A worker booked elsewhere is only offered a shift at a different venue with at least this much clear time between the two."
        error={(error && validateGap(gap)) || undefined}
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
        error={(error && validateEscalationRadius(miles)) || undefined}
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
      sub="What happens when a shift would take a worker over 48 hours in a week without a 48-hour opt-out."
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
  interviewUrl,
}: {
  map: WilloStageMap;
  reviewUrlTemplate: string | null;
  interviewUrl: string | null;
}) {
  const [draft, setDraft] = useState<WilloStageMap>(map);
  const [template, setTemplate] = useState(reviewUrlTemplate ?? '');
  const [publicUrl, setPublicUrl] = useState(interviewUrl ?? '');
  const link = useSave();
  const interview = useSave();
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
      sub="Editable so a change to the Willo pipeline does not need a release."
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
        error={
          (link.error && template.trim() && validateWilloReviewUrlTemplate(template)) || undefined
        }
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
      <hr />
      {/* ADR-0149: the interview's own public link, copied from Willo. The
          reminder email (OC1) carries it so a candidate who cannot find
          Willo's invitation can still record. */}
      <Input
        label="Interview public link — for the reminder email"
        type="url"
        value={publicUrl}
        placeholder="https://…"
        hint="The interview’s public link from Willo. The “video interview is still waiting” reminder then carries a Record my video interview button. Blank: the reminder only points at Willo’s invitation email."
        error={
          (interview.error && publicUrl.trim() && validateWilloInterviewUrl(publicUrl)) || undefined
        }
        onChange={(event) => setPublicUrl(event.target.value)}
      />
      <Feedback note={interview.note} error={interview.error} />
      <SaveAction
        id="willo-interview-link"
        title="Interview public link"
        dirty={publicUrl !== (interviewUrl ?? '')}
      >
        <Button
          tone="primary"
          disabled={interview.pending}
          onClick={() => interview.run(() => saveWilloInterviewUrl(publicUrl))}
        >
          {interview.pending ? 'Saving…' : 'Save interview link'}
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
    <Block title="Sender addresses" sub="All outgoing mail comes from one of these two.">
      <Input
        label="Allocation Timesheets"
        type="email"
        value={draft.timesheets}
        hint="The Allocation Timesheet and the Completed Allocation Timesheet, and nothing else."
        onChange={(event) => setDraft({ ...draft, timesheets: event.target.value })}
      />
      <Input
        label="Timesheet replies go to · optional"
        type="email"
        value={draft.timesheets_reply_to ?? ''}
        hint="Leave blank to receive replies at the address above."
        onChange={(event) => setDraft({ ...draft, timesheets_reply_to: event.target.value })}
      />
      <Input
        label="Everything else"
        type="email"
        value={draft.admin}
        hint="Password resets, activation and invitation emails, finance reports, and the office alerts (E5–E9)."
        onChange={(event) => setDraft({ ...draft, admin: event.target.value })}
      />
      <Input
        label="Admin replies go to · optional"
        type="email"
        value={draft.admin_reply_to ?? ''}
        hint="Leave blank to receive replies at the address above."
        onChange={(event) => setDraft({ ...draft, admin_reply_to: event.target.value })}
      />
      <Note>
        Replies go to a monitored THC mailbox — no-reply addresses are not used, and this form
        refuses one. If the senders are on a sending-only subdomain (e.g. updates.…), set where
        replies go so they reach the real inbox. The office and payroll notifications go to fixed
        addresses, not a setting: E5 and E6 to <b>{recipients.e5e6.join(', ')}</b>; E7 to{' '}
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

/** ADR-0134 N1: the one Client Portal value the office sets here. */
function ClientPortalBlock({ phone }: { phone: string }) {
  const [draft, setDraft] = useState(phone);
  const { note, error, pending, run } = useSave();

  return (
    <Block title="Client Portal" sub="What customers see on every event page of the portal.">
      <Input
        label="THC on-the-day phone number"
        type="tel"
        value={draft}
        maxLength={CLIENT_PORTAL_PHONE_MAX}
        placeholder="020 7946 0000"
        hint="Shown beside “Contact THC about this event” as a tap-to-call link. Leave blank to hide it."
        error={(error && validateClientPortalPhone(draft)) || undefined}
        onChange={(event) => setDraft(event.target.value)}
      />
      <Feedback note={note} error={error} />
      <SaveAction id="client-portal" title="Client Portal phone" dirty={draft.trim() !== phone}>
        <Button
          tone="primary"
          disabled={pending}
          onClick={() => run(() => saveClientPortalPhone(draft))}
        >
          {pending ? 'Saving…' : 'Save phone number'}
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
      className="settings-wide"
      title="Standard geofence radii by venue type"
      sub="These pre-fill the slider when a venue is created. Changing one never moves an existing venue or a scheduled event."
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
  useMarkDirty(`radius:${type.key}`, `${type.label} radius`, dirty);

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
