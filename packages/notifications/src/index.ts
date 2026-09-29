// The register and what the apps read from it. The sending side — the drain,
// the HTML renderer and the inline logo's bytes (ADR-0073) — is NOT
// re-exported here, so an app importing `@thc/notifications` for TEMPLATES or
// DEFAULT_SENDER_ADDRESSES does not bundle it. Import it by subpath
// (`@thc/notifications/drain`, `@thc/notifications/email-html`) or, from the
// Edge Function, by relative path.
export * from './templates.ts';
export * from './outbox.ts';
export * from './documents.ts';
export * from './senders.ts';
export * from './webpush.ts';
export * from './resend.ts';
export * from './inbox.ts';
