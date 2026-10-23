-- Tickets (ADR-0202), two follow-ups.
--
-- 1 · Time and billing belong to named logins, not to "every Owner". The
--     list in settings.ticket_tracking_emails is now the only gate: an Owner
--     whose sign-in email is on it. An empty list means nobody — an owner
--     added later sees no scope label and no time until they are named.
--     Seeded with the two logins that keep the time: Sam and Saveez.
--
-- 2 · The person who reported a ticket is emailed when somebody else adds a
--     comment or note to it (TK1, variant reply, key TK1:reply:<comment id>),
--     as they already are for a resolution note. A trigger on
--     ticket_comments, so every path that writes a comment (add_ticket_comment,
--     update_ticket's note) is covered without restating those functions.
--     Not sent for the reporter's own comments, for a status / owner line
--     (kind change) or for a resolution note (its own email).

update public.settings
   set value = '["sam@thehospitalitycompany.co.uk","saveezirfan@gmail.com"]'::jsonb
 where key = 'ticket_tracking_emails'
   and (value is null or value = '[]'::jsonb);

create or replace function public.ticket_tracker_allowed()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce(
    office_can('users')
    and exists (
      select 1
        from auth.users u, public.settings s,
             lateral jsonb_array_elements_text(
               case when jsonb_typeof(s.value) = 'array' then s.value else '[]'::jsonb end) e
       where u.id = auth.uid() and s.key = 'ticket_tracking_emails'
         and btrim(e) <> '' and lower(btrim(e)) = lower(u.email)
    ), false)
$$;

comment on function public.ticket_tracker_allowed() is
  'ADR-0202: may this login see and keep ticket scope labels and time? An Owner office login whose sign-in email is on settings.ticket_tracking_emails; an empty list means nobody. False for everyone else, and for a session below its two-step level.';

revoke all on function public.ticket_tracker_allowed() from public, anon;
grant execute on function public.ticket_tracker_allowed() to authenticated, service_role;

create or replace function public.ticket_comment_tell_reporter()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  t       tickets;
  v_email text;
begin
  if new.kind <> 'comment' or new.body like 'Resolution: %' then
    return new;
  end if;

  select * into t from tickets where id = new.ticket_id;
  -- A reporter who has been removed (GDPR) has no id; nobody to tell. And
  -- nobody is emailed about their own comment.
  if t.id is null or t.reporter_id is null or t.reporter_id is not distinct from new.author_id then
    return new;
  end if;

  select lower(btrim(u.email)) into v_email from auth.users u where u.id = t.reporter_id;
  if v_email ~ '^[^\s@<>",]+@[^\s@<>",]+\.[^\s@<>",]{2,}$' then
    insert into notification_outbox (key, channel, template, recipient_emails, payload)
    values ('TK1:reply:' || new.id::text, 'email', 'TK1', array[v_email],
            jsonb_build_object(
              'variant',  'reply',
              'ref',      'TK-' || t.ticket_no,
              'title',    t.title,
              'status',   case t.status when 'new' then 'New' when 'in_progress' then 'In progress'
                            when 'waiting' then 'Waiting' when 'resolved' then 'Resolved'
                            else 'Closed' end,
              'reporter', t.reporter_name,
              'author',   new.author_name,
              'comment',  left(new.body, 3000)))
    on conflict (key) do nothing;
  end if;
  return new;
end $$;

comment on function public.ticket_comment_tell_reporter() is
  'ADR-0202: queue TK1 (variant reply) to the ticket''s reporter when somebody else adds a comment or note. Trigger function; not callable by any API role.';

revoke all on function public.ticket_comment_tell_reporter() from public, anon, authenticated;

drop trigger if exists ticket_comments_tell_reporter on public.ticket_comments;
create trigger ticket_comments_tell_reporter
  after insert on public.ticket_comments
  for each row execute function public.ticket_comment_tell_reporter();
