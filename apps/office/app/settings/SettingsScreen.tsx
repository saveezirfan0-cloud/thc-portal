'use client';

import { useCallback, useState } from 'react';
import {
  Alert,
  Button,
  Input,
  Note,
  Pill,
  SaveBar,
  Select,
  Switch,
  Tabs,
  Textarea,
  TimeField,
  UkDateField,
  useUnsavedChanges,
} from '@thc/ui';
import { ukInputLabel } from '@thc/domain';
import { OfficeShell } from '../_components/OfficeShell';
import { BufferSuggestionBlock } from './BufferSuggestionBlock';
import { NotificationsTab } from './NotificationsTab';
import { TicketsTab } from './TicketsTab';
import { XeroTab } from './XeroTab';
import type { XeroTabData } from './xeroData';
import { OfficeCopyBlock } from './OfficeCopyBlock';
import { Block, Feedback, SaveAction, SaveSlot, useMarkDirty, useSave } from './blocks';
// blocks.tsx is their home; this re-export keeps settings blocks that import them from here compiling.
export { Block, Feedback, SaveAction, useSave } from './blocks';
import {
  saveAutoAssignNumbers,
  saveClientPortalPhone,
  saveInvoicing,
  saveOfficeSignIn,
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
  LATE_PAYMENT_NOTE_MAX,
  MAX_RADIUS_M,
  PAYMENT_TERMS_MAX_DAYS,
  PO_WINDOW_MAX_DAYS,
  PO_WINDOW_MIN_DAYS,
  VAT_RATE_MAX,
  MIN_RADIUS_M,
  SESSION_HOURS_MAX,
  SESSION_HOURS_MIN,
  WEIGHT_FIELDS,
  invoicingProblems,
  validateClientPortalPhone,
  validateEscalationRadius,
  validateGap,
  validateSessionHours,
  validateWilloInterviewUrl,
  validateWilloReviewUrlTemplate,
  weightTotal,
} from './validate';
import { KANBAN_STAGES } from './types';
import type {
  InvoicingSettings,
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
  tracker = false,
  xero,
  xeroFlash = null,
}: {
  data: SettingsData;
  tab: SettingsTab;
  /** ADR-0202: this login keeps ticket time and billing (`ticket_tracker_allowed()`). */
  tracker?: boolean;
  /** ADR-0211: the Xero tab's data, read on the server (never a token). */
  xero?: XeroTabData;
  /** `?xero=` — the result of the connect round trip. */
  xeroFlash?: string | null;
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
          { value: 'tickets', label: 'Tickets' },
          { value: 'xero', label: 'Xero' },
        ]}
      />

      {tab === 'notifications' ? <NotificationsTab off={data.notificationsOff} /> : null}

      {tab === 'tickets' ? <TicketsTab tracker={tracker} /> : null}

      <SaveSlot.Provider value={{ slot, mark }}>
        {xero ? (
          <div hidden={tab !== 'xero'}>
            <XeroTab data={xero} flash={xeroFlash} />
          </div>
        ) : null}
        <div className="settings-grid" hidden={tab !== 'general'}>
          <WeightsBlock weights={data.weights} />
          <AutoAssignBlock
            gapMinutes={data.bookedElsewhereGapMinutes}
            escalationMiles={data.escalationRadiusMiles}
          />
          <BufferSuggestionBlock rule={data.bufferSuggestion} />
          <RotaGuardBlock mode={data.rotaGuardMode} />
          <WilloBlock
            map={data.willo}
            reviewUrlTemplate={data.willoReviewUrlTemplate}
            interviewUrl={data.willoInterviewUrl}
          />
          <SendersBlock senders={data.senders} recipients={data.recipients} />
          <OfficeCopyBlock emails={data.documentOfficeCopy} />
          <ClientPortalBlock phone={data.clientPortalPhone} />
          <SignInSecurityBlock
            twoStepRequired={data.officeTwoStepRequired}
            sessionMaxHours={data.officeSessionMaxHours}
          />
          <InvoicingBlock invoicing={data.invoicing} />
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

/** Plain settings values (numbers, strings, flat records) compared by content. */
function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
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
 * ADR-0164 (security audit H1, M4): Back Office sign-in. Two-step is
 * required by default; switching it off is an owner's decision, audited
 * like every setting here. The session length is enforced by the database
 * from the moment of the password, however often the session is used.
 */
function SignInSecurityBlock({
  twoStepRequired,
  sessionMaxHours,
}: {
  twoStepRequired: boolean;
  sessionMaxHours: number;
}) {
  const [required, setRequired] = useState(twoStepRequired ? 'required' : 'optional');
  const [hours, setHours] = useState(sessionMaxHours);
  const { note, error, pending, run } = useSave();
  const dirty = (required === 'required') !== twoStepRequired || hours !== sessionMaxHours;

  return (
    <Block
      title="Back Office sign-in"
      sub="Who must use two-step sign-in, and how long one sign-in lasts. Staff App and Client Portal logins are not affected."
    >
      <Select
        label="Two-step sign-in"
        value={required}
        onChange={(event) => setRequired(event.target.value)}
        hint="Required: a Back Office login without an authenticator app is asked to set one up before it can open anything."
      >
        <option value="required">Required for every Back Office login (default)</option>
        <option value="optional">Optional — each person chooses on My account</option>
      </Select>
      <Input
        label="A sign-in lasts (hours)"
        type="number"
        step="1"
        min={String(SESSION_HOURS_MIN)}
        max={String(SESSION_HOURS_MAX)}
        mono
        value={String(hours)}
        hint="Counted from the password, not from the last click; after it, sign in again — so a copied sign-in stops working. Shortening it signs out anyone already signed in for longer, you included."
        error={(error && validateSessionHours(hours)) || undefined}
        onChange={(event) => setHours(Number(event.target.value))}
      />
      {required === 'optional' ? (
        <Note>
          Optional means one leaked password is enough to open pay, bank details and every worker’s
          documents, unless that person has set up two-step themselves.
        </Note>
      ) : null}
      <Feedback note={note} error={error} />
      <SaveAction id="sign-in" title="Back Office sign-in" dirty={dirty}>
        <Button
          tone="primary"
          disabled={pending || !dirty}
          onClick={() => run(() => saveOfficeSignIn(required === 'required', hours))}
        >
          {pending ? 'Saving…' : 'Save sign-in rules'}
        </Button>
      </SaveAction>
    </Block>
  );
}

/** The invoicing form: the three counts as typed, so a cleared box is not 0. */
type InvoicingDraft = Omit<
  InvoicingSettings,
  'vat_rate' | 'payment_terms_days' | 'po_window_days'
> & { vat_rate: string; payment_terms_days: string; po_window_days: string };

function invoicingDraft(settings: InvoicingSettings): InvoicingDraft {
  return {
    ...settings,
    vat_rate: String(settings.vat_rate),
    payment_terms_days: String(settings.payment_terms_days),
    po_window_days: String(settings.po_window_days),
  };
}

/** A blank box is not a number (NaN, refused), never a silent 0. */
function typedNumber(value: string): number {
  return value.trim() === '' ? Number.NaN : Number(value);
}

function fromInvoicingDraft(draft: InvoicingDraft): InvoicingSettings {
  return {
    ...draft,
    vat_rate: typedNumber(draft.vat_rate),
    payment_terms_days: typedNumber(draft.payment_terms_days),
    po_window_days: typedNumber(draft.po_window_days),
  };
}

/**
 * ADR-0176: the invoices the system issues and emails. One PO's events make
 * one invoice, sent the morning after the last of them; every value here is
 * snapshotted onto each invoice as it is issued, so a change never touches
 * an invoice already sent.
 */
function InvoicingBlock({ invoicing }: { invoicing: InvoicingSettings }) {
  const [draft, setDraft] = useState<InvoicingDraft>(() => invoicingDraft(invoicing));
  const { note, error, pending, run } = useSave();
  const settings = fromInvoicingDraft(draft);
  const problems = invoicingProblems(settings);
  // Fields are marked only after a refused save, as in every other block.
  const shown = (field: keyof typeof problems) => (error && problems[field]) || undefined;
  const dirty = !sameValue(settings, invoicing);
  const company = (key: keyof InvoicingSettings['company'], value: string) =>
    setDraft((current) => ({ ...current, company: { ...current.company, [key]: value } }));
  const bank = (key: keyof InvoicingSettings['bank'], value: string) =>
    setDraft((current) => ({ ...current, bank: { ...current.bank, [key]: value } }));

  return (
    <Block
      className="settings-wide"
      title="Invoicing"
      sub="Invoices are emailed at this time the morning after the last event on a PO, with the sign-in and sign-out log attached."
      actions={
        <Pill tone={invoicing.enabled ? 'green' : 'neutral'}>
          {invoicing.enabled ? 'Sending' : 'Off'}
        </Pill>
      }
    >
      <Switch
        checked={draft.enabled}
        onChange={(enabled) => setDraft((current) => ({ ...current, enabled }))}
        label={
          draft.enabled
            ? 'On — invoices are issued and emailed'
            : 'Off — no invoice is issued or emailed'
        }
      />
      <div className="settings-invoicing">
        <div className="settings-invoicing-col">
          <h4 className="settings-subhead">Sending</h4>
          <TimeField
            label={ukInputLabel('Send time')}
            value={draft.time}
            hint="Sent from the timesheets address to the client card’s accounts contact."
            error={shown('time')}
            onChange={(time) => setDraft((current) => ({ ...current, time }))}
          />
          <UkDateField
            label="First invoiced event date"
            value={draft.first_event_date}
            hint="Events dated before this day are never invoiced. Moving it earlier invoices past events that have no invoice yet."
            error={shown('first_event_date')}
            onChange={(first_event_date) =>
              setDraft((current) => ({ ...current, first_event_date }))
            }
          />
          <Input
            label="PO window (days)"
            type="number"
            step="1"
            min={String(PO_WINDOW_MIN_DAYS)}
            max={String(PO_WINDOW_MAX_DAYS)}
            mono
            value={draft.po_window_days}
            hint="A PO’s invoice covers its events within this many days of the first one not yet invoiced; a PO reused later starts a new invoice."
            error={shown('po_window_days')}
            onChange={(event) =>
              setDraft((current) => ({ ...current, po_window_days: event.target.value }))
            }
          />
          <Input
            label="VAT rate (%)"
            type="number"
            step="0.01"
            min="0"
            max={String(VAT_RATE_MAX)}
            mono
            value={draft.vat_rate}
            error={shown('vat_rate')}
            onChange={(event) =>
              setDraft((current) => ({ ...current, vat_rate: event.target.value }))
            }
          />
          <Input
            label="Payment terms (days)"
            type="number"
            step="1"
            min="0"
            max={String(PAYMENT_TERMS_MAX_DAYS)}
            mono
            value={draft.payment_terms_days}
            hint="The due date is the invoice date plus this many days."
            error={shown('payment_terms_days')}
            onChange={(event) =>
              setDraft((current) => ({ ...current, payment_terms_days: event.target.value }))
            }
          />
        </div>
        <div className="settings-invoicing-col">
          <h4 className="settings-subhead">Company</h4>
          <Input
            label="Company name"
            value={draft.company.name}
            error={shown('company.name')}
            onChange={(event) => company('name', event.target.value)}
          />
          <Input
            label="Company registration number"
            mono
            value={draft.company.company_reg}
            error={shown('company.company_reg')}
            onChange={(event) => company('company_reg', event.target.value)}
          />
          <Input
            label="VAT registration number"
            mono
            value={draft.company.vat_reg}
            error={shown('company.vat_reg')}
            onChange={(event) => company('vat_reg', event.target.value)}
          />
          <Input
            label="Email"
            type="email"
            value={draft.company.email}
            error={shown('company.email')}
            onChange={(event) => company('email', event.target.value)}
          />
          <Input
            label="Website"
            value={draft.company.website}
            error={shown('company.website')}
            onChange={(event) => company('website', event.target.value)}
          />
        </div>
        <div className="settings-invoicing-col">
          <h4 className="settings-subhead">Bank</h4>
          <Input
            label="Account name"
            value={draft.bank.account_name}
            error={shown('bank.account_name')}
            onChange={(event) => bank('account_name', event.target.value)}
          />
          <Input
            label="Bank"
            value={draft.bank.bank}
            error={shown('bank.bank')}
            onChange={(event) => bank('bank', event.target.value)}
          />
          <Input
            label="Account number"
            inputMode="numeric"
            maxLength={8}
            mono
            value={draft.bank.account_number}
            error={shown('bank.account_number')}
            onChange={(event) => bank('account_number', event.target.value)}
          />
          <Input
            label="Sort code"
            inputMode="numeric"
            maxLength={8}
            placeholder="NN-NN-NN"
            mono
            value={draft.bank.sort_code}
            error={shown('bank.sort_code')}
            onChange={(event) => bank('sort_code', event.target.value)}
          />
        </div>
      </div>
      <Textarea
        label="Late-payment wording"
        rows={4}
        maxLength={LATE_PAYMENT_NOTE_MAX}
        value={draft.late_payment_note}
        hint="Printed under the payment details on every invoice."
        error={shown('late_payment_note')}
        onChange={(event) =>
          setDraft((current) => ({ ...current, late_payment_note: event.target.value }))
        }
      />
      <Note>
        Each invoice keeps the values it was issued with: a change here applies from the next
        invoice on and never alters one already sent.
      </Note>
      <Feedback note={note} error={error} />
      <SaveAction id="invoicing" title="Invoicing" dirty={dirty}>
        <Button
          tone="primary"
          disabled={pending}
          onClick={() => run(() => saveInvoicing(settings))}
        >
          {pending ? 'Saving…' : 'Save invoicing'}
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
