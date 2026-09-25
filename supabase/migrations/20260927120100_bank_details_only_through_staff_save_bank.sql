-- =====================================================================
-- Bank details are written only through staff_save_bank() (§2.10, §10.1)
--
-- §2.10: changing bank details "triggers the same E5 notification as at
-- onboarding" — payroll is told in the same transaction as the write.
-- staff_save_bank() (20260922180000) and onboarding_save_bank()
-- (20260923120200) do exactly that, and validate the sort code (six digits)
-- and account number (eight) on the way in.
--
-- But 0004 also gave the worker direct INSERT and UPDATE policies on
-- bank_details, re-created in 20260921123503_db_hardening. With them, any
-- worker holding a session could PATCH their row through PostgREST: no E5,
-- no validation, and payroll paying into an account it was never told
-- about (audit 24.09 §3). The app never used that path — both screens call
-- the RPCs — so it was only ever a way round them.
--
-- Both RPCs are `security definer`, so they need no policy of the caller's.
-- The worker's own SELECT policy (staff_self_bank) stays: reading their own
-- details is §10.1 "Payment information", and it grants no write.
-- Forward-only: 0004 and 20260921123503 are left as they are.
-- =====================================================================

drop policy if exists staff_self_bank_insert on bank_details;
drop policy if exists staff_self_bank_update on bank_details;

comment on function public.staff_save_bank(text, text, text) is
  '§2.10/§10.1: the ONLY worker write path to bank_details (the direct self insert/update policies were dropped in 20260927120100). Validates sort code and account number and queues E5 to payroll in the same transaction.';
