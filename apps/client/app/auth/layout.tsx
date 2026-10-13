import { AuthMain } from '../_components/AuthMain';

/** A `<main>` landmark around the signed-out card (every page, one landmark). */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <AuthMain>{children}</AuthMain>;
}
