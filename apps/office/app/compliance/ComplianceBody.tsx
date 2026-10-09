import { ComplianceScreen } from './ComplianceScreen';
import { complianceView } from './view';

/** The queue, radar and gov.uk monitor, streamed in behind the topbar by `page.tsx`. */
export async function ComplianceBody({ tab }: { tab: 'review' | 'radar' | 'checks' }) {
  const data = await complianceView();
  return <ComplianceScreen data={data} initialTab={tab} />;
}
