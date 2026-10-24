-- Tickets (ADR-0202): Claude's own classification and time.
--
-- A ticket worked on in a code session is classified (fix / update / issue /
-- against_scope / addition) and its time logged — but a session has no Back
-- Office login, so set_ticket_scope() and log_ticket_time() (which need a
-- tracker's auth.uid()) are out of its reach. These two do the same writes for
-- the service role only, addressed by ticket number (TK-12 → 12):
--
--   · claude_set_ticket_scope(): sets the label and a one-line note. It never
--     overwrites a label a person set (updated_by is not null), only its own
--     earlier one, so the owner's word stands.
--   · claude_log_ticket_time(): one finished entry, worked_by 'claude',
--     billable following the label (against_scope / addition are billed) unless
--     said otherwise, logged_by null.
--
-- Neither is granted to an API role: the Supabase service role and the
-- database owner are the only callers.

create or replace function public.claude_set_ticket_scope(
  p_ticket_no integer,
  p_label     text,
  p_note      text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  t       tickets;
  v_label text := nullif(btrim(coalesce(p_label, '')), '');
  v_note  text := nullif(btrim(coalesce(p_note, '')), '');
  v_by    uuid;
begin
  select * into t from tickets where ticket_no = p_ticket_no;
  if t.id is null then
    raise exception 'unknown_ticket' using errcode = 'P0002';
  end if;
  if v_label is null or v_label not in ('fix', 'update', 'issue', 'against_scope', 'addition') then
    raise exception 'Choose a label from the list.' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'A scope note is at most 500 characters.' using errcode = '22023';
  end if;

  select s.updated_by into v_by from ticket_scope s where s.ticket_id = t.id;
  if found and v_by is not null then
    return jsonb_build_object('ticket', p_ticket_no, 'kept', true,
                              'label', (select label from ticket_scope where ticket_id = t.id));
  end if;

  insert into ticket_scope (ticket_id, label, note, updated_by, updated_at)
  values (t.id, v_label, v_note, null, now())
  on conflict (ticket_id) do update
     set label = excluded.label, note = excluded.note,
         updated_by = null, updated_at = excluded.updated_at;
  return jsonb_build_object('ticket', p_ticket_no, 'kept', false, 'label', v_label);
end $$;

comment on function public.claude_set_ticket_scope(integer, text, text) is
  'ADR-0202: Claude labels ticket TK-<n> fix / update / issue / against_scope / addition from a code session. Service role only. Never overwrites a label a person set.';

revoke all on function public.claude_set_ticket_scope(integer, text, text) from public, anon, authenticated;
grant execute on function public.claude_set_ticket_scope(integer, text, text) to service_role;

create or replace function public.claude_log_ticket_time(
  p_ticket_no integer,
  p_minutes   integer,
  p_note      text default null,
  p_billable  boolean default null,
  p_worked_on date default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  t       tickets;
  v_note  text := nullif(btrim(coalesce(p_note, '')), '');
  v_day   date := coalesce(p_worked_on, (now() at time zone 'Europe/London')::date);
  v_bill  boolean;
  v_id    bigint;
begin
  select * into t from tickets where ticket_no = p_ticket_no;
  if t.id is null then
    raise exception 'unknown_ticket' using errcode = 'P0002';
  end if;
  if p_minutes is null or p_minutes < 1 or p_minutes > 1440 then
    raise exception 'Time is between 1 minute and 24 hours.' using errcode = '22023';
  end if;
  if v_day > (now() at time zone 'Europe/London')::date then
    raise exception 'Time cannot be logged on a day that has not happened.' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'A note is at most 500 characters.' using errcode = '22023';
  end if;

  v_bill := coalesce(p_billable,
                     (select s.label in ('against_scope', 'addition')
                        from ticket_scope s where s.ticket_id = t.id),
                     false);
  insert into ticket_time (ticket_id, worked_by, worked_on, minutes, billable, note, logged_by)
  values (t.id, 'claude', v_day, p_minutes, v_bill, v_note, null)
  returning id into v_id;
  return jsonb_build_object('ticket', p_ticket_no, 'id', v_id, 'minutes', p_minutes, 'billable', v_bill);
end $$;

comment on function public.claude_log_ticket_time(integer, integer, text, boolean, date) is
  'ADR-0202: Claude logs finished time on ticket TK-<n> from a code session (worked_by claude). Billable follows the scope label unless given. Service role only.';

revoke all on function public.claude_log_ticket_time(integer, integer, text, boolean, date) from public, anon, authenticated;
grant execute on function public.claude_log_ticket_time(integer, integer, text, boolean, date) to service_role;
