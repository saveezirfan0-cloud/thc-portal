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
 * Every one of these pointed at a route that did not exist — `/dashboard`,
 * `/events`, `/shifts` are all still unbuilt — which turned the wrong-app
 * redirect into an infinite loop. Keep them on a route that exists.
 */
export const HOME_PATH: Readonly<Record<Role, string>> = {
  admin: '/',
  client: '/',
  staff: '/',
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
 * Plain inline styling on purpose: this has to render before, and
 * independently of, anything the app itself loads.
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
  :root{color-scheme:light dark}
  body{margin:0;min-height:100vh;display:grid;place-items:center;
       font:16px/1.6 system-ui,sans-serif;padding:24px}
  main{max-width:34rem}
  h1{font-size:1.4rem;margin:0 0 .5rem}
  p{margin:0 0 1rem;opacity:.8}
  form{margin:0 0 1rem}
  button{font:inherit;cursor:pointer;background:none;
    padding:.6rem 1.1rem;border:1px solid currentColor;
    border-radius:999px;color:inherit}
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
