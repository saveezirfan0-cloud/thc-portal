/** §1.4. Every table is protected by RLS; the app layer only routes. */
export const ROLES = ['admin', 'client', 'staff'] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/**
 * Where each role lands inside ITS OWN app. These are paths, not URLs: the
 * three apps are on three different hosts, so this cannot send anyone
 * across apps and must never be used to try.
 *
 * Never `/`. Each app's root page REDIRECTS to its home, so a home of `/`
 * is a page redirecting to itself — the Staff App did exactly that
 * (`redirect(HOME_PATH.staff)` from `/`) and every visitor got Safari's
 * "cannot follow more than 20 redirections". Keep each on a real screen.
 */
export const HOME_PATH: Readonly<Record<Role, string>> = {
  admin: '/dashboard',
  client: '/client',
  staff: '/shifts',
};

/**
 * The body served when a signed-in user opens an app their role has no
 * business in — an admin landing on the Staff App, say.
 *
 * It is deliberately NOT a redirect. The apps are on separate hosts, so
 * middleware cannot send anyone to their own app; redirecting to a local
 * path just fails the same role check again, which is exactly the
 * ERR_TOO_MANY_REDIRECTS this replaces. A terminal response cannot loop.
 *
 * Inline styling on purpose: this has to render before, and independently
 * of, anything the app itself loads, so it cannot read the design tokens.
 * The few values below copy the warm grounds of packages/ui tokens.css —
 * cream card on the cream ground, or navy by `prefers-color-scheme` — and
 * its pill + gradient primary, so the page reads as THC's, not a browser
 * error. Plus Jakarta Sans when the device has it, else the system face.
 */
export function wrongAppBody(role: Role | null, appName: string): string {
  const safeRole =
    role === 'admin'
      ? 'Back Office'
      : role === 'client'
        ? 'Client Portal'
        : role === 'staff'
          ? 'Staff'
          : null;
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Wrong app for this account</title>
<style>
  :root{color-scheme:light dark;--bg:#faf7f4;--card:#fff;--ink:#241d16;--muted:#7a6b5c;
    --line:#ebe4da;--btn:linear-gradient(135deg,#0a6d79,#7758cd);--on:#fff}
  @media (prefers-color-scheme:dark){:root{--bg:#0a0e18;--card:#171b26;--ink:#e9eef5;
    --muted:#9aa5b4;--line:#252a36;--btn:linear-gradient(135deg,#3edcec,#8f7bff);--on:#0a0e18}}
  body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;
    box-sizing:border-box;background:var(--bg);color:var(--ink);
    font:16px/1.6 'Plus Jakarta Sans',system-ui,sans-serif}
  main{max-width:34rem;background:var(--card);border:1px solid var(--line);
    border-radius:28px;padding:28px 32px;box-shadow:0 10px 26px -14px rgba(36,29,22,.16)}
  h1{font-size:1.4rem;line-height:1.3;margin:0 0 .5rem}
  p{margin:0 0 1.25rem;color:var(--muted)}
  form{margin:0}
  button{font:inherit;font-weight:600;cursor:pointer;min-height:44px;padding:0 1.4rem;
    border:0;border-radius:999px;background:var(--btn);color:var(--on)}
  button:focus-visible{outline:2px solid var(--ink);outline-offset:3px}
</style></head><body><main>
<h1>This account is not for the ${appName}</h1>
<p>${
    safeRole
      ? `You are signed in to a ${safeRole} account.`
      : 'Your account has no role set, so it cannot be admitted to any app.'
  } Sign out and use the account for this app.</p>
<form method="post" action="/auth/signout"><button type="submit">Sign out</button></form>
</main></body></html>`;
}
