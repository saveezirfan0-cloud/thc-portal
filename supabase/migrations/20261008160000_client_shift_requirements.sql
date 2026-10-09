-- =====================================================================
-- Migration 20261008160000 · Client shift requirements: a menu quiz and a
--                            kit reminder per client and role (ADR-0108,
--                            product owner 08.10.2026)
--
-- Leonardo Hotel St Paul's M&E wants two things of anyone THC sends it on
-- a Bar or Wine Waiting Service shift:
--
--   1 · a short quiz on its bar menu, the first time ever they are booked
--       on either role for this client — the menu as slides, then ten
--       questions, three attempts. One pass covers both roles for good.
--   2 · on the morning of every such shift, a reminder to bring a bottle
--       opener, a notepad and a pen, which the worker must confirm they
--       have read.
--
-- Neither is special to Leonardo in the data model. A client may have a
-- quiz (client_quizzes, with its slides and questions), and each (client,
-- role) pair may carry a requirement: the quiz to pass and/or the message
-- to confirm on the day (client_role_requirements). Two roles pointing at
-- the same quiz is what "taking it for either is sufficient" means.
--
-- What is here
-- ------------
--   · six tables, admin-only (the questions hold the answer key; the
--     attempts hold a worker's answers), each with the viewer write guard
--     (ADR-0060);
--   · the worker's reads and writes as definer RPCs (ADR-0031):
--       staff_shift_requirements()  what each live booking asks of them
--       staff_client_quiz(quiz)     the slides, the questions without the
--                                   key, and where they stand
--       submit_client_quiz_attempt  marked here, never in the app
--       acknowledge_shift_kit       "I've read this"
--   · CR1, the push that tells a worker a quiz is waiting, from a trigger
--     on bookings at the moment a booking is confirmed (every path that
--     confirms one — accept, self-apply, office booking, a taken offer —
--     lands here, so none of them is touched);
--   · CR2, the morning-of reminder, from client_kit_reminder_tick(), which
--     the booking-tick job calls beside booking_tick() every minute. Keyed
--     like N6/N7 (booking_reminder_key), so a moved start is reminded
--     again and a re-run never double-sends;
--   · CR3, an email to the office when a worker fails the third attempt;
--   · the office's reads (clients_shift_requirements_v,
--     clients_quiz_results_v) and reset_client_quiz_attempts();
--   · the bar menu quiz itself — install_bar_menu_quiz(client) — switched
--     on for every client card named Leonardo Hotel St Paul's M&E, as the
--     name badges were (20261002112000).
--
-- Nothing here reaches the client role (ADR-0026): no client_ view names
-- these columns, and the client holds no table policy.
--
-- Forward-only.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · Tables
-- ---------------------------------------------------------------------
create table if not exists client_quizzes (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references clients(id),
  title             text not null check (btrim(title) <> ''),
  intro             text,
  pass_mark_percent int  not null default 80 check (pass_mark_percent between 1 and 100),
  max_attempts      int  not null default 3  check (max_attempts between 1 and 10),
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  unique (client_id, title)
);
comment on table client_quizzes is
  'ADR-0108: a knowledge check a client asks of workers before their first shift on a role that names it (client_role_requirements.quiz_id). Admin only; the worker reads it through staff_client_quiz().';

create table if not exists client_quiz_slides (
  id        uuid primary key default gen_random_uuid(),
  quiz_id   uuid not null references client_quizzes(id) on delete cascade,
  position  int  not null check (position >= 1),
  heading   text not null check (btrim(heading) <> ''),
  note      text,
  -- The column headings of a price list ("Bottle", "Per 175ml"); empty for prose.
  columns   text[] not null default '{}',
  -- One row per line: the first cell is the item, the rest line up with `columns`.
  rows      jsonb  not null default '[]' check (jsonb_typeof(rows) = 'array'),
  unique (quiz_id, position)
);
comment on table client_quiz_slides is
  'ADR-0108: the material a client quiz is sat on, slide by slide — a heading, an optional note, and a small table (columns + rows) so a menu reads as a menu on a phone.';

create table if not exists client_quiz_questions (
  id            uuid primary key default gen_random_uuid(),
  quiz_id       uuid not null references client_quizzes(id) on delete cascade,
  position      int  not null check (position >= 1),
  prompt        text not null check (btrim(prompt) <> ''),
  options       text[] not null check (array_length(options, 1) between 2 and 6),
  -- Zero-based index into options. Never leaves the database.
  correct_index int  not null,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  constraint client_quiz_questions_correct_in_range
    check (correct_index >= 0 and correct_index < array_length(options, 1))
);
create unique index if not exists client_quiz_questions_active_position
  on client_quiz_questions (quiz_id, position) where active;
comment on table client_quiz_questions is
  'ADR-0108: a client quiz''s questions and answer key. Admin only — the worker receives them without correct_index through staff_client_quiz() and is marked by submit_client_quiz_attempt().';

create table if not exists client_quiz_attempts (
  id         uuid primary key default gen_random_uuid(),
  quiz_id    uuid not null references client_quizzes(id) on delete cascade,
  staff_id   uuid not null references staff(id) on delete cascade,
  attempt_no int  not null check (attempt_no >= 1),
  correct    int  not null check (correct >= 0),
  total      int  not null check (total >= 1),
  score      numeric(5,2) not null,
  passed     boolean not null,
  answers    jsonb not null,
  -- An office reset (reset_client_quiz_attempts) keeps the rows as history
  -- and takes them out of the count.
  superseded boolean not null default false,
  taken_at   timestamptz not null default now()
);
create unique index if not exists client_quiz_attempts_live_no
  on client_quiz_attempts (quiz_id, staff_id, attempt_no) where not superseded;
create index if not exists client_quiz_attempts_staff_idx on client_quiz_attempts (staff_id);
comment on table client_quiz_attempts is
  'ADR-0108: every sitting of a client quiz, marked by submit_client_quiz_attempt(). A pass (passed, not superseded) clears the worker for every role that names the quiz, for good.';

create table if not exists client_role_requirements (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients(id),
  role_id     uuid not null references roles(id),
  -- The quiz to pass before the first shift on this role for this client.
  quiz_id     uuid references client_quizzes(id) on delete set null,
  -- The message pushed on the morning of every shift on this role for
  -- this client, which the worker confirms they have read.
  kit_message text check (kit_message is null or btrim(kit_message) <> ''),
  created_at  timestamptz not null default now(),
  unique (client_id, role_id),
  constraint client_role_requirements_asks_something
    check (quiz_id is not null or kit_message is not null)
);
create index if not exists client_role_requirements_quiz_idx on client_role_requirements (quiz_id);
create index if not exists client_role_requirements_role_idx on client_role_requirements (role_id);
comment on table client_role_requirements is
  'ADR-0108: what a client asks of a worker on one of its roles — a quiz to pass first (quiz_id) and/or a kit message to confirm on the morning of each shift (kit_message). Read on the client card; the worker sees it through staff_shift_requirements().';

create table if not exists booking_kit_acknowledgements (
  booking_id      uuid primary key references bookings(id) on delete cascade,
  staff_id        uuid not null references staff(id) on delete cascade,
  acknowledged_at timestamptz not null default now()
);
create index if not exists booking_kit_acknowledgements_staff_idx on booking_kit_acknowledgements (staff_id);
comment on table booking_kit_acknowledgements is
  'ADR-0108: the worker pressed "I''ve read this" on the kit message for this booking (acknowledge_shift_kit). One row per booking; CR2 stops once it exists.';

-- A requirement's quiz must belong to the same client.
create or replace function public.client_role_requirement_guard()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  if new.quiz_id is not null and not exists (
    select 1 from client_quizzes q where q.id = new.quiz_id and q.client_id = new.client_id
  ) then
    raise exception 'quiz_belongs_to_another_client' using errcode = '23503';
  end if;
  return new;
end $$;
drop trigger if exists client_role_requirements_guard on client_role_requirements;
create trigger client_role_requirements_guard
  before insert or update on client_role_requirements
  for each row execute function public.client_role_requirement_guard();
revoke execute on function public.client_role_requirement_guard() from public, anon, authenticated;

-- RLS: admin only, every table. The worker's every read and write is a
-- definer RPC below (ADR-0031); the client role holds nothing (ADR-0026).
do $$
declare t text;
begin
  foreach t in array array['client_quizzes', 'client_quiz_slides', 'client_quiz_questions',
                           'client_quiz_attempts', 'client_role_requirements',
                           'booking_kit_acknowledgements'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists admin_all on public.%I', t);
    -- (select …) so the role is read once per query, not once per row (747).
    execute format('create policy admin_all on public.%I for all using ((select current_app_role()) = ''admin'')', t);
    -- ADR-0060: every public table carries the viewer's write guard.
    execute format('drop trigger if exists office_read_only on public.%I', t);
    execute format('create trigger office_read_only before insert or update or delete or truncate on public.%I '
                   'for each statement execute function public.office_read_only_guard()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 2 · Where a worker stands on a quiz
-- ---------------------------------------------------------------------
create or replace function public.client_quiz_passed(p_quiz uuid, p_staff uuid)
returns boolean
language sql
stable
set search_path = public, extensions
as $$
  select exists (
    select 1 from client_quiz_attempts a
     where a.quiz_id = p_quiz and a.staff_id = p_staff and a.passed and not a.superseded)
$$;
comment on function public.client_quiz_passed(uuid, uuid) is
  'ADR-0108: true once the worker has a live (not superseded) passing attempt at this quiz.';

create or replace function public.client_quiz_attempts_used(p_quiz uuid, p_staff uuid)
returns int
language sql
stable
set search_path = public, extensions
as $$
  select count(*)::int from client_quiz_attempts a
   where a.quiz_id = p_quiz and a.staff_id = p_staff and not a.superseded
$$;

-- Does any live booking of this worker name this quiz? Live = invited,
-- confirmed or checked in, on an event that stands. An invitee may sit the
-- quiz before accepting; nothing asks them to.
create or replace function public.client_quiz_required_for(p_quiz uuid, p_staff uuid)
returns boolean
language sql
stable
set search_path = public, extensions
as $$
  select exists (
    select 1
      from bookings b
      join shift_requirements s on s.id = b.shift_id
      join events e on e.id = s.event_id
      join client_role_requirements r on r.client_id = e.client_id and r.role_id = s.role_id
     where b.staff_id = p_staff
       and r.quiz_id = p_quiz
       and b.cancelled_at is null
       and e.cancelled_at is null
       and b.status in ('invited', 'confirmed', 'worked'))
$$;

revoke execute on function public.client_quiz_passed(uuid, uuid)       from public, anon;
revoke execute on function public.client_quiz_attempts_used(uuid, uuid) from public, anon;
revoke execute on function public.client_quiz_required_for(uuid, uuid)  from public, anon;

-- When the kit reminder (CR2, §6 below) is due: 07:00 UK on the day the
-- section starts, or three hours before the start if that is earlier,
-- never before that UK day begins. Defined here because the reads below
-- name it.
create or replace function public.kit_reminder_due_at(p_starts_at timestamptz)
returns timestamptz
language sql
immutable
set search_path = public, extensions
as $$
  with d as (select (p_starts_at at time zone 'Europe/London')::date as uk_day)
  select greatest(
           (d.uk_day + time '00:00') at time zone 'Europe/London',
           least((d.uk_day + time '07:00') at time zone 'Europe/London',
                 p_starts_at - interval '3 hours'))
    from d
$$;
comment on function public.kit_reminder_due_at(timestamptz) is
  'ADR-0108, CR2: 07:00 UK on the day the role section starts, or three hours before the start if earlier, never before that UK day begins.';

-- ---------------------------------------------------------------------
-- 3 · The worker's reads
-- ---------------------------------------------------------------------

-- What each live booking asks of the caller. One row per booking that has
-- a requirement; a booking with none has no row. Bookings are live until
-- their check-out window closes (end + 4 h, RULE-02), like the /shifts list.
create or replace function public.staff_shift_requirements()
returns table (
  booking_id          uuid,
  client_id           uuid,
  client_name         text,
  role_name           text,
  quiz_id             uuid,
  quiz_title          text,
  quiz_passed         boolean,
  quiz_attempts_used  int,
  quiz_attempts_max   int,
  kit_message         text,
  kit_due_at          timestamptz,
  kit_acknowledged_at timestamptz
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select b.id,
         c.id,
         c.name,
         ro.name,
         q.id,
         q.title,
         case when q.id is null then null else client_quiz_passed(q.id, b.staff_id) end,
         case when q.id is null then null else client_quiz_attempts_used(q.id, b.staff_id) end,
         q.max_attempts,
         r.kit_message,
         case when r.kit_message is null then null else kit_reminder_due_at(s.starts_at) end,
         k.acknowledged_at
    from bookings b
    join shift_requirements s on s.id = b.shift_id
    join events e  on e.id = s.event_id
    join clients c on c.id = e.client_id
    join roles ro  on ro.id = s.role_id
    join client_role_requirements r on r.client_id = e.client_id and r.role_id = s.role_id
    left join client_quizzes q on q.id = r.quiz_id and q.active
    left join booking_kit_acknowledgements k on k.booking_id = b.id
   where b.staff_id = staff_caller()
     and b.cancelled_at is null
     and e.cancelled_at is null
     and b.status in ('invited', 'confirmed', 'worked')
     and s.ends_at + interval '4 hours' > now()
     and (q.id is not null or r.kit_message is not null)
   order by s.starts_at
$$;
comment on function public.staff_shift_requirements() is
  'ADR-0108: for each of the caller''s live bookings on a (client, role) with a requirement — the quiz and where they stand on it, and the kit message with when it is due and whether it was acknowledged. No charge rate, no other worker.';

-- The quiz: its slides, its questions WITHOUT the key, and the caller's
-- standing. Open to a worker a live booking names it for, or who has sat
-- it (a pass can be reviewed before the next shift).
create or replace function public.staff_client_quiz(p_quiz uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_staff uuid := staff_caller();
  q       client_quizzes;
  v_used  int;
  v_passed boolean;
begin
  if v_staff is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  select * into q from client_quizzes where id = p_quiz and active;
  if q.id is null then
    raise exception 'quiz_not_found' using errcode = 'P0002';
  end if;
  if not client_quiz_required_for(p_quiz, v_staff)
     and not exists (select 1 from client_quiz_attempts a where a.quiz_id = p_quiz and a.staff_id = v_staff) then
    raise exception 'quiz_not_required' using errcode = '42501';
  end if;

  v_used   := client_quiz_attempts_used(p_quiz, v_staff);
  v_passed := client_quiz_passed(p_quiz, v_staff);

  return jsonb_build_object(
    'id',              q.id,
    'title',           q.title,
    'intro',           q.intro,
    'clientName',      (select c.name from clients c where c.id = q.client_id),
    'roles',           coalesce((select jsonb_agg(ro.name order by ro.name)
                                   from client_role_requirements r join roles ro on ro.id = r.role_id
                                  where r.quiz_id = q.id), '[]'::jsonb),
    'passMarkPercent', q.pass_mark_percent,
    'maxAttempts',     q.max_attempts,
    'attemptsUsed',    v_used,
    'attemptsLeft',    greatest(q.max_attempts - v_used, 0),
    'passed',          v_passed,
    'passedAt',        (select min(a.taken_at) from client_quiz_attempts a
                         where a.quiz_id = q.id and a.staff_id = v_staff and a.passed and not a.superseded),
    'failed',          (not v_passed and v_used >= q.max_attempts),
    'slides',          coalesce((select jsonb_agg(jsonb_build_object(
                                   'heading', sl.heading, 'note', sl.note,
                                   'columns', to_jsonb(sl.columns), 'rows', sl.rows)
                                   order by sl.position)
                                   from client_quiz_slides sl where sl.quiz_id = q.id), '[]'::jsonb),
    'questions',       coalesce((select jsonb_agg(jsonb_build_object(
                                   'id', qq.id, 'questionNo', qq.rn, 'prompt', qq.prompt,
                                   'options', to_jsonb(qq.options)) order by qq.rn)
                                   from (select x.*, row_number() over (order by x.position) as rn
                                           from client_quiz_questions x
                                          where x.quiz_id = q.id and x.active) qq), '[]'::jsonb),
    'attempts',        coalesce((select jsonb_agg(jsonb_build_object(
                                   'attemptNo', a.attempt_no, 'correct', a.correct, 'total', a.total,
                                   'percent', floor(a.score)::int, 'passed', a.passed,
                                   'takenAt', a.taken_at) order by a.attempt_no)
                                   from client_quiz_attempts a
                                  where a.quiz_id = q.id and a.staff_id = v_staff and not a.superseded), '[]'::jsonb)
  );
end $$;
comment on function public.staff_client_quiz(uuid) is
  'ADR-0108: one client quiz for the caller — slides, questions numbered 1..n WITHOUT correct_index, and their attempts. Refused (quiz_not_required) unless a live booking of theirs names it or they have sat it.';

-- ---------------------------------------------------------------------
-- 4 · Marking an attempt
--
-- p_answers: {"<question id>": <zero-based option index>, …} for every
-- active question. Checked at the end, not one by one, as the H&S quiz
-- is. A pass is correct × 100 ≥ total × pass mark, in integers.
-- ---------------------------------------------------------------------
create or replace function public.submit_client_quiz_attempt(p_quiz uuid, p_answers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_staff   uuid := staff_caller();
  s         staff;
  q         client_quizzes;
  v_used    int;
  v_total   int;
  v_correct int := 0;
  v_passed  boolean;
  v_attempt int;
  v_attempt_id uuid;
  v_outcome text;
  r         record;
  v_raw     jsonb;
  v_pick    int;
  v_client  text;
  v_roles   text;
begin
  if v_staff is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  select * into s from staff where id = v_staff;
  select * into q from client_quizzes where id = p_quiz and active;
  if q.id is null then
    raise exception 'quiz_not_found' using errcode = 'P0002';
  end if;
  if not client_quiz_required_for(p_quiz, v_staff) then
    raise exception 'quiz_not_required' using errcode = '42501';
  end if;
  if client_quiz_passed(p_quiz, v_staff) then
    return jsonb_build_object('ok', false, 'reason', 'already_passed');
  end if;
  v_used := client_quiz_attempts_used(p_quiz, v_staff);
  if v_used >= q.max_attempts then
    return jsonb_build_object('ok', false, 'reason', 'no_attempts_left');
  end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then
    raise exception 'answers_must_be_an_object' using errcode = '22023';
  end if;

  select count(*)::int into v_total from client_quiz_questions where quiz_id = p_quiz and active;
  if v_total = 0 then
    raise exception 'quiz_has_no_questions' using errcode = 'P0001';
  end if;

  -- An answer to a question that is not on the current set: the set was
  -- replaced while they were answering. Start again rather than mark half.
  if exists (
    select 1 from jsonb_object_keys(p_answers) k
     where not exists (select 1 from client_quiz_questions x
                        where x.quiz_id = p_quiz and x.active and x.id::text = k)
  ) then
    return jsonb_build_object('ok', false, 'reason', 'quiz_changed');
  end if;

  for r in select x.id, x.options, x.correct_index
             from client_quiz_questions x where x.quiz_id = p_quiz and x.active loop
    v_raw := p_answers -> r.id::text;
    if v_raw is null or jsonb_typeof(v_raw) <> 'number' then
      return jsonb_build_object('ok', false, 'reason', 'incomplete');
    end if;
    v_pick := (v_raw #>> '{}')::numeric::int;
    if v_pick < 0 or v_pick >= array_length(r.options, 1) then
      return jsonb_build_object('ok', false, 'reason', 'incomplete');
    end if;
    if v_pick = r.correct_index then v_correct := v_correct + 1; end if;
  end loop;

  v_passed  := v_correct * 100 >= v_total * q.pass_mark_percent;
  v_attempt := v_used + 1;

  insert into client_quiz_attempts (quiz_id, staff_id, attempt_no, correct, total, score, passed, answers)
  values (p_quiz, v_staff, v_attempt, v_correct, v_total,
          round(v_correct::numeric * 100 / v_total, 2), v_passed, p_answers)
  returning id into v_attempt_id;

  v_outcome := case when v_passed then 'passed'
                    when v_attempt >= q.max_attempts then 'failed'
                    else 'retry' end;

  insert into audit_log (actor, action, entity, entity_id, data)
  values (auth.uid(), 'client_quiz.attempt', 'staff', v_staff,
          jsonb_build_object('quizId', p_quiz, 'clientId', q.client_id, 'quiz', q.title,
                             'attemptNo', v_attempt, 'correct', v_correct, 'total', v_total,
                             'passed', v_passed, 'outcome', v_outcome));

  -- CR3: the office hears of a third failure once, with the facts it needs
  -- to decide what happens to the booking. Not for a pass, not for a retry.
  if v_outcome = 'failed' then
    select c.name into v_client from clients c where c.id = q.client_id;
    select string_agg(ro.name, ', ' order by ro.name) into v_roles
      from client_role_requirements cr join roles ro on ro.id = cr.role_id
     where cr.quiz_id = q.id;
    insert into notification_outbox (key, channel, template, recipient_emails, payload)
    values ('CR3:quiz:' || q.id || ':' || v_staff || ':' || v_attempt_id, 'email', 'CR3',
            array['admin@thehospitalitycompany.co.uk'],
            jsonb_build_object(
              'name',       s.first_name || ' ' || s.last_name,
              'employeeId', coalesce(s.employee_id::text, '—'),
              'client',     v_client,
              'quiz',       q.title,
              'roles',      coalesce(v_roles, '—'),
              'attempts',   q.max_attempts,
              'best',       (select max(a.correct) || ' of ' || v_total from client_quiz_attempts a
                              where a.quiz_id = q.id and a.staff_id = v_staff and not a.superseded),
              'staffId',    v_staff,
              'quizId',     q.id))
    on conflict (key) do nothing;
  end if;

  return jsonb_build_object(
    'ok', true,
    'attemptNo',    v_attempt,
    'correct',      v_correct,
    'total',        v_total,
    'percent',      floor(v_correct::numeric * 100 / v_total)::int,
    'passed',       v_passed,
    'attemptsLeft', greatest(q.max_attempts - v_attempt, 0),
    'outcome',      v_outcome);
end $$;
comment on function public.submit_client_quiz_attempt(uuid, jsonb) is
  'ADR-0108: marks one sitting of a client quiz for the caller against the key the app never sees. {ok, attemptNo, correct, total, percent, passed, attemptsLeft, outcome: passed | retry | failed}; refuses already_passed / no_attempts_left / incomplete / quiz_changed. A third failure emails the office (CR3).';

-- ---------------------------------------------------------------------
-- 5 · "I've read this" on the kit message
-- ---------------------------------------------------------------------
create or replace function public.acknowledge_shift_kit(p_booking uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_staff uuid := staff_caller();
  b bookings;
  v_message text;
  v_at timestamptz;
begin
  if v_staff is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  select * into b from bookings where id = p_booking;
  if b.id is null or b.staff_id <> v_staff then
    raise exception 'not_your_booking' using errcode = '42501';
  end if;
  if b.status not in ('confirmed', 'worked') or b.cancelled_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'not_booked');
  end if;
  select r.kit_message into v_message
    from shift_requirements s
    join events e on e.id = s.event_id
    join client_role_requirements r on r.client_id = e.client_id and r.role_id = s.role_id
   where s.id = b.shift_id;
  if v_message is null then
    return jsonb_build_object('ok', false, 'reason', 'nothing_to_acknowledge');
  end if;

  insert into booking_kit_acknowledgements (booking_id, staff_id)
  values (b.id, v_staff)
  on conflict (booking_id) do nothing;
  select acknowledged_at into v_at from booking_kit_acknowledgements where booking_id = b.id;

  return jsonb_build_object('ok', true, 'acknowledgedAt', v_at);
end $$;
comment on function public.acknowledge_shift_kit(uuid) is
  'ADR-0108: the worker confirms they have read the kit message for one of their confirmed bookings. Idempotent; refuses another worker''s booking, an unbooked one (not_booked) and one with no kit message (nothing_to_acknowledge).';

-- ---------------------------------------------------------------------
-- 6 · CR2 · the morning-of reminder
--
-- Due at kit_reminder_due_at() (§2 above), open until the start. A
-- confirmed booking only — once checked in there is nothing left to
-- bring — and never once acknowledged.
-- ---------------------------------------------------------------------
create or replace function public.client_kit_reminder_tick(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_cr2 int := 0;
begin
  with due as (
    select b.id as booking_id, b.staff_id, s.starts_at, s.ends_at, e.title as event_title,
           ro.name as role_name, r.kit_message, c.name as client_name
      from bookings b
      join shift_requirements s on s.id = b.shift_id
      join events e  on e.id = s.event_id
      join clients c on c.id = e.client_id
      join roles ro  on ro.id = s.role_id
      join client_role_requirements r on r.client_id = e.client_id and r.role_id = s.role_id
     where r.kit_message is not null
       and b.status = 'confirmed'
       and b.cancelled_at is null
       and e.cancelled_at is null
       and p_now >= kit_reminder_due_at(s.starts_at)
       and p_now <  s.starts_at
       and not exists (select 1 from booking_kit_acknowledgements k where k.booking_id = b.id)
  ), queued as (
    insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
    select booking_reminder_key('CR2', booking_id, starts_at), 'push', 'CR2', staff_id,
           jsonb_build_object('bookingId', booking_id::text,
                              'event',     event_title,
                              'client',    client_name,
                              'role',      role_name,
                              'message',   kit_message,
                              'window',    to_char(starts_at at time zone 'Europe/London', 'HH24:MI')
                                           || '–' || to_char(ends_at at time zone 'Europe/London', 'HH24:MI'))
      from due
    on conflict (key) do nothing
    returning 1
  ) select count(*)::int into v_cr2 from queued;

  return jsonb_build_object('cr2', v_cr2);
end $$;
comment on function public.client_kit_reminder_tick(timestamptz) is
  'ADR-0108: queues CR2 for every confirmed booking on a (client, role) with a kit message, from kit_reminder_due_at() until the start, unless acknowledged. Keyed on booking + start (booking_reminder_key) so a moved shift is reminded again and a re-run never double-sends. Called every minute by the booking-tick Edge Function beside booking_tick().';

revoke execute on function public.client_kit_reminder_tick(timestamptz) from public, anon, authenticated;
grant  execute on function public.client_kit_reminder_tick(timestamptz) to service_role;
revoke execute on function public.kit_reminder_due_at(timestamptz) from public, anon;
grant  execute on function public.kit_reminder_due_at(timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 7 · CR1 · "a quiz is waiting", the first time a booking is confirmed
--
-- An AFTER trigger on bookings, so every path that confirms one is
-- covered without being restated. One push per worker per quiz, ever
-- (the key), and none to a worker who has already passed or has no
-- attempts left.
-- ---------------------------------------------------------------------
create or replace function public.bookings_client_quiz_notice()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  q client_quizzes;
  v_event text;
  v_client text;
  v_roles text;
begin
  if new.status <> 'confirmed' or new.cancelled_at is not null then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'confirmed' then return new; end if;

  select cq.* into q
    from shift_requirements s
    join events e on e.id = s.event_id
    join client_role_requirements r on r.client_id = e.client_id and r.role_id = s.role_id
    join client_quizzes cq on cq.id = r.quiz_id and cq.active
   where s.id = new.shift_id;
  if q.id is null then return new; end if;
  select e.title, c.name into v_event, v_client
    from shift_requirements s
    join events e on e.id = s.event_id
    join clients c on c.id = e.client_id
   where s.id = new.shift_id;
  if client_quiz_passed(q.id, new.staff_id)
     or client_quiz_attempts_used(q.id, new.staff_id) >= q.max_attempts then
    return new;
  end if;

  select string_agg(ro.name, ' and ' order by ro.name) into v_roles
    from client_role_requirements cr join roles ro on ro.id = cr.role_id
   where cr.quiz_id = q.id;

  insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
  values ('CR1:quiz:' || q.id || ':' || new.staff_id, 'push', 'CR1', new.staff_id,
          jsonb_build_object('quizId', q.id::text, 'quiz', q.title, 'client', v_client,
                             'roles', coalesce(v_roles, ''), 'event', v_event,
                             'bookingId', new.id::text))
  on conflict (key) do nothing;
  return new;
end $$;
drop trigger if exists bookings_client_quiz_notice on bookings;
create trigger bookings_client_quiz_notice
  after insert or update of status on bookings
  for each row execute function public.bookings_client_quiz_notice();
comment on function public.bookings_client_quiz_notice() is
  'ADR-0108: queues CR1 (one per worker per quiz, ever) when a booking is confirmed on a (client, role) whose requirement names a quiz the worker has not passed and can still sit.';
revoke execute on function public.bookings_client_quiz_notice() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 8 · The office: what each client asks, and who has passed
-- ---------------------------------------------------------------------
create or replace view public.clients_shift_requirements_v
with (security_invoker = true) as
select r.id,
       r.client_id,
       r.role_id,
       ro.name        as role_name,
       r.quiz_id,
       q.title        as quiz_title,
       q.max_attempts as quiz_attempts_max,
       r.kit_message
  from client_role_requirements r
  join roles ro on ro.id = r.role_id
  left join client_quizzes q on q.id = r.quiz_id;
comment on view public.clients_shift_requirements_v is
  'ADR-0108: the client card''s Shift requirements block — per role, the quiz and the kit message. Office only (RLS on the base tables). The clients_ prefix is the office''s, not the portal''s (ADR-0004).';

create or replace view public.clients_quiz_results_v
with (security_invoker = true) as
select a.quiz_id,
       q.client_id,
       q.title as quiz_title,
       a.staff_id,
       case when s.removed_at is not null then deleted_account_label(s.employee_id)
            else s.first_name || ' ' || s.last_name end as display_name,
       s.employee_id,
       count(*)::int                                  as attempts_used,
       q.max_attempts                                 as attempts_max,
       bool_or(a.passed)                              as passed,
       min(a.taken_at) filter (where a.passed)        as passed_at,
       max(a.taken_at)                                as last_attempt_at,
       (not bool_or(a.passed) and count(*) >= q.max_attempts) as failed,
       max(a.correct)                                 as best_correct,
       max(a.total)                                   as total
  from client_quiz_attempts a
  join client_quizzes q on q.id = a.quiz_id
  join staff s on s.id = a.staff_id
 where not a.superseded
 group by a.quiz_id, q.client_id, q.title, a.staff_id, s.removed_at, s.employee_id, s.first_name, s.last_name, q.max_attempts;
comment on view public.clients_quiz_results_v is
  'ADR-0108: one row per worker who has sat a client quiz — attempts used, passed (and when), failed (every attempt used, none passed). Superseded attempts (an office reset) are not counted. Office only.';

-- The office gives a worker their attempts back — after a word with
-- them, or because the questions were wrong. History stays as superseded.
create or replace function public.reset_client_quiz_attempts(p_quiz uuid, p_staff uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_count int;
begin
  perform assert_office_caller();
  if not exists (select 1 from client_quizzes where id = p_quiz) then
    raise exception 'quiz_not_found' using errcode = 'P0002';
  end if;
  -- A viewer (ADR-0060) is refused here by the office_read_only trigger.
  update client_quiz_attempts set superseded = true
   where quiz_id = p_quiz and staff_id = p_staff and not superseded;
  get diagnostics v_count = row_count;
  if v_count = 0 then
    return jsonb_build_object('ok', false, 'reason', 'nothing_to_reset');
  end if;
  insert into audit_log (actor, action, entity, entity_id, data)
  values (auth.uid(), 'client_quiz.reset', 'staff', p_staff,
          jsonb_build_object('quizId', p_quiz, 'superseded', v_count,
                             'clientId', (select client_id from client_quizzes where id = p_quiz)));
  return jsonb_build_object('ok', true, 'superseded', v_count);
end $$;
comment on function public.reset_client_quiz_attempts(uuid, uuid) is
  'ADR-0108: the office marks a worker''s attempts at a client quiz superseded, giving them the full set again. Office only; a viewer is refused by the read-only guard. Audited as client_quiz.reset.';

revoke execute on function public.staff_shift_requirements()                  from public, anon;
revoke execute on function public.staff_client_quiz(uuid)                     from public, anon;
revoke execute on function public.submit_client_quiz_attempt(uuid, jsonb)      from public, anon;
revoke execute on function public.acknowledge_shift_kit(uuid)                 from public, anon;
revoke execute on function public.reset_client_quiz_attempts(uuid, uuid)      from public, anon;
grant  execute on function public.staff_shift_requirements()                  to authenticated;
grant  execute on function public.staff_client_quiz(uuid)                     to authenticated;
grant  execute on function public.submit_client_quiz_attempt(uuid, jsonb)      to authenticated;
grant  execute on function public.acknowledge_shift_kit(uuid)                 to authenticated;
grant  execute on function public.reset_client_quiz_attempts(uuid, uuid)      to authenticated;

-- ---------------------------------------------------------------------
-- 9 · The bar menu quiz — Leonardo Royal Hotel London, Meetings & Events
--
-- The menu as photographed on 08.10.2026, transcribed line by line, and
-- ten questions on it. Installed for one client at a time, idempotently:
-- a client that already has a quiz of this title keeps it (its questions
-- are not rewritten — replace them as data, as the H&S questions are).
-- The requirement rows are for Bar Staff and Wine Waiting Service; a role
-- the catalogue does not hold is reported and skipped.
-- ---------------------------------------------------------------------
create or replace function public.install_bar_menu_quiz(p_client uuid)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_quiz uuid;
  v_role uuid;
  v_name text;
  c_title constant text := 'Bar menu — Leonardo Royal Hotel London';
  c_kit   constant text :=
    'Don''t forget to bring your bottle opener, notepad and pen to your shift - without this you will not be able to work this shift';
begin
  if not exists (select 1 from clients where id = p_client) then
    raise exception 'No client %', p_client using errcode = 'no_data_found';
  end if;

  select id into v_quiz from client_quizzes where client_id = p_client and title = c_title;
  if v_quiz is null then
    insert into client_quizzes (client_id, title, intro, pass_mark_percent, max_attempts)
    values (p_client, c_title,
            'Before your first Bar or Wine Waiting Service shift with Leonardo Hotel St Paul''s M&E, read the bar menu and answer ten questions on it. Prices include VAT; a discretionary 12.5% service charge is added to the bill.',
            80, 3)
    returning id into v_quiz;

    insert into client_quiz_slides (quiz_id, position, heading, note, columns, rows) values
      (v_quiz, 1, 'White wine', 'Wines are sold by the bottle and, where a glass price is shown, by the 175ml glass.',
       array['Bottle', 'Per 175ml'],
       '[["Pinot Grigio delle Venezie, Corte Vigna", "£34.00", "£9.00"],
         ["Chenin Blanc, Cullinan View", "£34.00", "£9.00"],
         ["Sauvignon Blanc, Flagstone Free Run, South Africa", "£42.00", ""],
         ["Sancerre, Les Collinettes, Joseph Mellot", "£80.00", ""]]'),
      (v_quiz, 2, 'Rosé wine', null,
       array['Bottle', 'Per 175ml'],
       '[["Belvino Pinot Grigio, Rosato delle Venezie, Italy", "£38.00", ""]]'),
      (v_quiz, 3, 'Red wine', null,
       array['Bottle', 'Per 175ml'],
       '[["Merlot, Tekena", "£34.00", "£9.00"],
         ["Tempranillo, Castillo de Mureva Organic", "£34.00", ""],
         ["Don Jacobo Rioja Crianza, Bodegas Corral", "£40.00", "£10.00"],
         ["Cabernet Sauvignon Max Reserva, Errazuriz", "£48.00", ""]]'),
      (v_quiz, 4, 'Sparkling wine / Champagne', 'Sparkling wine is served in a 125ml glass.',
       array['Bottle', 'Per 125ml'],
       '[["Mionetto Prestige Prosecco", "£48.00", "£9.50"],
         ["Pommery Brut Royal Brut NV", "£92.00", ""],
         ["Pommery Brut Rosé Royal", "£105.00", ""]]'),
      (v_quiz, 5, 'Vodka', 'Spirits are sold as a double or a single.',
       array['Double', 'Single'],
       '[["Absolut", "£9.50", "£4.75"], ["Grey Goose", "£11.50", "£5.75"]]'),
      (v_quiz, 6, 'Gin', null,
       array['Double', 'Single'],
       '[["Bombay Sapphire", "£9.50", "£4.75"], ["The Botanist", "£12.50", "£6.25"]]'),
      (v_quiz, 7, 'Rum', null,
       array['Double', 'Single'],
       '[["Bacardi", "£9.50", "£4.75"], ["Kraken", "£10.50", "£5.25"]]'),
      (v_quiz, 8, 'Whisky', null,
       array['Double', 'Single'],
       '[["Jack Daniel''s N7", "£10.50", "£5.25"], ["JW Black Label", "£12.00", "£6.00"]]'),
      (v_quiz, 9, 'Cognac', null,
       array['Double', 'Single'],
       '[["Martell VS", "£10.50", "£5.25"], ["Courvoisier VSOP", "£12.00", "£6.00"]]'),
      (v_quiz, 10, 'On the bill', 'Above prices are inclusive of VAT. A discretionary service charge of 12.5% will be added to the bill.',
       '{}', '[]');

    insert into client_quiz_questions (quiz_id, position, prompt, options, correct_index) values
      (v_quiz, 1, 'How much is a bottle of Pinot Grigio delle Venezie, Corte Vigna?',
       array['£30.00', '£34.00', '£38.00', '£42.00'], 1),
      (v_quiz, 2, 'Which white wine is the most expensive by the bottle?',
       array['Sauvignon Blanc, Flagstone Free Run', 'Chenin Blanc, Cullinan View',
             'Sancerre, Les Collinettes, Joseph Mellot', 'Pinot Grigio delle Venezie, Corte Vigna'], 2),
      (v_quiz, 3, 'What size is a glass of still wine sold by the glass?',
       array['125ml', '150ml', '175ml', '250ml'], 2),
      (v_quiz, 4, 'What size is a glass of Prosecco?',
       array['125ml', '150ml', '175ml', '250ml'], 0),
      (v_quiz, 5, 'Which red wines are available by the glass?',
       array['Merlot and Don Jacobo Rioja Crianza', 'Tempranillo and Cabernet Sauvignon',
             'All four red wines', 'Merlot only'], 0),
      (v_quiz, 6, 'How much is a 175ml glass of Don Jacobo Rioja Crianza?',
       array['£9.00', '£9.50', '£10.00', '£10.50'], 2),
      (v_quiz, 7, 'Which gin costs £12.50 for a double?',
       array['Bombay Sapphire', 'The Botanist', 'Grey Goose', 'Kraken'], 1),
      (v_quiz, 8, 'How much is a single Grey Goose?',
       array['£4.75', '£5.25', '£5.75', '£6.25'], 2),
      (v_quiz, 9, 'How much is a bottle of Pommery Brut Rosé Royal?',
       array['£48.00', '£80.00', '£92.00', '£105.00'], 3),
      (v_quiz, 10, 'What is added to the bill on top of the menu prices?',
       array['Nothing — prices are all-in', 'VAT at 20%',
             'A discretionary service charge of 12.5%', 'A fixed cover charge per guest'], 2);
  end if;

  foreach v_name in array array['Bar Staff', 'Wine Waiting Service'] loop
    select id into v_role from roles where name = v_name;
    if v_role is null then
      raise notice 'install_bar_menu_quiz: no role named "%" — requirement skipped', v_name;
      continue;
    end if;
    insert into client_role_requirements (client_id, role_id, quiz_id, kit_message)
    values (p_client, v_role, v_quiz, c_kit)
    on conflict (client_id, role_id) do update
      set quiz_id = excluded.quiz_id, kit_message = excluded.kit_message;
  end loop;

  return v_quiz;
end $$;
comment on function public.install_bar_menu_quiz(uuid) is
  'ADR-0108: installs the Leonardo Royal Hotel bar menu quiz (10 slides, 10 questions, pass 80%, 3 attempts) for one client and the Bar Staff / Wine Waiting Service requirements that name it, with the kit message. Idempotent. Service role and migrations only.';
revoke execute on function public.install_bar_menu_quiz(uuid) from public, anon, authenticated;
grant  execute on function public.install_bar_menu_quiz(uuid) to service_role;

-- Switched on for the client card named Leonardo Hotel St Paul's M&E, matched
-- as the name badges were (20261002112000) — punctuation and spaces taken
-- out — plus the sample card's plain "Leonardo Hotel St Pauls".
do $$
declare
  v_client uuid;
  v_count int := 0;
begin
  for v_client in
    select id from clients
     where regexp_replace(lower(name), '[^a-z0-9]', '', 'g')
           in ('leonardohotelstpaulsmande', 'leonardohotelstpaulsme', 'leonardohotelstpauls')
  loop
    perform install_bar_menu_quiz(v_client);
    v_count := v_count + 1;
  end loop;
  raise notice 'bar menu quiz installed for % client card(s) named Leonardo Hotel St Paul''s M&E', v_count;
end $$;
