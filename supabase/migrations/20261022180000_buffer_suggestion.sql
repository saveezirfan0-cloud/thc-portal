-- =====================================================================
-- Migration 20261022180000 · the suggested buffer ("overs") (ADR-0181)
--
-- THC works to a rule of one extra person for every five staff. The Shift
-- Builder pre-fills a new role section's Buffer with it and stops following
-- once the manager types one; a saved buffer is never changed by it. The
-- buffer itself is unchanged: an absolute number per role section (§3.2),
-- typed or accepted by the manager, stored in shift_requirements.buffer.
--
-- The client's answers (21.10.2026): seven staff get two overs (round up);
-- a role under five gets none, unless it starts early — then one extra,
-- just in case. The rule is a setting, owner-editable on /settings like
-- every other (the `settings` policies and the settings_audit trigger
-- apply):
--
--   buffer_suggestion = {"enabled": true, "per": 5, "rounding": "up",
--                        "from_headcount": 5, "early_start_before": "08:00",
--                        "early_start_extra": 1}
--
--     enabled             JSON boolean — off: no suggestion, a new section
--                         starts at 0
--     per                 whole number 1–100 — one extra for every `per` staff
--     rounding            "down" | "up" — 7 staff at 1 per 5 is 1 or 2
--     from_headcount      whole number 0–100 — a role with fewer staff gets
--                         no extras by the group rule…
--     early_start_before  "HH:MM" (UK time) or null — …unless the role
--                         section's OWN start (RULE-18) is before this
--     early_start_extra   whole number 0–20 — …then this many
--
-- settings_buffer_suggestion_guard refuses any other shape (22023), so a
-- typo can never become a rule the builder cannot read. The reading of it
-- is TypeScript only (packages/domain/src/bufferSuggestion.ts suggestBuffer
-- / readBufferRule; the accepted and refused shapes are in
-- bufferSuggestion.vectors.json); nothing in the database computes a
-- buffer, and no auto-assign path reads this row.
--
-- Forward-only. pgTAP 916 pins it.
-- =====================================================================

insert into public.settings (key, value) values
  ('buffer_suggestion',
   '{"enabled": true, "per": 5, "rounding": "up", "from_headcount": 5, "early_start_before": "08:00", "early_start_extra": 1}'::jsonb)
on conflict (key) do nothing;

create or replace function public.settings_buffer_suggestion_guard()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
declare
  v  jsonb := new.value;
  ok boolean;
begin
  if new.key <> 'buffer_suggestion' then
    return new;
  end if;

  -- Shape, then types, then values: each step only runs once the one before
  -- has made it safe (SQL does not promise to short-circuit `and`, and
  -- jsonb_object_keys throws on anything but an object).
  ok := jsonb_typeof(v) = 'object';
  if ok then
    ok := (select array_agg(k collate "C" order by k collate "C") from jsonb_object_keys(v) k)
          = array['early_start_before', 'early_start_extra', 'enabled', 'from_headcount', 'per', 'rounding'];
  end if;
  if coalesce(ok, false) then
    ok := jsonb_typeof(v -> 'enabled') = 'boolean'
      and jsonb_typeof(v -> 'per') = 'number'
      and jsonb_typeof(v -> 'rounding') = 'string'
      and jsonb_typeof(v -> 'from_headcount') = 'number'
      and jsonb_typeof(v -> 'early_start_before') in ('null', 'string')
      and jsonb_typeof(v -> 'early_start_extra') = 'number';
  end if;
  if coalesce(ok, false) then
    ok := (v ->> 'rounding') in ('down', 'up')
      and (v ->> 'per')::numeric = trunc((v ->> 'per')::numeric)
      and (v ->> 'per')::numeric between 1 and 100
      and (v ->> 'from_headcount')::numeric = trunc((v ->> 'from_headcount')::numeric)
      and (v ->> 'from_headcount')::numeric between 0 and 100
      and (v ->> 'early_start_extra')::numeric = trunc((v ->> 'early_start_extra')::numeric)
      and (v ->> 'early_start_extra')::numeric between 0 and 20
      and (jsonb_typeof(v -> 'early_start_before') = 'null'
           or (v ->> 'early_start_before') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
  end if;

  if not coalesce(ok, false) then
    raise exception 'buffer_suggestion_invalid' using errcode = '22023',
      hint = 'settings.buffer_suggestion is {"enabled": true|false, "per": 1–100, "rounding": "down"|"up", "from_headcount": 0–100, "early_start_before": "HH:MM"|null, "early_start_extra": 0–20}, whole numbers, no other keys (ADR-0181).';
  end if;
  return new;
end $$;

comment on function public.settings_buffer_suggestion_guard() is
  'ADR-0181: settings.buffer_suggestion must be exactly {enabled boolean, per whole 1–100, rounding down|up, from_headcount whole 0–100, early_start_before "HH:MM" or null, early_start_extra whole 0–20}; anything else is refused (22023 buffer_suggestion_invalid). The Shift Builder reads it to pre-fill a new role section''s Buffer.';

drop trigger if exists settings_buffer_suggestion_guard on public.settings;
create trigger settings_buffer_suggestion_guard
  before insert or update on public.settings
  for each row execute function public.settings_buffer_suggestion_guard();

revoke execute on function public.settings_buffer_suggestion_guard() from public, anon, authenticated;
