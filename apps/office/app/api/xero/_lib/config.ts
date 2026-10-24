/**
 * Xero's endpoints and this app's credentials (ADR-0211).
 *
 * Everything here is read from the environment at call time and is optional:
 * with any of XERO_CLIENT_ID / XERO_CLIENT_SECRET / XERO_REDIRECT_URI missing
 * the integration is off and every caller no-ops. Nothing is logged.
 */

export const XERO_AUTHORIZE_URL = 'https://login.xero.com/identity/connect/authorize';
export const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token';
export const XERO_REVOKE_URL = 'https://identity.xero.com/connect/revocation';
export const XERO_CONNECTIONS_URL = 'https://api.xero.com/connections';
export const XERO_API_URL = 'https://api.xero.com/api.xro/2.0';

/**
 * The granular scopes (Xero's 2026 change: apps created from 2 March 2026
 * get granular scopes only; the broad accounting.transactions is retired for
 * everyone in September 2027). Invoices + their attachments + contacts, and
 * offline_access for the refresh token. XERO_SCOPES overrides this for an app
 * created before the change that still holds the broad scopes.
 */
export const DEFAULT_XERO_SCOPES = 'offline_access accounting.invoices accounting.contacts accounting.attachments';

export interface XeroEnv {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string;
}

export function xeroEnv(env: Record<string, string | undefined> = process.env): XeroEnv | null {
  const clientId = env['XERO_CLIENT_ID']?.trim();
  const clientSecret = env['XERO_CLIENT_SECRET']?.trim();
  const redirectUri = env['XERO_REDIRECT_URI']?.trim();
  if (!clientId || !clientSecret || !redirectUri) return null;
  const scopes = env['XERO_SCOPES']?.trim().split(/\s+/).join(' ') || DEFAULT_XERO_SCOPES;
  return { clientId, clientSecret, redirectUri, scopes };
}

export function authorizeUrl(env: XeroEnv, state: string): string {
  const url = new URL(XERO_AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', env.clientId);
  url.searchParams.set('redirect_uri', env.redirectUri);
  url.searchParams.set('scope', env.scopes);
  url.searchParams.set('state', state);
  return url.toString();
}
