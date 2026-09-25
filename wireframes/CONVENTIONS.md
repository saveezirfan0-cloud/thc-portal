# THC wireframes — conventions

Static HTML wireframes for every screen in the Scope of Work v1.6. They are the visual
contract for the build: the same tokens and component names are reused in `packages/ui`.

## Source of truth
- Spec text: `docs/scope/scope-of-work-v1.6.txt` (grep it; section numbers are in the text, e.g. `9.5 Check In`).
- Design system: §1.6 (web) and §10.1 (mobile). Implemented in `wireframes/assets/thc.css`.
- Reference pages to copy the pattern from:
  - Web shell: `wireframes/backoffice/dashboard.html` (sidebar + topbar + content; copy the sidebar markup verbatim and set `.active` on the current item)
  - Mobile: `wireframes/staff/shifts.html` (phone frames in a `.phones` gallery, one phone per screen/state)

## Hard rules (from the spec)
0. Tokens only. Never write a hex colour, `rgba(...)` or a `border-radius` in a page: use `var(--panel)`, `var(--cyan-ink)`, `var(--r)` etc. Pages must look right in all four theme/style combinations (switch in the top bar).
1. Zero border-radius in Scope style (tokens are 0 there). The only always-round thing is the `.logo.round` circle.
2. Palette tokens only (`var(--cyan)` for fills, `var(--cyan-ink)` for text). Purple is reserved for Auto-Assign. Coral = danger.
3. Fonts: headings Space Grotesk, body Inter, labels IBM Plex Mono uppercase + letter-spacing (`.label`, `.pill`).
4. Square avatars (`.avatar`). Real selfie photos in product; wireframes show initials on a `.avatar.photo`.
5. Sidebar active = cyan left bar + subtle cyan fill + cyan text (already in CSS).
6. One name + one logo: "The Hospitality Company". No other product name anywhere.
7. Scheduled times: show UK time; when the viewer is outside the UK add a second "your time" line (§1.8). Actual check-in/out stamps: viewer local only. Manager-typed times carry "(UK time)" in the label.
8. Buffer displays as "6 (+1)", never "7". Headcount fill counts ONLY confirmed.
9. Mobile times are always the worker's OWN role window, never the event window (RULE-18).
10. Worker sees base rate only, never +12.07% holiday. Client Portal shows no money at all.

## Page skeleton
```html
<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Back Office · X — THC wireframes</title>
<link rel="stylesheet" href="../assets/thc.css"><script src="../assets/thc.js" defer></script></head>
<body>
<div class="wf-bar"><a href="../index.html">← Hub</a><span class="t">Back Office · X</span><span class="pill cyan">/route</span><span class="pill">§9.x</span><span class="spacer"></span><a href="next.html">Next: Y →</a></div>
... (web: <div class="shell"> sidebar + main ; mobile: <div class="wf-section"> + <div class="phones">)
<div class="wf-note note"><b>Behaviour notes.</b> …rules that govern this screen, with § refs…</div>
</body></html>
```

## Showing multiple states of one screen
Web pages: put a state switcher under the topbar and wrap each variant:
```html
<div class="wf-states" data-target="board"><button data-state="filling">Upcoming · filling</button><button data-state="ongoing">Ongoing · re-opened slot</button></div>
<section data-state-of="board" data-state="filling">…</section>
<section data-state-of="board" data-state="ongoing" class="hide">…</section>
```
Mobile pages: one `.phone` per state inside `.phones`, each with a `.cap` caption `Screen · <b>State</b>`.
Modals on web: render inline with `<div class="modal-inline"><div class="modal-back">…` inside a state, or as a separate state.
Use `.annot` spans sparingly to call out a rule on the canvas (amber mono text), e.g. `<span class="annot">buffer shown as 6 (+1)</span>`.

## Data to use (keep it consistent across pages)
- Admin: Gisela M. Clients: Leonardo Hotel St Pauls, Mandarin Oriental, The Dorchester, Private client (Hurst), ExCeL London.
- Events: Gala Dinner (Fri 19 Sep 2026, Leonardo Royal, PO 4471-A; Chef 07:00–15:00 2(+0), Kitchen Porter 09:00–17:00 3(+1), Waiting Staff 17:00–23:30 12(+2)), Product Launch — Bar (Mandarin Oriental, Bar Staff 18:00–01:00 6(+1)), Wedding — Marquee (Sat 20, Hurst Manor), Awards Night (Tue 23, Dorchester), Conference Lunch (Sun 21, ExCeL, Cancelled).
- Workers: Amara K. (AK, student visa, 20h term-time cap until 13.12.2026), Tom R. (TR, UK citizen), Priya S. (PS, EU settled), Luca M. (LM, work visa), Jonah W. (JW, blocked — passport expired), Deleted account #1042 (GDPR removed).
- Roles/base pay: Waiting Staff £14.00 · Bar Staff £15.50 · Chef £19.00 · Kitchen Porter £13.50 · Host £16.00. Final = base × 1.1207. Charge rates are per client (e.g. Leonardo: Waiting Staff £22.97).
- Today in the wireframes = Thu 18 Sep 2026, 14:32 UK time.

## File naming (must match the hub links)
Back Office: `backoffice/{login,dashboard,onboarding,candidate,events,shift-builder,event-board,compliance,checkin,staff,staff-profile,change-requests,clients,client-card,roles,reports,feedback,venues}.html`
Staff app: `staff/{auth,onboarding-1,onboarding-2,onboarding-3,shifts,shift-detail,offer-shift,radar,invites,documents,profile,availability,request-change,refer,locks}.html`
Additions planned in `docs/18` (ADR-0036–0040, proposed) are stubs: `staff/{availability,request-change,refer,offer-shift}.html`, `backoffice/change-requests.html`.
Public: `public/{apply,activate}.html` · Client Portal: `client/{login,events,event,timesheet}.html`
