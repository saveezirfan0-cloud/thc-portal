-- =====================================================================
-- Column chooser — each Back Office login's columns, per list (ADR-0139)
--
-- The owner approved (14.10.2026, release audit package F) a column
-- chooser on the Back Office lists: show / hide and reorder a table's
-- columns, remembered per person. The choice is a DISPLAY preference, the
-- same kind as the 12/24-hour clock (ADR-0085), and is stored the same
-- way: a column on the person's own `profiles` row, read and written
-- through two definer functions that touch only the caller's row.
--
--   profiles.list_columns   {"<list key>": {"order": [ids…], "hidden": [ids…]}, …}
--
-- "order" is the movable columns in the person's order and "hidden" the
-- ones they hid; the screen's own declaration supplies everything else
-- (labels, widths, which columns are required, which are money), so a
-- stored choice can never show a column a login may not see — a finance
-- column is dropped by the screen for a login without finance (ADR-0061)
-- whatever the row says, and the data behind it is refused by the
-- database anyway.
--
-- Who: office logins only. The Staff App and the Client Portal have no
-- chooser; their functions refuse rather than store something nothing
-- reads. A viewer (ADR-0060) may set its own — a preference changes no
-- data, which is why it is not audited either.
--
-- Read: `profiles` already has one policy, `profiles_self` (select, own
-- row) — so the column is self-only through the table too. Write: there is
-- no UPDATE policy on `profiles`, and none is added; set_my_list_columns()
-- is the only door.
-- =====================================================================

alter table profiles
  add column if not exists list_columns jsonb not null default '{}'::jsonb;

-- Shape and size are held by the table as well as by the function: an
-- object, at most 64 KB. (Each list's own shape is the function's job.)
alter table profiles
  drop constraint if exists profiles_list_columns_shape;
alter table profiles
  add constraint profiles_list_columns_shape
  check (jsonb_typeof(list_columns) = 'object' and pg_column_size(list_columns) <= 65536);

comment on column profiles.list_columns is
  'ADR-0139: this login''s Back Office column choice per list — {"<list key>": {"order": [...], "hidden": [...]}}. Display only. Read through my_list_columns(), written through set_my_list_columns().';

-- ---------------------------------------------------------------------
-- my_list_columns — the caller's own choices, every list
-- ---------------------------------------------------------------------
create or replace function public.my_list_columns() returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  -- '{}' for anyone without an office profile (or no session): the
  -- screens then draw their defaults.
  select coalesce(
    (select list_columns from profiles where id = auth.uid() and role = 'admin'),
    '{}'::jsonb
  )
$$;

comment on function public.my_list_columns() is
  'ADR-0139: the signed-in office login''s column choices, keyed by list; ''{}'' for anyone else.';

-- ---------------------------------------------------------------------
-- set_my_list_columns — one list's choice; NULL puts the list back to
-- its default
-- ---------------------------------------------------------------------
create or replace function public.set_my_list_columns(p_list text, p_columns jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_key  text;
  v_id   jsonb;
  v_next jsonb;
begin
  if v_uid is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if not exists (select 1 from profiles where id = v_uid and role = 'admin') then
    raise exception 'not_office' using errcode = '42501';
  end if;
  if p_list is null or p_list !~ '^[a-z][a-z0-9_.-]{0,63}$' then
    raise exception 'list_key_invalid' using errcode = 'P0001';
  end if;

  if p_columns is not null and jsonb_typeof(p_columns) <> 'null' then
    if jsonb_typeof(p_columns) <> 'object' then
      raise exception 'list_columns_invalid' using errcode = 'P0001';
    end if;
    for v_key in select jsonb_object_keys(p_columns) loop
      if v_key not in ('order', 'hidden') then
        raise exception 'list_columns_invalid' using errcode = 'P0001';
      end if;
    end loop;
    foreach v_key in array array['order', 'hidden'] loop
      if not (p_columns ? v_key) then
        raise exception 'list_columns_invalid' using errcode = 'P0001';
      end if;
      if jsonb_typeof(p_columns -> v_key) <> 'array'
         or jsonb_array_length(p_columns -> v_key) > 50 then
        raise exception 'list_columns_invalid' using errcode = 'P0001';
      end if;
      for v_id in select value from jsonb_array_elements(p_columns -> v_key) loop
        if jsonb_typeof(v_id) <> 'string' or (v_id #>> '{}') !~ '^[a-z][a-z0-9_-]{0,39}$' then
          raise exception 'list_columns_invalid' using errcode = 'P0001';
        end if;
      end loop;
    end loop;
  end if;

  update profiles
     set list_columns = case
           when p_columns is null or jsonb_typeof(p_columns) = 'null' then list_columns - p_list
           else jsonb_set(list_columns, array[p_list],
                          jsonb_build_object('order', p_columns -> 'order',
                                             'hidden', p_columns -> 'hidden'))
         end
   where id = v_uid
  returning list_columns into v_next;

  -- More lists than any Back Office has (the table's 64 KB check is the
  -- backstop for the bytes).
  if (select count(*) from jsonb_object_keys(v_next)) > 100 then
    raise exception 'list_columns_too_many' using errcode = 'P0001';
  end if;
  return coalesce(v_next -> p_list, 'null'::jsonb);
end;
$$;

comment on function public.set_my_list_columns(text, jsonb) is
  'ADR-0139: the signed-in office login sets its own column choice for one list ({"order": [...], "hidden": [...]}); NULL removes it (back to the default). Own profiles row only; a display preference, so not audited.';

revoke all on function public.my_list_columns()                 from public, anon;
revoke all on function public.set_my_list_columns(text, jsonb)  from public, anon;
grant execute on function public.my_list_columns()              to authenticated;
grant execute on function public.set_my_list_columns(text, jsonb) to authenticated;
