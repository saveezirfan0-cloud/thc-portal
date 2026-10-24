# ADR-0216 · Rotate opens the document in a preview window

**Status:** Accepted (ticket TK-30, Sam Barrington-Wells, 24.10.2026: "Unable to view the passport as you rotate it, making it very difficult to rotate - need to be able to view as its rotated"). Amends ADR-0212 and ADR-0214.

## Context

**Rotate ↻** on a Needs review row (ADR-0212) turned the file a quarter clockwise on every press and saved it at once. The reviewer could not see the document while doing it, so had to press, open **View** in a new tab, look, and press again — each press a new saved file.

## Decision

- **Rotate ↻** opens the document in a window ("Turn the document the right way up"): a photo as an image, a PDF in the browser's own viewer.
- **↺ Left** and **Right ↻** turn the preview a quarter at a time; nothing is saved while turning. A line reads "As uploaded" or "Turned 90° clockwise — press Save to keep it".
- **Save** writes the net turn once — 90, 180 or 270 clockwise — through the same `rotateDocument()` action and `turn_document_upright()` (which already accepted all three). Save is disabled until the picture has been turned; **Cancel** changes nothing.
- The toast reads "Saved the right way round."

## Consequences

- One saved file per correction instead of up to three.
- No database change: `turn_document_upright()` and its audit (`degrees`) already covered a half and three-quarter turn.
- A PDF's preview is the whole viewer turned, as the browser draws it; the saved PDF turns every page by its /Rotate (ADR-0214).
