import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { HOME_PATH, WRONG_APP_ROLE_HEADER, wrongAppCopy, wrongAppRole } from '@thc/db';
import { WrongApp } from '@thc/ui';

export const metadata = { title: 'Wrong app for this account · THC Back Office' };
export const dynamic = 'force-dynamic';

/**
 * An account that is not the office's, signed in here (§1.4). The middleware
 * rewrites its every request to this page with the refused role on a header
 * (ADR-0138); an admin who opens the address by hand goes to the dashboard.
 */
export default async function WrongAppPage() {
  const asked = (await headers()).get(WRONG_APP_ROLE_HEADER);
  if (asked === null || asked === 'admin') redirect(HOME_PATH.admin);
  const { title, body } = wrongAppCopy(wrongAppRole(asked), 'Back Office');
  return (
    <main id="main">
      <WrongApp product="Back Office" title={title} body={body} />
    </main>
  );
}
