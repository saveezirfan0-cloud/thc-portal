import { ComplianceScreen } from './ComplianceScreen';
import { complianceView } from './view';

/** The queue, radar and gov.uk monitor, streamed in behind the topbar by `page.tsx`. */
export async function ComplianceBody() {
  const data = await complianceView();
  return <ComplianceScreen data={data} />;
}
