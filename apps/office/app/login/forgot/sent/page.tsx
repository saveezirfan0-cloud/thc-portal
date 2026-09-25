import { AuthCard } from '@thc/ui';
import { SentBody } from './SentBody';

export const metadata = { title: 'Reset link sent · THC Back Office' };

/** A2 Reset link sent — §10.2, wireframes/backoffice/login.html:77-79. */
export default async function Page({ searchParams }: { searchParams: Promise<{ to?: string }> }) {
  const { to } = await searchParams;
  return (
    <AuthCard product="Back Office" heading="Reset link sent">
      <SentBody to={to} />
    </AuthCard>
  );
}
