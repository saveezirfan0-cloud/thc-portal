-- =====================================================================
-- 20261022130000 · A new client is created with its invoicing contact
--                   ADR-0176 (amended 21.10.2026)
--
-- THC, 21.10.2026: "Can 'invoicing contact' be a compulsory field when a
-- new client is created. A lot of clients have multiple email address the
-- invoice needs to be sent to. As a fallback if there is no invoice email
-- address, this should be sent to the main contact."
--
--   1 · Up to TEN invoice emails (was five) — the same ceiling as the
--       contact emails (ADR-0087). clients_invoice_emails_max and
--       set_client_invoice_details() move together.
--   2 · create_client() takes the invoicing contact and refuses a client
--       with no invoice email (`invoice_email_required`). The accounts
--       contact name and the billing address stay optional: an empty name
--       puts the main contact under "Invoice to", as before. The old
--       seven-argument create_client() is dropped, so no caller can skip
--       the new rule; update_client() is unchanged (the card's Invoicing
--       panel edits these columns, finance only).
--   3 · clients_invoice_details_guard lets the creating INSERT carry the
--       invoice columns — whoever may add a client may say where its
--       invoices go. Changing them afterwards stays finance only.
--
-- The fallback is unchanged and already live: a client with no invoice
-- email (every client created before this migration) is invoiced at its
-- contact_emails, the main contact's addresses (invoice_groups,
-- queue_invoice_email — 20261022100000).
--
-- Forward-only.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · Ten invoice emails
-- ---------------------------------------------------------------------
alter table public.clients drop constraint clients_invoice_emails_max;
alter table public.clients
  add constraint clients_invoice_emails_max check (coalesce(array_length(invoice_emails, 1), 0) <= 10);

comment on column public.clients.invoice_emails is
  'ADR-0176: where the invoice is emailed (up to 10; at least one for a client created from 22.10.2026). Empty: the client''s contact_emails, the main contact.';

do $$
declare
  v_def text := pg_get_functiondef('public.set_client_invoice_details(uuid, text, text[], text)'::regprocedure);
  a text := 'coalesce(array_length(v_emails, 1), 0) > 5 then';
begin
  if (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1 then
    raise exception '20261022130000: set_client_invoice_details — expected one match of the limit';
  end if;
  execute replace(v_def, a, 'coalesce(array_length(v_emails, 1), 0) > 10 then');
end $$;

comment on function public.set_client_invoice_details(uuid, text, text[], text) is
  'ADR-0176: the client card''s accounts contact, invoice emails (up to 10, validated, lower-cased) and billing address. Finance callers that may write; audited as client.invoice_details.';

-- ---------------------------------------------------------------------
-- 2 · create_client() with the invoicing contact
-- ---------------------------------------------------------------------
drop function public.create_client(text, text, text, text, text[], boolean, boolean);

create function public.create_client(
  p_name text, p_contact_name text, p_phone text, p_staff_contact_point text,
  p_contact_emails text[], p_pays_breaks boolean, p_pays_buffer boolean,
  p_invoice_emails text[], p_accounts_contact_name text default null,
  p_billing_address text default null
) returns uuid
language plpgsql security invoker set search_path = public, extensions as $$
declare
  v_id uuid;
  v_emails text[];
  v_contact text := nullif(btrim(coalesce(p_accounts_contact_name, '')), '');
  v_address text := nullif(btrim(coalesce(p_billing_address, '')), '');
  e text;
begin
  perform assert_client_input(p_name, p_contact_name, p_phone, p_staff_contact_point, p_contact_emails);
  if p_pays_breaks is null or p_pays_buffer is null then
    raise exception 'Both policies are mandatory; neither has a "not set" state'
      using errcode = 'check_violation';
  end if;

  -- The same normalising as set_client_invoice_details(): trimmed,
  -- lower-cased, de-duplicated, no blanks.
  select coalesce(array_agg(distinct lower(btrim(x))) filter (where btrim(x) <> ''), '{}')
    into v_emails from unnest(coalesce(p_invoice_emails, '{}')) x;
  if coalesce(array_length(v_emails, 1), 0) = 0 then
    raise exception 'invoice_email_required' using errcode = '22023';
  end if;
  if array_length(v_emails, 1) > 10 then
    raise exception 'too_many_invoice_emails' using errcode = '22023';
  end if;
  foreach e in array v_emails loop
    if e !~ '^[^\s@<>",]+@[^\s@<>",]+\.[^\s@<>",]{2,}$' then
      raise exception 'invalid_invoice_email' using errcode = '22023', detail = e;
    end if;
  end loop;
  if length(v_contact) > 200 or length(v_address) > 1000 then
    raise exception 'invoice_details_too_long' using errcode = '22001';
  end if;

  insert into clients (name, contact_name, phone, staff_contact_point, contact_emails,
                       pays_breaks, pays_buffer,
                       accounts_contact_name, invoice_emails, billing_address)
  values (btrim(p_name), btrim(p_contact_name), btrim(p_phone), btrim(p_staff_contact_point),
          (select array_agg(btrim(x)) from unnest(p_contact_emails) x),
          p_pays_breaks, p_pays_buffer,
          v_contact, v_emails, v_address)
  returning id into v_id;
  return v_id;
end $$;

comment on function public.create_client(text, text, text, text, text[], boolean, boolean, text[], text, text) is
  'Creates a client (§9.7). Every §9.7 field is mandatory, including both policies, and so is at least one invoice email (ADR-0176, THC 21.10.2026; up to 10). The accounts contact name and billing address are optional — an empty name invoices the main contact.';

revoke execute on function public.create_client(text, text, text, text, text[], boolean, boolean, text[], text, text) from public, anon;
grant execute on function public.create_client(text, text, text, text, text[], boolean, boolean, text[], text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3 · The creating INSERT may carry the invoice columns
-- ---------------------------------------------------------------------
create or replace function public.clients_invoice_details_guard()
returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if auth.uid() is null or tg_op = 'INSERT' then
    return new;
  end if;
  if new.accounts_contact_name is not distinct from old.accounts_contact_name
     and new.invoice_emails is not distinct from old.invoice_emails
     and new.billing_address is not distinct from old.billing_address then
    return new;
  end if;
  if not office_can('finance') then
    raise exception 'not_permitted' using errcode = '42501', detail = 'finance';
  end if;
  return new;
end $$;

comment on function public.clients_invoice_details_guard() is
  'ADR-0176: a client''s invoice details are set when it is created (create_client, by whoever may add a client) and change afterwards only for a finance caller (or the service role). Trigger.';

-- ---------------------------------------------------------------------
-- 4 · client.created records where the invoices go
-- ---------------------------------------------------------------------
-- create_client() is invoker-rights and audit_log has no insert policy,
-- so the record rides on the definer trigger that already writes
-- client.created (20261014093200).
do $$
declare
  v_def text := pg_get_functiondef('public.audit_client_change()'::regprocedure);
  a text := '''paysBuffer'', new.pays_buffer));
    return null;';
  b text := '''paysBuffer'', new.pays_buffer,
                               ''accountsContactName'', new.accounts_contact_name,
                               ''invoiceEmails'', to_jsonb(new.invoice_emails),
                               ''billingAddress'', new.billing_address));
    return null;';
begin
  if (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1 then
    raise exception '20261022130000: audit_client_change — expected one match of the INSERT row';
  end if;
  execute replace(v_def, a, b);
end $$;
