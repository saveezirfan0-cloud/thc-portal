import { currentOfficeRole } from '../../_components/officeUser';
import { officeCan } from '../../_lib/permissions';
import { loadNamesToReview } from './data';
import { NamesScreen } from './NamesScreen';

export const metadata = { title: 'Names to review · Staff · THC Back Office' };

// Read per request with the manager's session — never prerendered.
export const dynamic = 'force-dynamic';

/**
 * /staff/names — workers and candidates whose name is not yet the name the
 * passport prints (ADR-0194): an initial, symbols, or all lower or upper
 * case. A static segment, so Next.js serves it ahead of `/staff/[id]`.
 */
export default async function Page() {
  const [data, role] = await Promise.all([loadNamesToReview(), currentOfficeRole()]);
  return (
    <NamesScreen rows={data.rows} problem={data.problem} canCorrect={officeCan(role, 'identity')} />
  );
}
