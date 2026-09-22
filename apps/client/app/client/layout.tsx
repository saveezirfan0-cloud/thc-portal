/* eslint-disable @typescript-eslint/no-explicit-any -- packages/db ships a
   placeholder Database type (Views and Functions are Record<string, never>)
   until `pnpm --filter @thc/db gen:types` runs against a live project, so
   every view and RPC is typed `never`. The shapes are asserted instead by
   supabase/tests/160_client_portal.sql, which checks them against the real
   schema rather than against a stub. */

import Link from 'next/link';
import { cookies } from 'next/headers';
import { createClient } from '@thc/db/server';
import { Avatar, Logo, SignOut } from '@thc/ui';
import { supabaseConfigured } from './data';
import './client-portal.css';

/**
 * The Client Portal chrome — top bar, no sidebar.
 *
 * `wireframes/client/events.html` is explicit about the shape: "top bar
 * only, no sidebar (the client has one list and one page per event)". The
 * Back Office rail would be a rail to nowhere here, and §1.4 keeps the
 * customer out of the back office entirely.
 *
 * The bar carries who is signed in, because a customer with several venues
 * needs to know which company's events they are looking at before they read
 * a single row (§11.1: "They see only their own events").
 */
async function signedInAs(): Promise<{ company: string | null; person: string | null }> {
  if (!supabaseConfigured()) return { company: null, person: null };

  const supabase = createClient(await cookies()) as any;
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return { company: null, person: null };

  // profiles carries the client's own row (full_name + client_id) and
  // clients carries the company name. Both are readable by this role;
  // neither carries money (§11.1).
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, client_id')
    .eq('id', auth.user.id)
    .maybeSingle();

  let company: string | null = null;
  if (profile?.client_id) {
    const { data: client } = await supabase
      .from('clients')
      .select('name')
      .eq('id', profile.client_id)
      .maybeSingle();
    company = client?.name ?? null;
  }

  return { company, person: profile?.full_name ?? auth.user.email ?? null };
}

export default async function ClientPortalLayout({ children }: { children: React.ReactNode }) {
  const { company, person } = await signedInAs();

  return (
    <>
      <header className="ctop">
        <Link href="/client" className="brand">
          <Logo />
          <span>
            <span className="name">The Hospitality Company</span>
            <span className="sub">Client Portal</span>
          </span>
        </Link>

        {company ? (
          <span className="who">
            <span className="l">Signed in as</span>
            <span className="n">{company}</span>
          </span>
        ) : null}

        <span className="spacer" style={{ flex: 1 }} />

        {person ? (
          <>
            <Avatar name={person} size="sm" />
            <span className="sm">{person}</span>
          </>
        ) : null}

        <SignOut />
      </header>

      <div className="cwrap">{children}</div>
    </>
  );
}
