# ADR-0207 · A Check-out column on the live monitor

**Status:** Accepted (request of THC, 24.10.2026) · `/checkin` · scope §9.5 (adds a column to its table)

## Context

§9.5 lists the live monitor's columns as Staff · Event · Window · Check-in · Breaks · Status. The check-out time had no column of its own: it rode on the Status pill as "Checked out 21:03", in the pill's small type, beside "Send push" and the late sign-out line. THC told us the check-in and check-out times are the readings they watch most on the day, and the check-out was hard to find under Status.

## Decision

1. A **Check-out** column between Check-in and Breaks: the recorded finish, in the viewer's own zone like the check-in stamp (§1.8, an actual stamp), with a second line saying how it sat against the role section's end (RULE-18): "on time", "20 min before the end", "35 min past the end". Facts only — a Left early is still the violation log's call, and a late sign-out's flag and Verify stay under the Status pill (ADR-0184).
2. It shows a time only once the row is **Checked out**. On shift and not yet arrived read "—"; so does a **No check-out**, even where the log row holds a recorded time, because RULE-02 never defaults a finish and the office has not entered one yet.
3. The Status pill reads plain **"Checked out"**: the time has moved, not doubled. Its colour rules are unchanged (red until a late sign-out is verified, ADR-0184).
4. **Check-in and Check-out stand out as a pair:** cyan column headings, a faint cyan ground (`--cyan-dim-soft`) on both cells, and the time itself set a size up (`--fs-19`) and bold in the number face. On a phone, where the table becomes cards, each stamp is a tinted band in the card. Tokens only; red stays on the pills.

## Consequences

- The table is one column wider; it already scrolls inside its card below its minimum width.
- The wireframe (`backoffice/checkin.html`) and `docs/08-screen-inventory.md` carry the new column.
