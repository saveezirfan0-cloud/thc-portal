import './auth-main.css';

/**
 * The `<main>` landmark for the portal's signed-out pages — sign-in, forgot,
 * reset, set-up — and its root error and 404, so a screen reader's "jump to
 * main" lands on the card. The signed-in pages have theirs in
 * client/layout.tsx, after the top bar.
 *
 * It also carries the cards' phone tap targets (auth-main.css).
 */
export function AuthMain({ children }: { children: React.ReactNode }) {
  return <main id="main">{children}</main>;
}
