# Onboarding chasers: the wording

The reminders sent to a candidate who has stopped part-way through onboarding
(ADR-0071). This sheet is for THC to read and approve. It is copied word for
word from the register, `packages/notifications/src/templates.ts`
(`OC1`, `OC2`, `OC3`). The register is what is actually sent. A change THC
asks for goes there first, then here.

The PDF sent to THC is `docs/pdfs/THC-Onboarding-Reminders-Wording.pdf`:
every email rendered as it is sent, the push notifications, and a sign-off
page.

The examples use the sample candidate from the email previews, **Amara**.
`{name}` is the candidate's first name.

## When they go out

| | Interview not done | Accepted, account not set up | Signed up, a step left in the app |
| --- | --- | --- | --- |
| **Code** | OC1 | OC2 | OC3 |
| **Channel** | Email | Email, with a new set-password link | Push notification, opens the onboarding wizard |
| **From** | admin@thehospitalitycompany.co.uk | admin@thehospitalitycompany.co.uk | THC Staff App |

- **Daily.** The first reminder goes a day after the candidate's last progress,
  then one a day for as long as the next move is theirs.
- **They don't stop.** No message says "last reminder". Any progress (a step
  saved, a document uploaded, a quiz attempt) starts the count again.
  Rejecting the candidate stops them.
- **Daytime only.** Sent between 10:00 and 18:00 UK time.
- **Three wordings per message.** Day 1, day 2, then the day-3 wording every
  day after that. After three reminders with no progress the Back Office card
  reads **"Stalled … Phone them."** and the reminders carry on.
- **Never sent** while the move is the office's: interview completed and
  awaiting a decision, documents under review, or a declaration awaiting
  Verify.

## OC1 · Interview reminder (email)

Sent while the candidate is in *Interview requested*, Willo's invitation has
gone out, and the interview is not done. Willo sends the invitation itself and
we don't hold its link, so the email points the candidate at Willo's email.

Label above the title: **YOUR VIDEO INTERVIEW**

### Day 1

**Subject:** Your video interview with The Hospitality Company

> Hi Amara,
>
> Thanks for applying to The Hospitality Company. Your video interview is
> ready and waiting for you.
>
> The invitation came by email from Willo, the service we use for interviews.
> Search your inbox for "Willo", and check your spam or promotions folder too.
> You can record your answers on your phone, whenever suits you.
>
> Once you've finished, we'll be in touch about the next steps.

### Day 2

**Subject:** Your video interview with The Hospitality Company

> Hi Amara,
>
> Just a reminder that your video interview with The Hospitality Company is
> still waiting for you. Look for the invitation from Willo in your inbox, or
> in your spam folder. You can record your answers on your phone, whenever
> suits you.
>
> We can't move your application forward until it's done.

### Day 3, and every day after

**Subject:** Reminder: your video interview is still waiting

> Hi Amara,
>
> Your video interview with The Hospitality Company is still waiting for you.
> If you'd still like to work with us, find the invitation from Willo in your
> inbox or spam folder and record your answers, whenever suits you.
>
> Can't find it? Reply to this email and we'll help.

## OC2 · Account set-up reminder (email)

Sent once the candidate is accepted and the welcome email (E3) has gone out,
but they have not set a password. The set-password link in the welcome email
works once and expires after 24 hours, so every reminder carries a **new**
link. In the email both links are buttons: **Set your password** and **Get the
THC Staff App**. The address is printed under each button as well.

Label above the title: **SET UP YOUR ACCOUNT**

### Day 1

**Subject:** Set up your account with The Hospitality Company

> Hi Amara,
>
> Good news: your application was accepted, but your account isn't set up
> yet. Set your password to start onboarding:
>
> **[Set your password]**
>
> Then download the app and add it to your home screen:
>
> **[Get the THC Staff App]**
>
> This link is new and replaces the one we sent before. It works once and
> expires after 24 hours.

### Day 2

**Subject:** Set up your account with The Hospitality Company

> Hi Amara,
>
> Just a reminder to set up your account so you can start onboarding with The
> Hospitality Company. Set your password here:
>
> **[Set your password]**
>
> Then download the app and add it to your home screen:
>
> **[Get the THC Staff App]**
>
> This link replaces any earlier one. It works once and expires after 24
> hours.

### Day 3, and every day after

**Subject:** Reminder: set up your account

> Hi Amara,
>
> Your account with The Hospitality Company still isn't set up, and we can't
> offer you shifts until you've finished onboarding in the app. Set your
> password here:
>
> **[Set your password]**
>
> Then download the app and add it to your home screen:
>
> **[Get the THC Staff App]**
>
> This link replaces any earlier one. It works once and expires after 24
> hours. Need a hand? Reply to this email.

## OC3 · App reminder (push notification)

Sent once the candidate has signed up and a step in the onboarding wizard is
waiting on them. Tapping it opens the wizard at that step. `{step}` is filled
in with the step in words (below).

| | Title | Message |
| --- | --- | --- |
| **Day 1** | Pick up where you left off | Next up: `{step}`. Tap to carry on with your onboarding. |
| **Day 2** | You're nearly there | Still to do: `{step}`. Finish onboarding to start picking up shifts. |
| **Day 3, and every day after** | Your onboarding is waiting | Still to do: `{step}`. We can't offer you shifts until onboarding is finished. Need help? Contact the office. |

For example, a candidate who has not done the quiz sees on day 1:

> **Pick up where you left off**
> Next up: the Health & Safety quiz. Tap to carry on with your onboarding.

### The step, in words

| Wizard step | `{step}` reads |
| --- | --- |
| 1 · Right to work | your right-to-work details |
| 2 · Address | your home address |
| 3 · Selfie | your profile selfie |
| 4 · Documents | uploading your documents |
| 4 · Documents, one rejected | re-uploading a rejected document |
| 5 · Induction | the Health & Safety induction |
| 6 · Quiz | the Health & Safety quiz |
| 7 · HMRC | the HMRC New Starter Checklist |
| 8 · References | your two references |
| 9 · Bank & payroll | your bank & payroll details |
| 10 · Contract | signing your contract |

A candidate with notifications turned off gets no push. Their Back Office card
turns amber straight away ("not delivered — notifications are off on their
phone. Phone them.") so the office can call instead.

## For THC to confirm

- [ ] OC1 wording, days 1, 2 and 3+
- [ ] OC2 wording, days 1, 2 and 3+
- [ ] OC3 wording, days 1, 2 and 3+, and the step names
- [ ] "Reply to this email" (OC1 day 3+, OC2 day 3+) goes to admin@, which
      someone reads
- [ ] "Contact the office" (OC3 day 3+) is enough, or name a phone number
