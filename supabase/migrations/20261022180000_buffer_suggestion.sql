-- =====================================================================
-- Migration 20261022180000 · the suggested buffer ("overs") (ADR-0181)
--
-- THC works to a rule of one extra person for every five staff. The Shift
-- Builder pre-fills a new role section's Buffer with it and stops following
-- once the manager types one; a saved buffer is never changed by it. The
-- buffer itself is unchanged: an absolute number per role section (§3.2),
-- typed or accepted by the manager, stored in shift_requirements.buffer.
--
-- Two answers are still with the client (under five: 0 or 1? seven: 1 or
-- 2?), so the rule is a setting, owner-editable on /settings like every
-- other (the `settings` policies and the settings_audit trigger apply):
--
--   buffer_suggestion = {"enabled": true, "per": 5, "rounding": "down", "minimum": 0}
--
--     enabled   JSON boolean — off: no suggestion, a new section starts at 0
--     per       whole number 1–100 — one extra for every `per` staff
--     rounding  "down" | "up" — 7 staff at 1 per 5 is 1 (down) or 2 (up)
--     minimum   whole number 0–20 — the fewest extras on a role with
--               anyone on it
--
-- settings_buffer_suggestion_guard refuses any other shape (22023), so a
-- typo can never become a rule the builder cannot read. The reading of it
-- is TypeScript only (packages/domain/src/buffer.ts suggestBuffer /
-- readBufferRule); nothing in the database computes a buffer, and no
-- auto-assign path reads this row.
--
-- Forward-only. pgTAP 916 pins it.
-- =====================================================================

insert into public.settings (key, value) values
  ('buffer_suggestion', '{"enabled": true, "per": 5, "rounding": "down", "minimum": 0}'::jsonb)
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

  -- Nested, so no cast ever meets a value of the wrong type.
  ok := jsonb_typeof(v) = 'object'
    and (select count(*) from jsonb_object_keys(v)) = 4
    and jsonb_typeof(v -> 'enabled') = 'boolean'
    and jsonb_typeof(v -> 'per') = 'number'
    and jsonb_typeof(v -> 'minimum') = 'number'
    and jsonb_typeof(v -> 'rounding') = 'string';
  if ok then
    ok := (v ->> 'rounding') in ('down', 'up')
      and (v ->> 'per')::numeric = trunc((v ->> 'per')::numeric)
      and (v ->> 'per')::numeric between 1 and 100
      and (v ->> 'minimum')::numeric = trunc((v ->> 'minimum')::numeric)
      and (v ->> 'minimum')::numeric between 0 and 20;
  end if;

  if not coalesce(ok, false) then
    raise exception 'buffer_suggestion_invalid' using errcode = '22023',
      hint = 'settings.buffer_suggestion is {"enabled": true|false, "per": 1–100, "rounding": "down"|"up", "minimum": 0–20}, whole numbers, no other keys (ADR-0181).';
  end if;
  return new;
end $$;

comment on function public.settings_buffer_suggestion_guard() is
  'ADR-0181: settings.buffer_suggestion must be exactly {enabled boolean, per whole 1–100, rounding down|up, minimum whole 0–20}; anything else is refused (22023 buffer_suggestion_invalid). The Shift Builder reads it to pre-fill a new role section''s Buffer.';

drop trigger if exists settings_buffer_suggestion_guard on public.settings;
create trigger settings_buffer_suggestion_guard
  before insert or update on public.settings
  for each row execute function public.settings_buffer_suggestion_guard();

revoke execute on function public.settings_buffer_suggestion_guard() from public, anon, authenticated;
