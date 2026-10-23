/**
 * Where the Back Office's "Retry AI scan" calls the Staff App (lib/rescan.ts
 * has the gate). Its own file: the middleware runs on the Edge runtime and
 * must not pull in node:crypto.
 */
export const RESCAN_PATH = '/api/internal/rescan-document';
