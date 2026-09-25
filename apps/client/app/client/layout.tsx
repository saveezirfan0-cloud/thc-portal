/* eslint-disable @typescript-eslint/no-explicit-any -- packages/db ships a
   placeholder Database type (Views and Functions are Record<string, never>)
   until `pnpm --filter @thc/db gen:types` runs against a live project, so
   every view and RPC is typed `never`. The shapes are asserted instead by
   supabase/tests/160_client_portal.sql, which checks them against the real
   schema rather than against a stub. */

import Link from 'next/link';
import { cookies } from 'next/headers';
import { createClient } from '@thc/db/server';
import { Avatar, Logo, ModeSwitch, SignOut } from '@thc/ui';
import { AccountMenu } from './AccountMenu';
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
 *
 * It also carries the appearance switch (ADR-0007). This is the only chrome
 * the portal has, so if the switch is not here the customer has no way to
 * reach it at all.
 */
async function signedInAs(): Promise<{ company: string | null; person: string | null }> {
  if (!supabaseConfigured()) return { company: null, person: null };

  const supabase = createClient(await cookies()) as any;
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return { company: null, person: null };

  // The person comes from their own profiles row (profiles_self). The
  // company name comes from client_company_v, NOT from `clients`: the client
  // role holds no policy on that table and must not be given one (ADR-0004),
  // so reading it here always came back null (audit 24.09 §2.2). The view
  // runs with owner rights and returns the caller's own company only
  // (20260927120000, supabase/tests/570_client_company_view.sql).
  const [{ data: profile }, { data: company }] = await Promise.all([
    supabase.from('profiles').select('full_name').eq('id', auth.user.id).maybeSingle(),
    supabase.from('client_company_v').select('name').maybeSingle(),
  ]);

  return {
    company: company?.name ?? null,
    person: profile?.full_name ?? auth.user.email ?? null,
  };
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
            {/* On a phone the company takes this line, so whose events these
                are is visible without opening the menu (§11.1). */}
            {company ? <span className="sub co">{company}</span> : null}
          </span>
        </Link>

        {company ? (
          <span className="who">
            <span className="l">Signed in as</span>
            <span className="n">{company}</span>
          </span>
        ) : null}

        <span className="spacer" />

        <AccountMenu>
          {company ? (
            <span className="menu-who">
              <span className="l">Signed in as</span>
              <span className="n">{company}</span>
            </span>
          ) : null}
          {person ? (
            <span className="me">
              <Avatar name={person} size="sm" />
              <span className="sm">{person}</span>
            </span>
          ) : null}
          <span className="mode">
            <span className="l">Appearance</span>
            <ModeSwitch small />
          </span>
          <SignOut />
        </AccountMenu>
      </header>

      <div className="cwrap">{children}</div>
    </>
  );
}
