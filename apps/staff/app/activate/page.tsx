import { AuthCard } from '@thc/ui';
import { LinkSpent } from './LinkSpent';

export const metadata = { title: 'Activate your account · THC Staff' };

/**
 * /activate with no token. Every E3 carries `/activate/:token`; this is
 * a link that lost its token on the way (a mail client that wrapped the
 * line, a hand-typed address) or an E3 queued before personal links
 * existed. Nothing here can activate anybody, so it says where to go.
 */
export default function Page() {
  return (
    <AuthCard product="Account activation" heading="This link is incomplete" appearance="none">
      <LinkSpent message="Use the personal link in your acceptance email — it is the long one ending in a code. If it doesn’t open, write to us and we’ll send you a new one." />
    </AuthCard>
  );
}
