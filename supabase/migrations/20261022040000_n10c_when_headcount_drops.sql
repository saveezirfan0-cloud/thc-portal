-- =====================================================================
-- N10c when the office lowers a role's headcount to what is confirmed
--
-- §8 N10c: "the moment the role becomes fully confirmed and drops off the
-- event board (§3.3)". close_filled_role_applications() (20260930110200)
-- is that one trigger, but only accept_application() and accept_invite()
-- called it — the two ways a CONFIRMATION fills a role. A role also
-- becomes full when the office lowers its headcount to the number already
-- confirmed (the client wants fewer people). Radar then stops offering
-- the section and accept_application() answers `full`, yet every pending
-- application on it stayed `applied`: the worker kept an Applied card
-- that could never be taken forward and was told nothing until RULE-16
-- dropped it at the section's end — the D39 gap (ADR-0037) by another
-- door.
--
-- A row trigger on shift_requirements, so every write path (the event
-- save, the Shift Builder, a service-role fix) is covered without a
-- caller having to remember it. Only a DECREASE can fill a role;
-- close_filled_role_applications() itself decides whether the section is
-- now full (confirmed-or-worked >= headcount, the one Radar threshold of
-- ADR-0037) and closes nothing otherwise. Its N10c key is per application
-- (applied_at), so nothing is told twice.
-- =====================================================================

create or replace function public.shift_requirements_close_filled_applications()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if new.headcount < old.headcount then
    perform close_filled_role_applications(new.id);
  end if;
  return null;
end $$;

comment on function public.shift_requirements_close_filled_applications() is
  '§8 N10c: a role whose headcount the office lowers to what is already confirmed is full, so its pending Radar applications close (closed / slot_taken) with N10c, as when a confirmation fills it (close_filled_role_applications, 20261022040000).';

revoke execute on function public.shift_requirements_close_filled_applications() from public, anon, authenticated;

drop trigger if exists shift_requirements_close_filled_applications on public.shift_requirements;
create trigger shift_requirements_close_filled_applications
  after update of headcount on public.shift_requirements
  for each row
  when (new.headcount < old.headcount)
  execute function public.shift_requirements_close_filled_applications();
