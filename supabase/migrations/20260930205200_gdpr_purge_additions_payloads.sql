-- =====================================================================
-- Migration 20260930205200 · GDPR removal reaches the additions' outbox
--                            payloads and the office's decline note
--   §1.7 · docs/19 §0.7 · ADR-0044 (RC1–RC4) · ADR-0045 (OF5, OF6)
--   security review #3, QA S4
--
-- staff_removed_purge_additions (20260930200100) anonymised the rows the
-- additions keep, but not the copies of the same words that had already
-- been written elsewhere:
--
--   notification_outbox  RC1:request:<id>  name, current, proposed, note
--                        RC3:request:<id>  reason (the office's rejection,
--                                          which the request row already
--                                          replaces because it names them)
--                        RC4:request:<id>  name, previousName
--                        OF5:offer:<id>    name, note (the worker's cover
--                        OF5:booking:<id>  note — possibly health
--                                          information). Both key shapes:
--                                          20260930205000 moves new OF5
--                                          keys to the booking.
--   shift_offers         closed_reason on a cover request the office
--                        declined holds the office's free-text note
--                        (office_decline_cover: coalesce(note, 'declined
--                        by the office')).
--
-- What happens to those outbox rows:
--   * `name` and `previousName` become "Deleted account #<employee id>",
--     the §1.7 convention every history row already uses, so a rendered
--     subject or body never shows a bare {name} placeholder.
--   * `current`, `proposed`, `note` and `reason` are removed.
--   * A row not yet sent (sent_at and failed_at both null — queued, held
--     for a missing key, or leased to a drain run) is failed now with
--     error 'gdpr_removed'. claim_outbox_batch() only takes rows with
--     failed_at null, and complete_outbox_send() only settles them, so it
--     is never sent: the office does not need a change request or a cover
--     request from somebody it has just removed. A sent row keeps its
--     sent_at — it is history (§9.9 counts read it).
--   The ids and employeeId stay: they carry no personal data, and the
--   employee id is what "Deleted account #id" is made of.
--
-- What does not happen: audit_log is NOT rewritten. It is append-only by
-- design (0009_view_privileges_and_ping_integrity, 20260923100100 — "admin-
-- read and append-only"; ADR-0043 and ADR-0044: "the table row is deleted
-- on GDPR removal, and audit_log is not"). The existing
-- shift_offer.cover_declined rows that carry a `note` stay as written;
-- the writer stops putting the note there going forward (another change),
-- and the note's other copy, shift_offers.closed_reason, is cleared here.
--
-- Everything else in the function is unchanged: same trigger, same WHEN
-- clause (fires once, when removed_at is first set), same security
-- definer, same revokes. remove_worker() is still not restated.
--
-- With main's 20260930120100 (§1.7 audit D9; re-checked when this file
-- was re-stamped after it). remove_worker() now scrubs the outbox itself.
-- Its block_worker(…, 'removed', …) call sets removed_at first, so this
-- trigger fires first and remove_worker()'s own scrub runs after it:
--
--   * it matches rows by recipient, by the worker's own ids in the key
--     (staff, bookings, documents, declarations, applications, quiz,
--     rtw checks) and by the id, email or NI number in the payload; it
--     DELETES unsent matches and replaces a sent match's payload with
--     {gdprRemoved, label}. That is the stronger treatment, and it takes
--     every addition row addressed to the worker (RC2, RC3, OF1–OF4, OF6)
--     and OF5:booking:<id>.
--   * it does not collect profile_change_requests or shift_offers ids, and
--     the admin@ copies (RC1:request, RC4:request, OF5:offer) carry the
--     worker's NAME, not their id or email — so those are left to this
--     trigger, which anonymises them and fails any still unsent.
--
-- The two never fight. What this trigger anonymises carries no id, email
-- or NI number of the worker's for remove_worker() to match; where both
-- match (OF5:booking:<id>), remove_worker() runs second and its treatment
-- stands — an unsent row this trigger failed is then deleted (sent_at is
-- still null), a sent one replaced by {gdprRemoved, label}.
--
-- audit_log: remove_worker() now strips personal keys from rows about the
-- worker (main's decision in 20260930120100, superseding the append-only
-- note below for §1.7). The additions write none into it: ids, kinds,
-- changed field NAMES, has_note. This trigger still writes nothing there.
--
-- Forward-only. References 20260930200100, 20260930201100,
-- 20260930202200 and 20260930203000 objects only; matches the OF5 key
-- shape 20260930205000 introduces by string, so it does not depend on it.
-- =====================================================================

-- ---------------------------------------------------------------------
-- GDPR removal (§1.7) — staff_removed_purge_additions, restated
--
--   staff_unavailability      deleted
--   staff_emergency_contacts  deleted
--   profile_change_requests   pending → withdrawn; proposed names become
--                             "Deleted account"; note, snapshot and reason
--                             text cleared (the reason is replaced, because
--                             a rejection must carry one). The Storage
--                             objects go with the <staff_id>/ prefix purge.
--   staff_referral_codes      revoked; the code is never reissued
--   application_referrals     kept — the removed worker reads "Deleted
--                             account #id" through the anonymised staff row
--   shift_offers              any still open by or to the worker lapse
--                             (closed_reason gdpr); the note is cleared;
--                             the office's free-text decline note on their
--                             cover requests becomes 'gdpr'          (new)
--   shift_offer_notices       kept (who was pushed what: no personal data)
--   notification_outbox       RC1 / RC3 / RC4 / OF5 for their requests,
--                             offers and bookings: names → "Deleted
--                             account #id", free text removed, unsent
--                             rows failed 'gdpr_removed'             (new)
--   audit_log                 untouched here (remove_worker() strips
--                             personal keys; the additions' rows have none)
-- ---------------------------------------------------------------------
create or replace function public.staff_removed_purge_additions()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_label text := deleted_account_label(new.employee_id);
begin
  delete from staff_unavailability     where staff_id = new.id;
  delete from staff_emergency_contacts where staff_id = new.id;

  update profile_change_requests
     set status              = case when status = 'pending' then 'withdrawn' else status end,
         proposed_first_name = case when proposed_first_name is not null then 'Deleted' end,
         proposed_last_name  = case when proposed_last_name  is not null then 'account' end,
         worker_note         = null,
         previous_value      = null,
         decision_reason     = case when decision_reason is not null
                                    then 'Removed under GDPR (§1.7)' end
   where staff_id = new.id;

  update staff_referral_codes
     set revoked_at = coalesce(revoked_at, new.removed_at)
   where staff_id = new.id;

  update shift_offers
     set status = 'lapsed', closed_reason = 'gdpr', closed_at = new.removed_at
   where status = 'open'
     and (offered_by_staff_id = new.id or target_staff_id = new.id);

  update shift_offers set note = null
   where offered_by_staff_id = new.id and note is not null;

  -- The office's decline note (office_decline_cover) is the only free text
  -- closed_reason carries; every other writer sets a snake_case code
  -- (taken, withdrawn_by_worker, expired, gdpr, a booking cancel_cause or
  -- status). The default 'declined by the office' names nobody and stays.
  update shift_offers set closed_reason = 'gdpr'
   where offered_by_staff_id = new.id
     and closed_reason is not null
     and closed_reason not in ('gdpr', 'declined by the office')
     and (status = 'cancelled' or closed_reason !~ '^[a-z_]+$');

  -- The outbox copies. Keys are unique, so the join is by exact key.
  with k (key) as (
    select 'RC1:request:' || r.id::text from profile_change_requests r where r.staff_id = new.id
    union all
    select 'RC3:request:' || r.id::text from profile_change_requests r where r.staff_id = new.id
    union all
    select 'RC4:request:' || r.id::text from profile_change_requests r where r.staff_id = new.id
    union all
    select 'OF5:offer:'   || o.id::text from shift_offers o where o.offered_by_staff_id = new.id
    union all
    select 'OF5:booking:' || b.id::text from bookings b where b.staff_id = new.id
  )
  update notification_outbox n
     set payload = (n.payload - array['current', 'proposed', 'note', 'reason'])
                   || case when n.payload ? 'name'
                           then jsonb_build_object('name', v_label) else '{}'::jsonb end
                   || case when n.payload ? 'previousName'
                           then jsonb_build_object('previousName', v_label) else '{}'::jsonb end,
         failed_at = case when n.sent_at is null and n.failed_at is null
                          then now() else n.failed_at end,
         error     = case when n.sent_at is null and n.failed_at is null
                          then 'gdpr_removed: not sent, the worker was removed (§1.7)'
                          else n.error end
    from k
   where n.key = k.key
     and n.template in ('RC1', 'RC3', 'RC4', 'OF5');

  return null;
end $$;

drop trigger if exists staff_removed_purge_additions on staff;
create trigger staff_removed_purge_additions
  after update of removed_at on staff
  for each row
  when (old.removed_at is null and new.removed_at is not null)
  execute function staff_removed_purge_additions();

comment on function public.staff_removed_purge_additions() is
  '§1.7 GDPR removal for the docs/19 additions: deletes availability and the emergency contact, withdraws and anonymises change requests, revokes the referral code, lapses open offers and clears the office''s free-text decline note, and anonymises the RC1/RC3/RC4/OF5 outbox payloads (names → "Deleted account #id", free text removed, unsent rows failed gdpr_removed) that remove_worker()''s own scrub (20260930120100, which runs after this trigger and wins where both match) does not reach. Writes nothing to audit_log; the additions'' audit rows carry no personal data. Fires once, after removed_at is first set. A trigger function: not an RPC.';

-- Trigger functions are never RPCs (20260927161000, pgTAP 190).
revoke execute on function public.staff_removed_purge_additions() from public, anon, authenticated;
