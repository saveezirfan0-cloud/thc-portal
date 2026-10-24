# ADR-0212 · Document photos turned the right way up

**Status:** Accepted (ticket TK-18, reported by Sam Barrington-Wells, 24.10.2026: "Passports are coming through to verify and they are the wrong way round — can these be sorted before they are verified? This would save time having to reject the passport and asking for it to be re-uploaded."). No change to the scope's rules.

## Context

The Staff App stores a document photo exactly as the phone took it, and the Back Office opens that file as it is. A passport photographed sideways or upside down reached Needs review that way, and the office's only answer was Reject (N8) and a new upload. Nothing in the pipeline looked at orientation, and there was no way to turn a file.

## Decision

**1. Turned on upload, by the AI read (Staff App, `lib/extract.ts`, `lib/upright.ts`).**

- The reader sees a photo the way a browser shows it: the camera's orientation tag is applied to the pixels first (sharp `autoOrient`).
- The read gains one answer, `uprightTurn`: how many degrees clockwise the image must turn for its printed text to read the right way up (0, 90, 180 or 270; null when it cannot tell, or the page is not this document).
- On 90/180/270 the Staff App turns a copy and reads the copy again. Only when that second read says 0 is the copy stored (a `.jpg` beside the original) and swapped in by `turn_document_upright()`. The second read is the one recorded, with `turnedUpright` in `ai_extracted`.
- Anything short of that (the second read disagrees, an upload or database refusal, a throw) keeps the original and the first read. Every failure is logged by code only.
- JPEG and PNG photos of any document only. Never a PDF, a HEIC, the gov.uk report or the Home Office result.

**2. Rotate on Needs review (Back Office).**

- A JPG/PNG document row carries **Rotate ↻** beside View. Each press turns the photo a quarter clockwise and keeps it that way.
- The office presses it, then View to check, then Verify. No rejection is needed.

**3. One database function for both, `turn_document_upright(doc, from, to, size, degrees)` (`20261027110000`).**

- Callers: the service role (the AI read) or an office login that may write. A viewer, a worker and a client are refused.
- It refuses anything that is not pending review (what a reviewer decided on stays on file), or whose file has changed since it was read.
- Also refused: anything not a JPEG/PNG photo, a turn other than 90/180/270, or a path outside the worker's folder or not a `.jpg`.
- The row becomes the upright JPEG. The replaced file is owed to `storage_deletions`, the GDPR purge queue, so no second copy of a passport lingers.
- Audited as `document.turned_upright` (from, to, degrees, by `ai` | `office`).

## Consequences

- One extra AI read, only for a photo the first read says is turned.
- Re-encoding is JPEG quality 90, so a turned photo is a very slightly re-compressed copy of the worker's upload. The original is purged once replaced.
- `sharp` is now a direct dependency of both apps. It was already installed as Next.js's image library; same version, no new package.
- Not done: a viewer that shows the photo inside the Back Office (View still opens the file in a new tab), and turning a document after it has been verified.
