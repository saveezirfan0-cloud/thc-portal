import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { HOME_PATH, WRONG_APP_ROLE_HEADER, wrongAppCopy, wrongAppRole } from '@thc/db';
import { WrongApp } from '@thc/ui';

export const metadata = { title: 'Wrong app for this account · THC Staff' };
export const dynamic = 'force-dynamic';

/**
 * An account that is not a worker's, signed in here (§1.4). The middleware
 * rewrites its every request to this page with the refused role on a header
 * (ADR-0138); a worker who opens the address by hand goes to their shifts.
 */
export default async function WrongAppPage() {
  const asked = (await headers()).get(WRONG_APP_ROLE_HEADER);
  if (asked === null || asked === 'staff') redirect(HOME_PATH.staff);
  const { title, body } = wrongAppCopy(wrongAppRole(asked), 'Staff App');
  return (
    <main id="main">
      <WrongApp product="Staff App" title={title} body={body} />
    </main>
  );
}
