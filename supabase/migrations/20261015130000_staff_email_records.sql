-- =====================================================================
-- /staff/roster "Emails staff receive": the records behind each number
-- (ADR-0144; owner request, 15.10.2026)
--
-- staff_email_report() (20261015100000) gives the counts. The owner asked
-- to click a count and see the records behind it: who, when, and for one
-- not delivered, why.
--
-- staff_email_records(p_id, p_kind, p_limit, p_offset) — the rows behind
-- one count, a page at a time, with the total:
--   p_id    'IR1' or 'OC1:existing_first' | …_second | …_repeat | …_notice
--           (staff_email_report()'s ids; anything else is refused);
--   p_kind  sent_today  sent (UK) today, latest first;
--           sent        every one sent, latest first;
--           people      one row per address it reached: how many, the last;
--           failed      not delivered (a bounce, a refused address, or
--                       cancelled before it went), latest first, with why;
--           queued      waiting to send, soonest first.
-- Each row: the address, the person (their staff record when the email
-- names one, or whose address it is; for IR1, the name on the invite list),
-- when, and the error for a failed one (first 300 characters).
--
-- Office logins only, the viewer included: it reads, it changes nothing.
-- pgTAP: supabase/tests/843_staff_email_records.sql.
-- =====================================================================

create or replace function public.staff_email_records(
  p_id     text,
  p_kind   text,
  p_limit  integer default 100,
  p_offset integer default 0,
  p_now    timestamptz default now()
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_today  date    := uk_local(p_now)::date;
  v_limit  integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_out    jsonb;
begin
  perform assert_office_caller();
  if p_id is null or p_id not in ('IR1', 'OC1:existing_first', 'OC1:existing_second',
                                  'OC1:existing_repeat', 'OC1:existing_notice') then
    raise exception 'unknown_email' using errcode = '22023';
  end if;
  if p_kind is null or p_kind not in ('sent_today', 'sent', 'people', 'failed', 'queued') then
    raise exception 'unknown_kind' using errcode = '22023';
  end if;

  with o as (
    select x.id, lower(btrim(x.recipient_emails[1])) as email, x.recipient_staff_id,
           x.payload ->> 'name' as payload_name,
           x.sent_at, x.failed_at, x.send_after, x.queued_at, x.error
      from notification_outbox x
     where case when p_id = 'IR1'
                then x.template = 'IR1'
                else x.template = 'OC1'
                     and x.payload ->> 'variant' = substr(p_id, length('OC1:') + 1)
           end
  ), picked as (
    select o.*,
           case p_kind when 'failed' then o.failed_at
                       when 'queued' then o.send_after
                       else o.sent_at end as at
      from o
     where case p_kind
             when 'sent_today' then o.sent_at is not null and uk_local(o.sent_at)::date = v_today
             when 'sent'       then o.sent_at is not null
             when 'people'     then o.sent_at is not null
             when 'failed'     then o.failed_at is not null
             when 'queued'     then o.sent_at is null and o.failed_at is null
           end
  ), grouped as (
    -- `people`: one row per address; otherwise one row per email.
    select case when p_kind = 'people' then null else p.id end as id,
           p.email,
           (array_agg(p.recipient_staff_id) filter (where p.recipient_staff_id is not null))[1] as staff_id,
           (array_agg(p.payload_name order by p.at desc))[1] as payload_name,
           max(p.at) as at,
           count(*) as times,
           (array_agg(p.error order by p.at desc))[1] as error
      from picked p
     group by case when p_kind = 'people' then null else p.id end, p.email
  ), named as (
    select g.*,
           coalesce(s.id, s2.id) as person_id,
           coalesce(nullif(btrim(coalesce(s.first_name, '') || ' ' || coalesce(s.last_name, '')), ''),
                    nullif(btrim(coalesce(s2.first_name, '') || ' ' || coalesce(s2.last_name, '')), ''),
                    nullif(btrim(coalesce(r.first_name, '') || ' ' || coalesce(r.last_name, '')), ''),
                    nullif(btrim(g.payload_name), '')) as name
      from grouped g
      left join staff s on s.id = g.staff_id
      left join lateral (
        select st.id, st.first_name, st.last_name from staff st
         where g.staff_id is null and lower(btrim(st.email)) = g.email and st.removed_at is null
         order by st.created_at desc limit 1
      ) s2 on true
      left join invite_roster r on r.email = g.email
  )
  select jsonb_build_object(
    'id', p_id,
    'kind', p_kind,
    'total', (select count(*) from named),
    'limit', v_limit,
    'offset', v_offset,
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'email', n.email,
               'staffId', n.person_id,
               'name', n.name,
               'at', n.at,
               'times', n.times,
               'error', case when p_kind = 'failed' then left(n.error, 300) end)
             order by n.ord)
        from (
          select named.*,
                 row_number() over (order by
                   case when p_kind = 'queued' then named.at end asc,
                   case when p_kind <> 'queued' then named.at end desc,
                   named.email) as ord
            from named
           order by ord
           offset v_offset limit v_limit
        ) n), '[]'::jsonb)
  ) into v_out;

  return v_out;
end $$;

comment on function public.staff_email_records(text, text, integer, integer, timestamptz) is
  'ADR-0144, /staff/roster "Emails staff receive": the records behind one count — p_id IR1 or OC1:existing_*, p_kind sent_today | sent | people | failed | queued — a page at a time (p_limit ≤ 500) with the total: address, the person (staff record, or the invite-list name), when, how many (people), and why for one not delivered. Office logins only.';

revoke all on function public.staff_email_records(text, text, integer, integer, timestamptz) from public, anon;
grant execute on function public.staff_email_records(text, text, integer, integer, timestamptz) to authenticated, service_role;
