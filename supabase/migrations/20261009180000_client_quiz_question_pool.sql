-- =====================================================================
-- Client quizzes draw their questions from a pool · ADR-0111
--
-- Until now a client quiz served every active question, in position
-- order, on every sitting: a worker who failed saw the identical ten
-- again. The owner asked for the questions to rotate from a bigger pool
-- (09.10.2026).
--
-- What this does
--   1. `client_quizzes.questions_per_attempt` — how many questions one
--      sitting gets. Null keeps the old behaviour (every active question
--      in order), so nothing else changes shape.
--   2. `client_quiz_draws` — the questions ONE sitting was dealt, in the
--      order served. Drawn at random (`client_quiz_draw`) the moment the
--      worker opens the quiz with attempts left, kept across reloads, and
--      closed by the attempt that is marked against it. A later reading
--      deals a fresh hand. The answer key still never leaves the database.
--   3. `staff_client_quiz` serves the hand and says how big the pool is
--      (`questionPool`, `questionsPerAttempt`); `submit_client_quiz_attempt`
--      marks against the open hand and nothing else, so a worker cannot
--      pick the questions they answer.
--   4. The bar menu quiz grows from 10 to 35 questions, dealt 10 at a
--      time; the questions live in `bar_menu_quiz_questions()` so the
--      installer and the top-up are one list. `install_bar_menu_quiz` now
--      tops up a quiz it finds — adds the positions it lacks, never
--      rewrites one — and is run again for the Leonardo cards.
--
-- Forward-only.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · How many questions a sitting gets
-- ---------------------------------------------------------------------
alter table client_quizzes
  add column if not exists questions_per_attempt int
    constraint client_quizzes_questions_per_attempt_positive
    check (questions_per_attempt is null or questions_per_attempt >= 1);
comment on column client_quizzes.questions_per_attempt is
  'ADR-0111: how many of the active questions one sitting is dealt, at random (client_quiz_draw). Null: every active question, in position order, every time.';

-- ---------------------------------------------------------------------
-- 2 · The hand one sitting was dealt
-- ---------------------------------------------------------------------
create table if not exists client_quiz_draws (
  id           uuid primary key default gen_random_uuid(),
  quiz_id      uuid not null references client_quizzes(id) on delete cascade,
  staff_id     uuid not null references staff(id) on delete cascade,
  -- The questions served, in the order served.
  question_ids uuid[] not null check (array_length(question_ids, 1) >= 1),
  drawn_at     timestamptz not null default now(),
  -- Set by submit_client_quiz_attempt: the sitting this hand was marked
  -- for. Null while the hand is open.
  attempt_id   uuid references client_quiz_attempts(id) on delete cascade
);
create unique index if not exists client_quiz_draws_open
  on client_quiz_draws (quiz_id, staff_id) where attempt_id is null;
create index if not exists client_quiz_draws_quiz_idx    on client_quiz_draws (quiz_id);
create index if not exists client_quiz_draws_staff_idx   on client_quiz_draws (staff_id);
create index if not exists client_quiz_draws_attempt_idx on client_quiz_draws (attempt_id);
comment on table client_quiz_draws is
  'ADR-0111: the questions one sitting of a client quiz was dealt, in the order served. One open hand (attempt_id null) per worker and quiz; closed by the attempt marked against it. Admin only; the worker reaches it through staff_client_quiz().';

alter table client_quiz_draws enable row level security;
drop policy if exists admin_all on client_quiz_draws;
create policy admin_all on client_quiz_draws
  for all using ((select current_app_role()) = 'admin');
drop trigger if exists office_read_only on client_quiz_draws;
create trigger office_read_only
  before insert or update or delete or truncate on client_quiz_draws
  for each statement execute function public.office_read_only_guard();

-- The hand for (quiz, worker): the open one if it stands, else — when
-- p_create — a fresh random deal of questions_per_attempt active
-- questions. A quiz with no questions_per_attempt deals every active
-- question in position order and records nothing. A hand holding a
-- question retired since it was dealt is thrown away: the worker starts
-- that sitting again rather than being marked on half a set.
create or replace function public.client_quiz_draw(p_quiz uuid, p_staff uuid, p_create boolean)
returns uuid[]
language plpgsql
set search_path = public, extensions
as $$
declare
  v_n   int;
  v_ids uuid[];
begin
  select questions_per_attempt into v_n from client_quizzes where id = p_quiz;
  if v_n is null then
    select array_agg(x.id order by x.position) into v_ids
      from client_quiz_questions x where x.quiz_id = p_quiz and x.active;
    return v_ids;
  end if;

  select d.question_ids into v_ids
    from client_quiz_draws d
   where d.quiz_id = p_quiz and d.staff_id = p_staff and d.attempt_id is null;
  if v_ids is not null then
    if exists (
      select 1 from unnest(v_ids) u(id)
       where not exists (select 1 from client_quiz_questions x
                          where x.id = u.id and x.quiz_id = p_quiz and x.active)
    ) then
      delete from client_quiz_draws d
       where d.quiz_id = p_quiz and d.staff_id = p_staff and d.attempt_id is null;
      v_ids := null;
    else
      return v_ids;
    end if;
  end if;

  if not p_create then
    return null;
  end if;

  select array_agg(t.id order by t.rn) into v_ids
    from (select x.id, row_number() over (order by random()) as rn
            from client_quiz_questions x
           where x.quiz_id = p_quiz and x.active) t
   where t.rn <= v_n;
  if v_ids is null then
    return null;
  end if;
  insert into client_quiz_draws (quiz_id, staff_id, question_ids) values (p_quiz, p_staff, v_ids);
  return v_ids;
end $$;
comment on function public.client_quiz_draw(uuid, uuid, boolean) is
  'ADR-0111: the questions the worker''s current sitting is dealt — the open hand, or (p_create) a fresh random deal of questions_per_attempt. Null when there is no open hand and none is to be dealt. Internal to the quiz RPCs.';
revoke execute on function public.client_quiz_draw(uuid, uuid, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3 · The worker's read serves the hand
--
-- No longer `stable`: opening the quiz with attempts left deals the hand.
-- A passed or failed worker is dealt nothing — the slides stay readable,
-- the questions are not theirs to sit.
-- ---------------------------------------------------------------------
create or replace function public.staff_client_quiz(p_quiz uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_staff uuid := staff_caller();
  q       client_quizzes;
  v_used  int;
  v_passed boolean;
  v_ids   uuid[];
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
  v_ids    := client_quiz_draw(p_quiz, v_staff, (not v_passed and v_used < q.max_attempts));

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
    -- ADR-0111: how the questions are dealt. questionPool is every active
    -- question; questionsPerAttempt null means all of them, in order.
    'questionPool',    (select count(*)::int from client_quiz_questions x where x.quiz_id = q.id and x.active),
    'questionsPerAttempt', q.questions_per_attempt,
    'slides',          coalesce((select jsonb_agg(jsonb_build_object(
                                   'heading', sl.heading, 'note', sl.note,
                                   'columns', to_jsonb(sl.columns), 'rows', sl.rows)
                                   order by sl.position)
                                   from client_quiz_slides sl where sl.quiz_id = q.id), '[]'::jsonb),
    'questions',       coalesce((select jsonb_agg(jsonb_build_object(
                                   'id', x.id, 'questionNo', u.ord, 'prompt', x.prompt,
                                   'options', to_jsonb(x.options)) order by u.ord)
                                   from unnest(coalesce(v_ids, '{}'::uuid[])) with ordinality u(id, ord)
                                   join client_quiz_questions x on x.id = u.id), '[]'::jsonb),
    'attempts',        coalesce((select jsonb_agg(jsonb_build_object(
                                   'attemptNo', a.attempt_no, 'correct', a.correct, 'total', a.total,
                                   'percent', floor(a.score)::int, 'passed', a.passed,
                                   'takenAt', a.taken_at) order by a.attempt_no)
                                   from client_quiz_attempts a
                                  where a.quiz_id = q.id and a.staff_id = v_staff and not a.superseded), '[]'::jsonb)
  );
end $$;
comment on function public.staff_client_quiz(uuid) is
  'ADR-0110/0111: one client quiz for the caller — slides, the questions of their current sitting numbered 1..n WITHOUT correct_index (dealt at random from the pool when questions_per_attempt is set, kept until marked), and their attempts. Refused (quiz_not_required) unless a live booking of theirs names it or they have sat it.';
revoke execute on function public.staff_client_quiz(uuid) from public, anon;
grant  execute on function public.staff_client_quiz(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 4 · Marking is against the hand
--
-- p_answers: {"<question id>": <zero-based option index>, …} for every
-- question of the open hand — no fewer (incomplete), none other
-- (quiz_changed: the hand was replaced or never dealt; the screen starts
-- the sitting again). The hand closes on the attempt it was marked for.
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
  v_ids     uuid[];
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

  if not exists (select 1 from client_quiz_questions x where x.quiz_id = p_quiz and x.active) then
    raise exception 'quiz_has_no_questions' using errcode = 'P0001';
  end if;

  -- The hand this sitting was dealt. None open (the worker never opened
  -- the quiz, or the hand was thrown away): start again, not mark.
  v_ids := client_quiz_draw(p_quiz, v_staff, false);
  if v_ids is null then
    return jsonb_build_object('ok', false, 'reason', 'quiz_changed');
  end if;
  v_total := array_length(v_ids, 1);

  -- An answer to a question not on the hand: the set was replaced while
  -- they were answering, or it is not theirs to answer. Start again.
  if exists (
    select 1 from jsonb_object_keys(p_answers) k
     where not exists (select 1 from unnest(v_ids) u(id) where u.id::text = k)
  ) then
    return jsonb_build_object('ok', false, 'reason', 'quiz_changed');
  end if;

  for r in select x.id, x.options, x.correct_index
             from unnest(v_ids) u(id) join client_quiz_questions x on x.id = u.id loop
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

  -- The hand is this attempt's now; the next reading deals a fresh one.
  update client_quiz_draws d set attempt_id = v_attempt_id
   where d.quiz_id = p_quiz and d.staff_id = v_staff and d.attempt_id is null;

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
  'ADR-0110/0111: marks one sitting of a client quiz for the caller against the key the app never sees, on the hand the caller was dealt (client_quiz_draws) and nothing else. {ok, attemptNo, correct, total, percent, passed, attemptsLeft, outcome: passed | retry | failed}; refuses already_passed / no_attempts_left / incomplete / quiz_changed. A third failure emails the office (CR3).';

-- ---------------------------------------------------------------------
-- 5 · The office sees how the quiz deals
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
       r.kit_message,
       -- ADR-0111
       (select count(*)::int from client_quiz_questions x where x.quiz_id = q.id and x.active) as quiz_question_pool,
       q.questions_per_attempt as quiz_questions_per_attempt
  from client_role_requirements r
  join roles ro on ro.id = r.role_id
  left join client_quizzes q on q.id = r.quiz_id;
comment on view public.clients_shift_requirements_v is
  'ADR-0110/0111: the client card''s Shift requirements block — per role, the quiz (title, attempts, how many questions are dealt from how many) and the kit message. Office only (RLS on the base tables). The clients_ prefix is the office''s, not the portal''s (ADR-0004).';

-- ---------------------------------------------------------------------
-- 6 · The bar menu quiz: 35 questions, dealt 10 at a time
--
-- The first ten are the ten installed by 20261008180000, word for word
-- and in the same positions, so a quiz that has them keeps them. The
-- other twenty-five cover the rest of the menu as photographed on
-- 08.10.2026. Every key is read off the menu; THC checks the list here.
-- ---------------------------------------------------------------------
create or replace function public.bar_menu_quiz_questions()
returns table (question_no int, prompt text, options text[], correct_index int)
language sql
immutable
set search_path = public, extensions
as $$
  select * from (values
    -- The original ten (20261008180000).
    (1,  'How much is a bottle of Pinot Grigio delle Venezie, Corte Vigna?',
         array['£30.00', '£34.00', '£38.00', '£42.00'], 1),
    (2,  'Which white wine is the most expensive by the bottle?',
         array['Sauvignon Blanc, Flagstone Free Run', 'Chenin Blanc, Cullinan View',
               'Sancerre, Les Collinettes, Joseph Mellot', 'Pinot Grigio delle Venezie, Corte Vigna'], 2),
    (3,  'What size is a glass of still wine sold by the glass?',
         array['125ml', '150ml', '175ml', '250ml'], 2),
    (4,  'What size is a glass of Prosecco?',
         array['125ml', '150ml', '175ml', '250ml'], 0),
    (5,  'Which red wines are available by the glass?',
         array['Merlot and Don Jacobo Rioja Crianza', 'Tempranillo and Cabernet Sauvignon',
               'All four red wines', 'Merlot only'], 0),
    (6,  'How much is a 175ml glass of Don Jacobo Rioja Crianza?',
         array['£9.00', '£9.50', '£10.00', '£10.50'], 2),
    (7,  'Which gin costs £12.50 for a double?',
         array['Bombay Sapphire', 'The Botanist', 'Grey Goose', 'Kraken'], 1),
    (8,  'How much is a single Grey Goose?',
         array['£4.75', '£5.25', '£5.75', '£6.25'], 2),
    (9,  'How much is a bottle of Pommery Brut Rosé Royal?',
         array['£48.00', '£80.00', '£92.00', '£105.00'], 3),
    (10, 'What is added to the bill on top of the menu prices?',
         array['Nothing — prices are all-in', 'VAT at 20%',
               'A discretionary service charge of 12.5%', 'A fixed cover charge per guest'], 2),
    -- White wine.
    (11, 'How much is a bottle of Sancerre, Les Collinettes, Joseph Mellot?',
         array['£42.00', '£48.00', '£80.00', '£92.00'], 2),
    (12, 'Which white wines are sold by the glass?',
         array['Pinot Grigio and Chenin Blanc', 'Sauvignon Blanc and Sancerre',
               'All four white wines', 'Pinot Grigio only'], 0),
    (13, 'How much is a 175ml glass of Chenin Blanc, Cullinan View?',
         array['£9.00', '£9.50', '£10.00', '£10.50'], 0),
    (14, 'How much is a bottle of Sauvignon Blanc, Flagstone Free Run?',
         array['£34.00', '£38.00', '£42.00', '£48.00'], 2),
    -- Rosé.
    (15, 'How much is a bottle of the rosé, Belvino Pinot Grigio Rosato?',
         array['£34.00', '£38.00', '£42.00', '£48.00'], 1),
    (16, 'Is the rosé sold by the glass?',
         array['Yes — 175ml for £9.00', 'Yes — 125ml for £9.50',
               'No — by the bottle only', 'Yes — 175ml for £10.00'], 2),
    -- Red wine.
    (17, 'How much is a bottle of Cabernet Sauvignon Max Reserva, Errazuriz?',
         array['£40.00', '£42.00', '£48.00', '£80.00'], 2),
    (18, 'Which red wine is organic?',
         array['Merlot, Tekena', 'Tempranillo, Castillo de Mureva',
               'Don Jacobo Rioja Crianza', 'Cabernet Sauvignon Max Reserva'], 1),
    (19, 'How much is a bottle of Don Jacobo Rioja Crianza, Bodegas Corral?',
         array['£34.00', '£38.00', '£40.00', '£48.00'], 2),
    (20, 'How much is a 175ml glass of Merlot, Tekena?',
         array['£9.00', '£9.50', '£10.00', '£10.50'], 0),
    -- Sparkling wine and Champagne.
    (21, 'How much is a bottle of Mionetto Prestige Prosecco?',
         array['£38.00', '£42.00', '£48.00', '£92.00'], 2),
    (22, 'How much is a 125ml glass of Prosecco?',
         array['£9.00', '£9.50', '£10.00', '£10.50'], 1),
    (23, 'How much is a bottle of Pommery Brut Royal NV?',
         array['£80.00', '£92.00', '£105.00', '£120.00'], 1),
    (24, 'Which Champagnes are sold by the glass?',
         array['Both Pommery Champagnes', 'Pommery Brut Royal only',
               'Neither — by the bottle only', 'Pommery Brut Rosé only'], 2),
    -- Spirits.
    (25, 'How much is a double Absolut?',
         array['£9.00', '£9.50', '£10.50', '£11.50'], 1),
    (26, 'How much is a double Grey Goose?',
         array['£9.50', '£10.50', '£11.50', '£12.50'], 2),
    (27, 'How much is a single Bombay Sapphire?',
         array['£4.75', '£5.25', '£5.75', '£6.25'], 0),
    (28, 'How much is a single The Botanist?',
         array['£4.75', '£5.25', '£5.75', '£6.25'], 3),
    (29, 'How much is a double Kraken?',
         array['£9.50', '£10.50', '£11.50', '£12.00'], 1),
    (30, 'How much is a single Bacardi?',
         array['£4.75', '£5.25', '£5.75', '£6.00'], 0),
    (31, 'How much is a double Jack Daniel''s N7?',
         array['£9.50', '£10.50', '£12.00', '£12.50'], 1),
    (32, 'Which whisky costs £6.00 for a single?',
         array['Jack Daniel''s N7', 'JW Black Label', 'Martell VS', 'Kraken'], 1),
    (33, 'How much is a single Martell VS?',
         array['£4.75', '£5.25', '£5.75', '£6.00'], 1),
    (34, 'How much is a double Courvoisier VSOP?',
         array['£10.50', '£11.50', '£12.00', '£12.50'], 2),
    -- The bill.
    (35, 'Do the menu prices include VAT?',
         array['Yes — VAT is included', 'No — VAT is added at 20%', 'Only on wine', 'Only on spirits'], 0)
  ) v(question_no, prompt, options, correct_index)
$$;
comment on function public.bar_menu_quiz_questions() is
  'ADR-0111: the bar menu quiz''s question pool — question_no (the position), prompt, options, key — as installed and topped up by install_bar_menu_quiz(). Positions 1–10 are the original ten of 20261008180000.';
revoke execute on function public.bar_menu_quiz_questions() from public, anon, authenticated;

-- The installer: unchanged for a new client, and now a top-up for one that
-- has the quiz — the positions it lacks are added from the pool above,
-- the ones it has are left as they are (replace a question as data), and
-- ten per sitting is set where nothing was set.
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
    insert into client_quizzes (client_id, title, intro, pass_mark_percent, max_attempts, questions_per_attempt)
    values (p_client, c_title,
            'Before your first Bar or Wine Waiting Service shift with Leonardo Hotel St Paul''s M&E, read the bar menu and answer ten questions on it. Prices include VAT; a discretionary 12.5% service charge is added to the bill.',
            80, 3, 10)
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
  end if;

  -- The pool: whatever positions the quiz lacks. A new quiz gets all 35;
  -- one installed before ADR-0111 gets 11–35 beside its original ten.
  insert into client_quiz_questions (quiz_id, position, prompt, options, correct_index)
  select v_quiz, p.question_no, p.prompt, p.options, p.correct_index
    from bar_menu_quiz_questions() p
   where not exists (select 1 from client_quiz_questions x
                      where x.quiz_id = v_quiz and x.position = p.question_no);
  update client_quizzes set questions_per_attempt = 10
   where id = v_quiz and questions_per_attempt is null;

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
  'ADR-0110/0111: installs the Leonardo Royal Hotel bar menu quiz (10 slides, a pool of 35 questions dealt 10 per sitting, pass 80%, 3 attempts) for one client and the Bar Staff / Wine Waiting Service requirements that name it, with the kit message. Idempotent: a quiz already there is topped up to the full pool, never rewritten. Service role and migrations only.';
revoke execute on function public.install_bar_menu_quiz(uuid) from public, anon, authenticated;
grant  execute on function public.install_bar_menu_quiz(uuid) to service_role;

-- Top up every Leonardo card's quiz (the same match as 20261008180000).
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
  raise notice 'bar menu quiz topped up to 35 questions, 10 per sitting, for % client card(s)', v_count;
end $$;
