-- =====================================================================
-- 20261022130000 · A new client is created with its invoicing contact
--                   ADR-0176 (amended 21.10.2026)
--
-- THC, 21.10.2026: "Can 'invoicing contact' be a compulsory field when a
-- new client is created. A lot of clients have multiple email address the
-- invoice needs to be sent to. As a fallback if there is no invoice email
-- address, this should be sent to the main contact." And, with THC's
-- billing contacts list (Invoice To / Invoice CC columns): keep a real CC.
--
--   1 · Up to TEN invoice emails (was five) — the same ceiling as the
--       contact emails (ADR-0087) — and up to ten CC emails
--       (invoice_cc_emails, new). set_client_invoice_details() takes the
--       CC list; one normaliser, _invoice_email_list(), checks both.
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
--   4 · client.created records them (audit_client_change).
--   5 · The INV1 email is sent To the invoice emails (else the contact
--       emails) and CC the CC emails, less any address already in To.
--       invoices.cc_recipients keeps what was CC'd; the outbox row carries
--       the list as payload.cc, which the drain hands to Resend as `cc`.
--
-- The fallback is unchanged and already live: a client with no invoice
-- email (every client created before this migration) is invoiced at its
-- contact_emails, the main contact's addresses (invoice_groups,
-- queue_invoice_email — 20261022100000).
--
-- Forward-only.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · Ten invoice emails, ten CC emails, one normaliser
-- ---------------------------------------------------------------------
alter table public.clients drop constraint clients_invoice_emails_max;
alter table public.clients
  add constraint clients_invoice_emails_max check (coalesce(array_length(invoice_emails, 1), 0) <= 10);
alter table public.clients
  add column if not exists invoice_cc_emails text[] not null default '{}'::text[];
alter table public.clients
  add constraint clients_invoice_cc_emails_max check (coalesce(array_length(invoice_cc_emails, 1), 0) <= 10);

comment on column public.clients.invoice_emails is
  'ADR-0176: where the invoice is emailed (To; up to 10; at least one for a client created from 22.10.2026). Empty: the client''s contact_emails, the main contact.';
comment on column public.clients.invoice_cc_emails is
  'ADR-0176 (21.10.2026): copied on the invoice email (CC; up to 10), less any address already in To.';

-- Trimmed, lower-cased, de-duplicated, no blanks; at most ten; each an
-- address. The rule set_client_invoice_details() has applied since
-- 20261022100000, now shared with create_client().
create function public._invoice_email_list(p_emails text[])
returns text[]
language plpgsql immutable set search_path = public, extensions as $$
declare
  v_emails text[];
  e text;
begin
  select coalesce(array_agg(distinct lower(btrim(x))) filter (where btrim(x) <> ''), '{}')
    into v_emails from unnest(coalesce(p_emails, '{}')) x;
  if coalesce(array_length(v_emails, 1), 0) > 10 then
    raise exception 'too_many_invoice_emails' using errcode = '22023';
  end if;
  foreach e in array v_emails loop
    if e !~ '^[^\s@<>",]+@[^\s@<>",]+\.[^\s@<>",]{2,}$' then
      raise exception 'invalid_invoice_email' using errcode = '22023', detail = e;
    end if;
  end loop;
  return v_emails;
end $$;
revoke execute on function public._invoice_email_list(text[]) from public, anon;
grant execute on function public._invoice_email_list(text[]) to authenticated, service_role;

drop function public.set_client_invoice_details(uuid, text, text[], text);

create function public.set_client_invoice_details(
  p_client uuid, p_contact_name text, p_emails text[], p_address text,
  p_cc_emails text[] default null)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_emails text[];
  v_cc text[];
begin
  -- Finance: where an invoice (totals, charge rates) is emailed is a money
  -- decision (ADR-0056), not a scheduler's.
  perform assert_finance_caller();
  if not office_can('write') then
    raise exception 'not_permitted' using errcode = '42501', detail = 'write';
  end if;

  v_emails := _invoice_email_list(p_emails);
  v_cc := array(select x from unnest(_invoice_email_list(p_cc_emails)) x
                 where x <> all (v_emails) order by x);

  update clients
     set accounts_contact_name = nullif(btrim(coalesce(p_contact_name, '')), ''),
         invoice_emails = v_emails,
         invoice_cc_emails = v_cc,
         billing_address = nullif(btrim(coalesce(p_address, '')), '')
   where id = p_client;
  if not found then
    raise exception 'unknown_client' using errcode = 'P0002';
  end if;

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (now(), auth.uid(), 'client.invoice_details', 'client', p_client,
          jsonb_build_object('accountsContactName', nullif(btrim(coalesce(p_contact_name, '')), ''),
                             'invoiceEmails', to_jsonb(v_emails),
                             'invoiceCcEmails', to_jsonb(v_cc),
                             'billingAddress', nullif(btrim(coalesce(p_address, '')), '')));
end $$;

comment on function public.set_client_invoice_details(uuid, text, text[], text, text[]) is
  'ADR-0176: the client card''s accounts contact, invoice emails (To) and CC emails (each up to 10, validated, lower-cased; a CC already in To is dropped) and billing address. Finance callers that may write; audited as client.invoice_details.';

revoke execute on function public.set_client_invoice_details(uuid, text, text[], text, text[]) from public, anon;
grant execute on function public.set_client_invoice_details(uuid, text, text[], text, text[]) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2 · create_client() with the invoicing contact
-- ---------------------------------------------------------------------
drop function public.create_client(text, text, text, text, text[], boolean, boolean);

create function public.create_client(
  p_name text, p_contact_name text, p_phone text, p_staff_contact_point text,
  p_contact_emails text[], p_pays_breaks boolean, p_pays_buffer boolean,
  p_invoice_emails text[], p_accounts_contact_name text default null,
  p_billing_address text default null, p_invoice_cc_emails text[] default null
) returns uuid
language plpgsql security invoker set search_path = public, extensions as $$
declare
  v_id uuid;
  v_emails text[];
  v_cc text[];
  v_contact text := nullif(btrim(coalesce(p_accounts_contact_name, '')), '');
  v_address text := nullif(btrim(coalesce(p_billing_address, '')), '');
begin
  perform assert_client_input(p_name, p_contact_name, p_phone, p_staff_contact_point, p_contact_emails);
  if p_pays_breaks is null or p_pays_buffer is null then
    raise exception 'Both policies are mandatory; neither has a "not set" state'
      using errcode = 'check_violation';
  end if;

  -- The same normalising as set_client_invoice_details().
  v_emails := _invoice_email_list(p_invoice_emails);
  if coalesce(array_length(v_emails, 1), 0) = 0 then
    raise exception 'invoice_email_required' using errcode = '22023';
  end if;
  v_cc := array(select x from unnest(_invoice_email_list(p_invoice_cc_emails)) x
                 where x <> all (v_emails) order by x);
  if length(v_contact) > 200 or length(v_address) > 1000 then
    raise exception 'invoice_details_too_long' using errcode = '22001';
  end if;

  insert into clients (name, contact_name, phone, staff_contact_point, contact_emails,
                       pays_breaks, pays_buffer,
                       accounts_contact_name, invoice_emails, invoice_cc_emails, billing_address)
  values (btrim(p_name), btrim(p_contact_name), btrim(p_phone), btrim(p_staff_contact_point),
          (select array_agg(btrim(x)) from unnest(p_contact_emails) x),
          p_pays_breaks, p_pays_buffer,
          v_contact, v_emails, v_cc, v_address)
  returning id into v_id;
  return v_id;
end $$;

comment on function public.create_client(text, text, text, text, text[], boolean, boolean, text[], text, text, text[]) is
  'Creates a client (§9.7). Every §9.7 field is mandatory, including both policies, and so is at least one invoice email (ADR-0176, THC 21.10.2026; up to 10, and up to 10 CC). The accounts contact name, billing address and CC emails are optional — an empty name invoices the main contact.';

revoke execute on function public.create_client(text, text, text, text, text[], boolean, boolean, text[], text, text, text[]) from public, anon;
grant execute on function public.create_client(text, text, text, text, text[], boolean, boolean, text[], text, text, text[]) to authenticated, service_role;

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
     and new.invoice_cc_emails is not distinct from old.invoice_cc_emails
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
                               ''invoiceCcEmails'', to_jsonb(new.invoice_cc_emails),
                               ''billingAddress'', new.billing_address));
    return null;';
begin
  if (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1 then
    raise exception '20261022130000: audit_client_change — expected one match of the INSERT row';
  end if;
  execute replace(v_def, a, b);
end $$;

-- ---------------------------------------------------------------------
-- 5 · The invoice email carries the CC
-- ---------------------------------------------------------------------
alter table public.invoices
  add column if not exists cc_recipients text[] not null default '{}'::text[];
comment on column public.invoices.cc_recipients is
  'ADR-0176 (21.10.2026): who the last INV1 email was copied to — the client''s invoice_cc_emails at send time, less the To recipients.';

-- The client's CC list, less anyone already in To.
create function public._invoice_cc(p_client uuid, p_to text[])
returns text[]
language sql stable set search_path = public, extensions as $$
  select coalesce(array(select x from unnest(c.invoice_cc_emails) x
                         where lower(x) <> all (select lower(t) from unnest(coalesce(p_to, '{}')) t)
                         order by x), '{}')
    from clients c where c.id = p_client
$$;
revoke execute on function public._invoice_cc(uuid, text[]) from public, anon, authenticated;
grant execute on function public._invoice_cc(uuid, text[]) to service_role;

do $$
declare
  v_def text := pg_get_functiondef('public.queue_invoice_email(uuid)'::regprocedure);
  a1 text := 'values (v_key, ''email'', ''INV1'', i.recipients, _invoice_email_payload(i.id))';
  b1 text := 'values (v_key, ''email'', ''INV1'', i.recipients,
          _invoice_email_payload(i.id)
            || jsonb_build_object(''cc'', to_jsonb(_invoice_cc(i.client_id, i.recipients))::text))';
  a2 text := 'lease_until = null, last_error = null';
  b2 text := 'lease_until = null, last_error = null,
         cc_recipients = _invoice_cc(i.client_id, i.recipients)';
begin
  if (length(v_def) - length(replace(v_def, a1, ''))) / length(a1) <> 1
     or (length(v_def) - length(replace(v_def, a2, ''))) / length(a2) <> 1 then
    raise exception '20261022130000: queue_invoice_email — expected one match of each fragment';
  end if;
  execute replace(replace(v_def, a1, b1), a2, b2);
end $$;

do $$
declare
  v_def text := pg_get_functiondef('public.resend_invoice_email(uuid)'::regprocedure);
  a1 text := 'values (v_key, ''email'', ''INV1'', v_to, _invoice_email_payload(i.id));';
  b1 text := 'values (v_key, ''email'', ''INV1'', v_to,
          _invoice_email_payload(i.id)
            || jsonb_build_object(''cc'', to_jsonb(_invoice_cc(i.client_id, v_to))::text));';
  a2 text := 'update invoices set outbox_key = v_key, recipients = v_to,';
  b2 text := 'update invoices set outbox_key = v_key, recipients = v_to,
                      cc_recipients = _invoice_cc(i.client_id, v_to),';
begin
  if (length(v_def) - length(replace(v_def, a1, ''))) / length(a1) <> 1
     or (length(v_def) - length(replace(v_def, a2, ''))) / length(a2) <> 1 then
    raise exception '20261022130000: resend_invoice_email — expected one match of each fragment';
  end if;
  execute replace(replace(v_def, a1, b1), a2, b2);
end $$;

comment on function public.queue_invoice_email(uuid) is
  'ADR-0176: the INV1 email for an issued invoice, keyed INV1:<number>, to the snapshotted recipients and CC the client''s invoice_cc_emails (less To; payload.cc, invoices.cc_recipients), with the invoice PDF and the sign-in and sign-out log attached. Service role.';
