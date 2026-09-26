-- =====================================================================
-- Record history — the audit trail of ONE record (§1.7, ADR-0049)
--
-- /activity reads the whole of audit_log. The staff profile, the client
-- card and the event board each want the same trail cut down to the
-- record on screen, and a record's history is more than the rows whose
-- entity_id is its own id: most of what happens to a worker is written
-- against one of their documents or bookings, and an event's bookings
-- carry the invitations and accepts. So this function takes a record and
-- gathers the rows that belong to it.
--
-- What each record's history includes, and why:
--
--   staff  · every row written against the staff record itself
--            (application, accept, block, unblock, reset, GDPR removal,
--            contract, right to work, opt-out, Willo);
--          · its compliance_docs rows (uploads, verifications, gov.uk
--            checks) — matched by the document's id while the document
--            exists AND by `data.staffId`, because §1.7's removal deletes
--            the documents but keeps the trail about them;
--          · its booking rows (manual invites, accepted applications,
--            rota-guard warnings) — by booking id and `data.staffId`;
--          · its client_qualification rows (Do not return on / off),
--            which carry `data.staffId`.
--   event  · every row written against the event (today: its
--            cancellation, with the reason and how many bookings went);
--          · the booking rows of every role section on it.
--   client · every row written against the client itself;
--          · the event-level rows of its events — today that is each
--            cancellation, which is the thing about an event a manager
--            looking at the CLIENT needs (who cancelled on them, why).
--            The bookings on those events are NOT included: hundreds of
--            invitations per event would bury the client's own trail,
--            and each event's board has them;
--          · its client_qualification rows (Do not return for one of its
--            workers, `data.clientId`);
--          · its Client Portal logins (invited, re-invited, switched off /
--            on) — by the login's profile and by `data.clientId`, since
--            the invite row is written before a profile could be moved.
--   anything else · the rows written against that entity and id only.
--
-- The columns are admin_activity's, so the screens reuse its view model.
-- Admin only; security definer because profiles is self-read and the
-- label joins read rows an office RLS policy would also allow — the role
-- check in the body is the gate. Keyset paging on id, like /activity.
-- =====================================================================

create or replace function public.admin_record_history(
  p_entity text,
  p_id     uuid,
  p_limit  int    default 100,
  p_before bigint default null
) returns table (
  id           bigint,
  at           timestamptz,
  actor        uuid,
  actor_name   text,
  action       text,
  entity       text,
  entity_id    uuid,
  entity_label text,
  data         jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit int  := least(greatest(coalesce(p_limit, 100), 1), 200);
  v_key   text := p_id::text;
  v_ids   bigint[];
begin
  if current_app_role() is distinct from 'admin' then
    raise exception 'not_authorised' using errcode = '42501';
  end if;
  if p_entity is null or p_id is null then
    return;
  end if;

  if p_entity = 'staff' then
    select coalesce(array_agg(distinct x.id), '{}') into v_ids from (
      select a.id from audit_log a
       where a.entity = 'staff' and a.entity_id = p_id
      union all
      select a.id from audit_log a
       where (a.data ->> 'staffId') = v_key
         and a.entity in ('compliance_docs', 'booking', 'client_qualification', 'staff')
      union all
      select a.id from audit_log a join compliance_docs cd on cd.id = a.entity_id
       where a.entity = 'compliance_docs' and cd.staff_id = p_id
      union all
      select a.id from audit_log a join bookings b on b.id = a.entity_id
       where a.entity = 'booking' and b.staff_id = p_id
      union all
      select a.id from audit_log a join client_qualifications q on q.id = a.entity_id
       where a.entity = 'client_qualification' and q.staff_id = p_id
    ) x where p_before is null or x.id < p_before;

  elsif p_entity = 'event' then
    select coalesce(array_agg(distinct x.id), '{}') into v_ids from (
      select a.id from audit_log a
       where a.entity = 'event' and a.entity_id = p_id
      union all
      select a.id from audit_log a
        join bookings b on b.id = a.entity_id
        join shift_requirements sr on sr.id = b.shift_id
       where a.entity = 'booking' and sr.event_id = p_id
    ) x where p_before is null or x.id < p_before;

  elsif p_entity = 'client' then
    select coalesce(array_agg(distinct x.id), '{}') into v_ids from (
      select a.id from audit_log a
       where a.entity = 'client' and a.entity_id = p_id
      union all
      select a.id from audit_log a join events ev on ev.id = a.entity_id
       where a.entity = 'event' and ev.client_id = p_id
      union all
      select a.id from audit_log a
       where a.entity in ('client_qualification', 'account') and (a.data ->> 'clientId') = v_key
      union all
      select a.id from audit_log a join client_qualifications q on q.id = a.entity_id
       where a.entity = 'client_qualification' and q.client_id = p_id
      union all
      select a.id from audit_log a join profiles pr on pr.id = a.entity_id
       where a.entity = 'account' and pr.client_id = p_id
    ) x where p_before is null or x.id < p_before;

  else
    select coalesce(array_agg(a.id), '{}') into v_ids
      from audit_log a
     where a.entity = p_entity and a.entity_id = p_id
       and (p_before is null or a.id < p_before);
  end if;

  return query
    with page as (
      select a.*
        from audit_log a
       where a.id = any (v_ids)
       order by a.id desc
       limit v_limit
    )
    select pg.id, pg.at, pg.actor,
           ap.full_name,
           pg.action, pg.entity, pg.entity_id,
           case pg.entity
             when 'staff'           then (select st.first_name || ' ' || st.last_name from staff st where st.id = pg.entity_id)
             when 'compliance_docs' then coalesce(
                                           (select st.first_name || ' ' || st.last_name || ' · ' || replace(cd.doc_type::text, '_', ' ')
                                              from compliance_docs cd join staff st on st.id = cd.staff_id where cd.id = pg.entity_id),
                                           replace(pg.data ->> 'docType', '_', ' '))
             when 'event'           then (select ev.title from events ev where ev.id = pg.entity_id)
             when 'booking'         then (select st.first_name || ' ' || st.last_name || ' · ' || ev.title
                                            from bookings b join staff st on st.id = b.staff_id
                                            join shift_requirements sr on sr.id = b.shift_id
                                            join events ev on ev.id = sr.event_id where b.id = pg.entity_id)
             when 'client_qualification' then (select st.first_name || ' ' || st.last_name || ' · ' || cl.name || ' · ' || r.name
                                                 from client_qualifications q join staff st on st.id = q.staff_id
                                                 join clients cl on cl.id = q.client_id
                                                 join roles r on r.id = q.role_id where q.id = pg.entity_id)
             when 'account'         then (select pr.full_name from profiles pr where pr.id = pg.entity_id)
             when 'client'          then (select cl.name from clients cl where cl.id = pg.entity_id)
             when 'settings'        then pg.data ->> 'key'
           end,
           pg.data
      from page pg
      left join profiles ap on ap.id = pg.actor
     order by pg.id desc;
end;
$$;

comment on function public.admin_record_history(text, uuid, int, bigint) is
  'History tab / block on /staff/:id, /clients/:id and /events/:id: audit_log rows for one record AND the rows that belong to it (a worker''s documents, bookings and Do-not-return entries; an event''s bookings; a client''s event cancellations, Do-not-return entries and portal logins). Same columns as admin_activity; newest first, keyset paging on id; at most 200 rows a call. Admin only.';

revoke all on function public.admin_record_history(text, uuid, int, bigint) from public, anon;
grant execute on function public.admin_record_history(text, uuid, int, bigint) to authenticated;

-- One record's own rows: (entity, entity_id) — the 20260930210000 index
-- is (entity, id) and would walk every row of that entity.
create index if not exists audit_log_entity_ref_idx on audit_log (entity, entity_id, id desc);
-- A worker's related rows by the staffId every document, booking and
-- qualification entry carries — the only link left once §1.7 has
-- deleted the documents themselves.
create index if not exists audit_log_data_staff_idx on audit_log ((data ->> 'staffId'), id desc)
  where (data ->> 'staffId') is not null;
