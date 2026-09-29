# ADR-0071 · Onboarding chasers: email before sign-up, push after, Stalled after three

**Status:** Accepted (owner request, 29.09.2026). An addition to scope v1.6 §8. The copy was drafted by the build team at the owner's request and still needs THC's approval.

## Context

The onboarding board showed candidates sitting in a column for days ("7 d" in coral) with nothing prompting them. §8 has no reminder for a candidate who stops part-way. The only onboarding sends are E1 (Willo's invite), E2/E2b, E3, E4, N8 and the N1–N4 expiry ladder. The owner asked: "Can chaser notifications be sent out to staff to push them along the onboarding steps?" They then settled four points:

- **Timing:** 2, 5 and 10 days, then a Stalled flag. They accepted this as proposed.
- **Before activation:** any reminder is an **email**. This covers the interview and the time until the activation email.
- **After sign-up:** the reminder is **in the app**.
- **Activation sent but not used:** the reminder to sign up is an **email**.

## Decision

### Who is chased: only when the next move is theirs

`onboarding_chaser_candidates()` (20261001211000) returns one row per candidate whose next move is their own:

| Track | Code | The candidate is… | Channel |
|---|---|---|---|
| interview | **OC1** | in Interview requested, Willo's invite sent (`willo_invited_at`), interview not completed | email |
| activation | **OC2** | accepted (Documents), an E3 **sent**, no password on the login | email with a **new** activation link |
| app | **OC3** | signed up, and the wizard's next step is theirs (steps 1–4, a rejected document to re-upload, induction, quiz, HMRC, references, bank, contract) | push → `/onboarding` |

Never chased, because the move is the office's or nobody's:

- Interview completed, which is waiting on the Willo decision.
- Documents submitted and under review.
- A Yes declaration awaiting Verify.
- A candidate not yet created in Willo, who has no interview to do.
- An E3 still queued, which the candidate has not received.
- Rejected, inactive or removed candidates.

### The ladder

**Rungs.** The three rungs fall due **2, 5 and 10 days after the candidate's last progress**. Each rung is also at least **3 and 5 days after the previous one**, so a candidate already idle for a month gets one reminder on the first run, not three on consecutive days.

**What counts as progress:**
- a stage change;
- a wizard step saved;
- a document uploaded or reviewed (a rejection hands the move back);
- a quiz attempt;
- a declaration or its review;
- activation;
- an E3 sent or re-sent.

**Keys.** The outbox key is `OCn:staff:<id>:<progress epoch>:<rung>`. Any progress therefore starts a fresh ladder, and a re-run never sends twice.

**When sends go out.** Only **10:00–18:00 UK**. The job runs hourly and the SQL applies the window, so it holds across the clock changes.

**Settings.** `settings.onboarding_chasers` holds `enabled`, `days`, `from` and `until`. Missing keys fall back to the defaults.

**After the third rung** the card reads **"Stalled — no progress after 3 reminders (last dd Mon). Phone them."** in coral. Nothing is rejected automatically. Rejection stays the manager's decision.

### OC2 carries a freshly minted link

E3's link works once and lives 24 hours (`otp_expiry`), so repeating it would send a dead link. SQL cannot mint a GoTrue token, so the job has two halves:

1. `onboarding_chasers(p_now)` (service role only) queues OC1 and OC3 itself. It returns the OC2s due as `{staffId, userId, email, rung}`.
2. The **onboarding-chasers** Edge Function mints a link for each one with `issueActivationLink` (packages/db/src/provision.ts). This is the same code the office's Accept and Resend use. The function passes the link to `onboarding_chaser_activation()`, which re-checks the rung is still due, points any unsent E3/OC2 at the new token (`activation_link_refresh`, now OC2-aware) and queues the email. The order of these calls is `runChaserSweep` in packages/db/src/chasers.ts. A failure for one candidate is counted in `job_runs` and does not stop the others.

Minting replaces the candidate's previous token. That is intended here, because the new email carries the new one. It happens only for a row the database has just named as due.

An OC2 row carries a live link, so it gets exactly E3's protections (ADR-0060):
- the restrictive `office_activation_links` policy now fences `template in ('E3','OC2')` to owners;
- `redact_finished_invite_link()` strips the link once the row is sent or has failed.

### The copy (register `CHASER_CODES`, one variant per rung)

| | Rung 1 (`first`) | Rung 2 (`second`) | Rung 3 (`final`) |
|---|---|---|---|
| **OC1** email · "Your video interview with The Hospitality Company" | Thanks for applying; the interview is waiting; search your inbox for "Willo" (and spam); record on your phone whenever suits you | Just a reminder…; we can't move your application forward until it's done | Subject "Last reminder: your video interview"; can't find it? reply and we'll help |
| **OC2** email · "Set up your account with The Hospitality Company" | Your application was accepted but your account isn't set up; `{link}`; download the app `{installLink}`; new link, works once, 24 hours | Just a reminder…; same links | Subject "Last reminder: set up your account"; we can't offer you shifts until onboarding is finished; reply for help |
| **OC3** push → `/onboarding` | **Pick up where you left off** — "Next up: {step}. Tap to carry on with your onboarding." | **You're nearly there** — "Still to do: {step}. Finish onboarding to start picking up shifts." | **Last reminder** — "Still to do: {step}. We can't offer you shifts until onboarding is finished. Need help? Contact the office." |

The verbatim text is in `packages/notifications/src/templates.ts`. `{step}` is the wizard step in words; `REGISTER-NOTES.md` lists them. A variant may now carry its own `title`, and `messageFor` applies variants to emails as well as pushes. OC3 has its own tag (`OC3`). Otherwise its tag would be `/onboarding`, the same as a candidate's N8, and a reminder would replace a document-rejected notification on the phone.

### The office

`onboarding_chaser_state()` is a Back Office-only definer. The board reads it separately, like the referrals, because the pipeline view is frozen. Each card then shows one of:

- "Interview reminder 2 of 3 emailed 27 Sep · next 2 Oct"
- "Set-up reminder 1 of 3 emailed with a new link 27 Sep · next 30 Sep"
- "App reminder 1 of 3 pushed 27 Sep · next 30 Sep"
- the coral Stalled line.

A failed read shows an alert, never "not reminded".

## Consequences

- **Deploy.** The onboarding-chasers Edge Function deploys with the others (ci.yml). It needs the `STAFF_APP_URL` secret, which is already set for willo-webhook. The `job_schedules` row is enabled, so **`select public.install_job_schedules();` must be re-run** after this migration (docs/16 §4.7). Until it runs, nothing is chased.
- **Without `STAFF_APP_URL`,** no link is minted and every OC2 counts as `oc2_failed` in `job_runs`. OC1 and OC3 still go.
- **Push reach.** A signed-up candidate with notifications off gets no OC3. The drain fails the row ("no push subscription") as it does for any push, and the card still moves to Stalled after the third.
- **The first run after deploy** reminds every candidate who has been idle 2+ days, once, and spaces the rest of their ladder.
- pgTAP 394; vitest in packages/notifications (templates, outbox), packages/db (chasers) and apps/office (chasers.test.tsx); 190's enabled-schedule list now includes onboarding-chasers.

## Not done

- **No Willo link in OC1.** Willo sends the invite and nothing stores its URL, so OC1 points at that email. If Willo's API can re-send an invitation, OC1 could do that instead.
- **No per-candidate "stop reminding" switch.** Rejecting the candidate stops the reminders, and so does the global setting.
- **Not on `/onboarding/:id`.** The profile does not yet show the reminder history. The outbox rows are there if it is wanted.
