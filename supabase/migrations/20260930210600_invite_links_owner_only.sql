-- =====================================================================
-- E11 set-up links are readable by owners only, and gone once sent
-- (QA review of ADR-0049…0038)
--
-- An E11 row in notification_outbox carries the invitee's one-time set-up
-- link in `payload.link` — whoever holds it can choose that login's
-- password. The table is `admin_read` (20260921123503), which was the
-- right line when every Back Office login could invite. Since ADR-0050
-- only an owner can (office_can('users')), so a manager or scheduler
-- reading E11 rows over the API could take over a login an owner had
-- just created — including a new owner's.
--
-- 1 · A RESTRICTIVE select policy: an E11 row is visible only to a
--     session with office_can('users'). Every other row is unchanged.
--     The drain runs on the service key and does not meet RLS.
-- 2 · Once an E11 row is finished (sent, or failed for good — including
--     "superseded" by a newer link), its link is removed from the payload.
--     Nothing reads it after that: the Inbox never lists E11, and the
--     audit row never had it.
-- =====================================================================

create policy office_users_invite_links on notification_outbox
  as restrictive
  for select
  to authenticated
  using (template <> 'E11' or (select office_can('users')));

create or replace function public.redact_finished_invite_link()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.template = 'E11'
     and (new.sent_at is not null or new.failed_at is not null)
     and new.payload ? 'link' then
    new.payload := (new.payload - 'link') || jsonb_build_object('linkRedacted', true);
  end if;
  return new;
end;
$$;

revoke all on function public.redact_finished_invite_link() from public, anon, authenticated;

drop trigger if exists notification_outbox_redact_invite_link on notification_outbox;
create trigger notification_outbox_redact_invite_link
  before update on notification_outbox
  for each row execute function public.redact_finished_invite_link();

comment on policy office_users_invite_links on notification_outbox is
  'ADR-0052/0036: an E11 row carries a one-time set-up link; only a session with office_can(''users'') (an owner) may read it. 20260930210600.';
