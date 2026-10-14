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
 * The page a signed-in user sees when they open an app their role has no
 * business in — an admin landing on the Staff App, say.
 *
 * It is deliberately NOT a redirect. The apps are on separate hosts, so
 * middleware cannot send anyone to their own app; redirecting to a local
 * path just fails the same role check again, which is exactly the
 * ERR_TOO_MANY_REDIRECTS the old one caused. The middleware REWRITES the
 * request to this path instead — the address bar keeps what was asked for,
 * nothing navigates, so nothing can loop — and each app renders it as its
 * own sign-in card (`WrongApp` in @thc/ui), with the logo, the font, the
 * appearance switch and the reader's own light or dark. It used to be a
 * self-contained inline page that could load none of those (release audit
 * 14.10.2026, ADR-0138).
 */
export const WRONG_APP_PATH = '/wrong-app';

/**
 * The refused session's role, handed to `WRONG_APP_PATH` by the middleware
 * on the rewritten request ("none" for a session with no role). It only
 * chooses a sentence: a visitor who sends it themselves learns nothing and
 * is admitted to nothing.
 */
export const WRONG_APP_ROLE_HEADER = 'x-thc-wrong-app-role';

const ROLE_ACCOUNT: Readonly<Record<Role, string>> = {
  admin: 'Back Office',
  client: 'Client Portal',
  staff: 'Staff',
};

/** The heading and the sentence of the wrong-app page. */
export function wrongAppCopy(role: Role | null, appName: string): { title: string; body: string } {
  return {
    title: `This account is not for the ${appName}`,
    body: `${
      role
        ? `You are signed in to a ${ROLE_ACCOUNT[role]} account.`
        : 'Your account has no role set, so it cannot be admitted to any app.'
    } Sign out and use the account for this app.`,
  };
}

/** The role the middleware put on the rewritten request, or null. */
export function wrongAppRole(header: string | null): Role | null {
  return isRole(header) ? header : null;
}
