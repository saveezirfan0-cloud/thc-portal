# ADR-0204 · Screenshots, videos and screen recordings on a ticket

**Status:** Accepted (23.10.2026 call with Sam). **Not part of the Scope of Work.** Extends ADR-0202, whose "Not in this version" named exactly this.

## Context

The feedback button was to take "optional voice dictation, plus screenshot, video or screen recording". Dictation shipped with ADR-0202. A file could only be a pasted link, which meant a reporter had to record somewhere else, upload it somewhere else, and paste the address.

## Decision

- **Where files go.** A new private bucket `ticket-files` (50 MB an object; PNG, JPEG, WebP, GIF, MP4, WebM, MOV) and a table `ticket_files` (one row per file, `admin_read`, no API role writes it). There is **no policy on `storage.objects` for this bucket**: like `documents`, it is reached only by server code with the service key, so 320's "which buckets does a non-service policy mention" is unchanged. Links are signed with the service key, and only after the caller has read the `ticket_files` row through RLS.
- **How a file gets there.** The ticket is saved first (a failed upload never loses the report). For each file the Back Office server asks `ticket_file_allowed(ticket)` and, if yes, issues a one-object signed upload URL under `<ticket id>/<uuid>.<ext>`; the browser PUTs the file straight to Storage (a video does not fit through a server action); then `attach_ticket_file()` registers it, reading the size and type **from what Storage recorded**, never from the browser, and refusing a path that is not under the ticket, an object that is not there, or a kind that does not match the type.
- **Who.** Only the person who filed the ticket, within an hour of filing, up to five files. A Viewer files nothing (ADR-0060) so attaches nothing.
- **What the reporter can do.** Attach files (phones open the camera or library), **Take a screenshot** or **Record my screen** (`getDisplayMedia`; hidden with a note where the browser has none, which includes iPhones). The dialog steps aside during a capture so it is not in the picture; a recording shows a fixed Stop bar, ends by itself at 3 minutes (about 34 MB at the rate chosen, under the 50 MB cap) and ends when the browser's own Stop sharing is pressed.
- **Across pages.** Next remounts the button on every route change, and a recording is only useful if the reporter can click through the screens they are showing. The draft, the chosen files and an active recording are therefore held in a small module-level store (`_lib/sharedState.ts`), and the dialog reopens by itself when a capture ends, wherever the reporter has got to.
- **Deleting.** Removing a file row queues its object in `storage_deletions`, and `delete_ticket` (restated here) also queues the whole `<ticket id>/` folder as a prefix, so an object uploaded but never attached goes with the ticket. The gdpr-purge job drains that queue for any bucket. Before a URL is issued the server also counts the objects already in the folder, so five is a limit on storage, not only on rows; `attach_ticket_file` locks the ticket row so racing attaches cannot pass five.
- **Content-Security-Policy.** `media-src` now allows the project's Storage origin so the recording plays once the policy is enforced (it is report-only today).
- **Page link.** The ticket now records the full address (`window.location.href`, query string included), shown as a link.

## Consequences

- Nothing is stored in the browser or sent anywhere until the reporter presses Send. A screen capture can show anything on the screen; the reporter chooses the tab or window, and the files are visible to every Back Office login, as the ticket is.
- Files are kept as long as the ticket. Tickets are never purged and a §1.7 worker removal does not reach a screenshot that shows them: say so in the privacy notice's retention section before relying on this.
- Files cannot be removed one at a time from a ticket yet (only with the ticket). Adding files to an existing ticket later is not offered: the hour and five-file limits exist to keep the surface small.
- Two more entries on the signed-in definer surface (`ticket_file_allowed`, `attach_ticket_file`), pinned in 892; `ticket_files` in 001.
- pgTAP `934_ticket_files.sql` (38 assertions, including worker, client and demoted-reporter cases); Vitest `ticket-files.test.ts` and the ticket screen. **Not exercised in a browser or against real Storage in the build sandbox** (no Supabase project, no PostGIS/pgTAP): CI runs the pgTAP, and the upload and recording paths need one live try (docs/23 §4).
- Staff App and Client Portal entry points remain out: they would put the owner's inbox in front of ~1,000 workers during launch week.
