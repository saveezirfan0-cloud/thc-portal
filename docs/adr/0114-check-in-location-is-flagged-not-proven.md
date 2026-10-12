# ADR-0114 · A check-in location is flagged, not proven

**Status:** Accepted · Adds a chip to `wireframes/office/checkin.html` · §5.1, §5.2, §9.5 · Security round 12.10.2026, Staff App M2 · DB side: `20261012121200`

## Context

The Staff App is a web page (ADR-0001). The point it sends with a check-in, a check-out or a ping is whatever the browser's Geolocation API returns, and a browser can be told to return anything: devtools' location override, a mock-location app, a pasted coordinate in a forged server-action call. The venue's centre is on the worker's own shift screen. Nothing a page does can prove where the phone is, and §5.1 decides check-in on the geofence alone, so a worker at home could check in, be paid the shift, and leave no trace.

Times were never the problem: every stamp is the database's `now()`.

## Decision

- **Every fix carries its accuracy.** The app sends `coords.accuracy` (metres) as `p_accuracy` with `attempt_check_in`, `check_out` and `record_ping`; the database stores it (`check_logs.accuracy_m`, `check_out_accuracy_m`, `location_pings.accuracy_m`).
- **The database flags, it never refuses.** `check_logs.location_suspect` is set when a fix has no accuracy, an accuracy wider than the venue's geofence, or lands within 1 m of the venue's centre (a coordinate nobody's phone produces). §5.1's decision is unchanged: a refusal would turn a weak GPS signal in a basement venue into a worker who cannot start their shift.
- **The office sees it.** The Check-in monitor shows an amber "Location unverified" pill beside the check-in time of a flagged arrival (`checkin_monitor_v.location_suspect`). The wireframe has no such chip; it is the only visual change.
- **Pings are rate-limited.** A ping within 20 seconds of the booking's previous one is answered `too_soon` and stored nowhere, so a script cannot flood the trail.

## Consequences

- A determined worker can still fake a plausible fix with a plausible accuracy. This makes the cheap fakes visible to the manager on the day; it does not make them impossible. Proof needs the native shell's attested location (ADR-0001's Capacitor path), which is not built.
- A worker with a genuinely poor fix is flagged too. The pill says "unverified", not "false", and changes nothing about pay or status on its own.
