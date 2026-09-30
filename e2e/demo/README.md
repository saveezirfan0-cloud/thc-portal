# Demo and training videos

Scripted walkthroughs of the three apps, recorded with Playwright. They are **not
tests**: each script drives a real journey in a real browser, adds on-screen
captions and a visible cursor, and writes an MP4. Re-run them after a UI change and
the videos stay current.

| Video | Scripts (in order) | Device |
|---|---|---|
| 01 Onboarding · the candidate's journey | `onboarding-1-apply` → `onboarding-4-candidate-activates` → `onboarding-5-candidate-finishes` | phone |
| 02 Onboarding · the office's side | `onboarding-2-office-accepts` → `onboarding-3-office-verifies` | desktop |
| 03 Staff App · a working day | `staff-1-working-day` | phone |
| 04 Back Office 1 · dashboard and scheduling | `office-1-dashboard-and-scheduling` | desktop |
| 05 Back Office 2 · check-in, staff and compliance | `office-2-checkin-staff-compliance` | desktop |
| 06 Back Office 3 · clients, reports and admin | `office-3-directory-reports-admin` | desktop |

`assemble.mjs` joins the segments into the six files above.

`compose.mjs` builds two longer videos from the same segments: **Staff training**
(onboarding, then the Staff App) and **Office portal training**. It cuts each segment's
own title and closing card off, records narrated "Part N of M" dividers that name the steps
each part covers, adds a contents card and a closing card, and writes MP4 chapters so a player
lists the parts. It needs the speech server (below). `node compose.mjs staff` or `office`;
set `FORCE=1` to re-render the cards.

The onboarding segments are recorded **out of order** on purpose. The candidate's
steps 1–4, the office's document check, and steps 5–11 depend on each other, so the
candidate is prepared between recordings (see "Onboarding state" below). The
finished videos play in the natural order.

## What it needs

- The three apps running (`pnpm build`, then `next start` on 3000 / 3001 / 3002) against a
  Supabase project loaded with `supabase/seed.sql` and `supabase/demo/review-data.sql`.
- A `.env.local` in each app with the Supabase URL and keys, **including
  `SUPABASE_SERVICE_ROLE_KEY`** (for `/apply`, Accept, activation and uploads). They are
  git-ignored. Never commit them.
- Chromium (Playwright's), and an `ffmpeg` with libx264 (Playwright's own build only
  writes VP8).
- If the machine reaches the internet through a proxy, run Node with
  `NODE_USE_ENV_PROXY=1`. The recorder points the browser at `HTTPS_PROXY` and trusts
  that proxy's CA by its public-key hash; verification stays on for everything else.

## Voice-over

Each caption is also spoken (Kokoro, British English female voice, offline once the model
is on disk). The picture waits for the voice, so the video is paced by the narration.

1. `pip install kokoro-onnx soundfile`, then download `kokoro-v1.0.onnx` and
   `voices-v1.0.bin` from
   <https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0>.
2. Start the speech server and leave it running:
   `KOKORO_MODEL=… KOKORO_VOICES=… TTS_CACHE=… python3 tts_server.py`
3. Warm the cache once so recordings never wait on speech:
   `DEMO_TTS_URL=http://127.0.0.1:8765 node prefetch.mjs`
4. Record with `DEMO_TTS_URL` set. Without it you get captions only.

`node calibrate.mjs` measures the gap between sound and picture on a machine (on the one
these were made on it was 0.05 s; set `DEMO_AUDIO_OFFSET` if yours differs).

## Environment variables

| Variable | Meaning |
|---|---|
| `DEMO_TTS_URL` | the speech server; unset means no voice |
| `DEMO_AUDIO_OFFSET` | seconds to shift the voice against the picture (default 0) |
| `DEMO_OUT` | where the MP4s go (default `./out`) |
| `DEMO_FFMPEG` | path to an ffmpeg with libx264 |
| `DEMO_PASSWORD` / `DEMO_PW_FILE` | password of the demo office / staff / client logins |
| `DEMO_CANDIDATE_PASSWORD` / `DEMO_CANDIDATE_PW_FILE` | password the onboarding candidate chooses |
| `DEMO_CANDIDATE_EMAIL` | the candidate's address (default an alias of the owner's) |
| `DEMO_STAFF_EMAIL` | worker for the Staff App video (default `amara.kalu@example.com`) |
| `DEMO_OFFICE_URL`, `DEMO_STAFF_URL`, `DEMO_CLIENT_URL` | app origins (default `localhost:3000/1/2`) |

Run one script from this folder with `pnpm exec node <script>.mjs`.

## Things to know before recording against a live project

- **Applying creates a real Willo candidate** when the project's Willo integration is on,
  and Willo emails the interview invitation. The job runner (`notify-drain`,
  `booking-tick`, `willo-invite`) may also be on. Check `job_runs` first.
- **Saving bank details at step 9 emails payroll.** The recording fills the form in but does
  not press Continue, and marks the step done in the database instead, so no real payroll
  address is emailed.
- Email addresses that are not `example` domains are **masked** in every recording
  (`lib.mjs`). Names are not: the Users & access and Activity log screens show the real
  team members' names.
- Phone videos are recorded at the phone's real size (412×916) and enlarged 2×, because
  Playwright never scales a recording up (a bigger canvas is padded with grey).
- Maps show the design system's plain map ground, because no Mapbox token is set.
- Documents and the profile photo are generated, plainly labelled **SAMPLE** images
  (`ensureAssets` in `lib.mjs`). No real document or face is used.

## Onboarding state

Status only moves forward (`staff_transitions`). To record the candidate's journey again
after signing the contract, reject and reset them in one transaction so the mail jobs
never see the intermediate state, then delete the unsent E2 / E2b / E3 emails it queued:
`onboarding_do_reject` (cause `manager`) → `reset_to_candidate` → clear `photo_path`,
`home_address`, `home_location` → `interview_completed` → `onboarding_do_accept`.
Do not replay Willo's webhook after a reset: a reset clears the Willo link, and the
`willo-invite` job would create a new Willo candidate.

## Other files

- `lib.mjs` — the recorder: browser, captions, cursor, email masking, sample files, and the few
  calls made to the database where the real trigger is outside the recording.
- `wizard-steps.mjs` — the candidate's 11 wizard steps as reusable, captioned steps.
- `wizard-peek.mjs` — planning aid: signs the candidate in, runs wizard steps up to a given number
  (`node wizard-peek.mjs 4`) and prints the screen it stops on. Its own recording is thrown away;
  use it to move a candidate on quietly between takes.
- `tts_server.py`, `prefetch.mjs`, `calibrate.mjs` — the voice-over (see above).
- `assemble.mjs`, `compose.mjs` — join segments into the six videos, and into the two combined ones.
- `cleanup-storage.mjs`, `cleanup-demo.sql` — remove what the recordings added.

## Clean up afterwards

The demo data uses fixed UUID ranges (`10…` logins, `20…` staff, `30…` roles, `40…`
clients, `50…` venues, `60…/61…/70…/71…` events and shifts, `62…/63…` documents,
`72…–76…` check-ins, violations, feedback, applications) and the candidate is whoever
`DEMO_CANDIDATE_EMAIL` names. Run `cleanup-storage.mjs` first (it needs the candidate's staff
row), then `cleanup-demo.sql`, then delete the `.env.local` files. `cleanup-demo.sql` leaves the
seed worker `20000000-…-0005` alone because that row may already have been in the project.
