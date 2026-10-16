# 21 · Keeping a worker away from a client

_Back Office guide · “Do not return”, including a worker who is not qualified there. Version 1.0 · 16.10.2026 · Scope v1.6 §9.6._

Generated from `packages/pdf/scripts/guide-do-not-return.mjs` together with `docs/pdfs/THC-Guide-Do-Not-Return.pdf`. Edit the script, not this file.

## The short answer

To stop a worker being offered a client’s shifts, switch **Do not return** on for that client. It is the only hard gate in client qualification. Removing a qualification is not the same thing, and a worker who was never qualified at the client has nothing to remove.

The switch lives on a client qualification row, so a worker with no row for the client has no switch yet. The fix is two steps: **add the client to the worker (any one of their roles), then switch Do not return on for that row.** The bar overrides the qualification. Adding the row does not make them first choice for anything.

## Which control do I need?

| Control | Where | What it does | Use it when |
| --- | --- | --- | --- |
| **Do not return** | Profile > Client qualification, or client card > Qualified staff | Excluded from this client outright: not invited in either wave, shift never on their Radar, cannot be invited manually. Needs a reason. | A client has asked for someone not to come back, or you decide they should not. |
| Remove | Same row | Takes the worker out of Wave 1 (first choice) for that client and role only. A later clean shift can grant it again. | The worker should no longer be a first-choice name. Not a bar. |
| Block | Profile (header) | Bars the worker everywhere, from every client. | The worker should not be booked at all. |

## Steps: the worker is not qualified at the client

1. Open **Staff**, then the worker’s profile, then the **Client qualification** tab.
2. Click **+ Add client**. Choose the client from the directory. If it is not listed, create it under **Clients** first.
3. Tick **one** of the worker’s roles (the list offers only roles they already hold). One is enough: the bar covers every role at that client. Leave the note empty: the reason you give in step 6 is saved in the note and replaces anything typed here.
4. Click **Add**. A row for the client appears with Do not return off.
5. On that row, switch **Do not return** on. A dialog opens.
6. Type the **Reason** (required). Write what the next person needs to decide whether to lift it: who asked, when, and why if known. It is shown on that client’s events under *Unavailable > Do not return*, appears in the row’s Note column, and is kept if the flag is ever switched off.
7. Click **Do not return**. The row turns red and its **Remove** button is disabled.
8. Check the worker’s **Shifts** tab and open invitations for the client, and withdraw anything already in place (see “What it does not do”).

> **Already qualified?** Skip steps 2–4. Open the existing row and switch Do not return on. The same switch is on the client card under **Qualified staff** if you are starting from the client’s side.

## Worked example: Jonathan Ryder at Mandarin Oriental

Mandarin Oriental has asked that Jonathan Ryder does not return. He has no qualification there. On his profile the tab lists only United Grand Lodge (Waiting Staff and Waiting Staff (UGLE)), so there is no Mandarin Oriental row and no switch.

| Field | Value |
| --- | --- |
| Worker | Jonathan Ryder · THC-06096 |
| Client | Mandarin Oriental |
| Role to tick | Waiting Staff (either of his two roles works; the bar is client-wide) |
| Reason (example) | Mandarin Oriental asked that he does not return. Request received DD.MM.YYYY from [name]. Replace with the real date, contact and reason. |
| Result | Not offered Mandarin Oriental shifts in either wave, never on his Radar, cannot be invited manually. |
| His United Grand Lodge rows | Untouched. The bar is per client. |

## What it does

- **Auto-assign:** the worker is filtered out as `do_not_return` before scoring, so they appear in neither Wave 1 nor Wave 2. The check is any row for that worker and client carrying the flag, whatever its role.
- **Radar:** the client’s shifts never appear to them.
- **Manual invites:** the office cannot invite them to that client’s events.
- **One switch, all rows:** the flag is stored per row, but switching it moves every row the worker has at that client together.
- **Audit:** switching on and off is written to the audit log with the reason.
- **Safe from a mis-click:** while it is on, Remove is disabled, so nobody can delete the row and quietly un-bar the worker.

## What it does not do

- **It does not withdraw anything already in place.** The function only sets the flag and writes the audit row. An invitation already sent, or a booking already made, at that client stays until you withdraw or cancel it by hand.
- **It does not tell the worker.** The action sends no notification. Tell them yourself if that is appropriate.
- **It does not affect other clients.** For a bar everywhere use Block on the profile.

## Lifting it later

1. Open the worker’s Client qualification tab, or the client card under Qualified staff.
2. Switch **Do not return** off. No reason is needed, and the old reason is kept.
3. If the row was only there to carry the bar, you may now **Remove** it. Remove asks for confirmation.

## If something does not work

| You see | Why | What to do |
| --- | --- | --- |
| The role list is empty or missing the role you want | It offers only roles the worker already holds. | Add the role on the profile Overview first, or tick another role they hold. |
| Buttons are greyed out | The profile has been removed (GDPR), or you are signed in as a read-only viewer. | A removed profile cannot be edited. Ask an office admin if you only have viewer access. |
| The dialog will not confirm | The reason is empty. | Enter a reason. It is required. |
| Remove is disabled on the row | Do not return is on. | Switch it off first. This is intended. |
| The worker still sees a Mandarin Oriental shift | It was offered or booked before the bar. | Withdraw the invitation or cancel the booking by hand. |

> **Known quirk:** on main today the tab has no way to bar a worker who has no row at that client, hence the add-then-bar workaround above. A direct **Bar from a client** button is proposed in PR #253 (ADR-0146). Once that is merged and deployed, use it instead of steps 2–4, and regenerate this guide.

## Quick reference for any worker and client

1. Staff > worker > Client qualification.
2. No row for the client? **+ Add client** > client > one role > Add.
3. Switch **Do not return** on > enter the reason > confirm.
4. Withdraw any invitation or booking already in place at that client.
