-- =====================================================================
-- Three duplicate indexes (audit 24.09 §4, seen on the live DB)
--
-- Each pair indexes the same columns in the same order; the second of each
-- was added by a later migration with `create index if not exists` under a
-- different name, so the guard never fired. A duplicate costs a write on
-- every insert/update of a hot table (bookings above all) and buys nothing.
--
-- The OLDER index of each pair is kept:
--
--   bookings (staff_id, status)
--     keep  bookings_staff_id_status_idx     (0001_init, auto-named)
--     drop  bookings_staff_status_idx        (20260922094500_staff_profile)
--   client_rate_cards (client_id)
--     keep  client_rate_cards_client_id_idx  (20260922091447_clients_directory)
--     drop  client_rate_cards_client_idx     (20260922095200_client_card)
--   feedback (staff_id)
--     keep  feedback_staff_id_idx            (20260921123503_db_hardening)
--     drop  feedback_staff_idx               (20260922094500_staff_profile)
--
-- `if exists`, because an environment built before one of those migrations
-- may never have had the later name.
-- =====================================================================

drop index if exists public.bookings_staff_status_idx;
drop index if exists public.client_rate_cards_client_idx;
drop index if exists public.feedback_staff_idx;
