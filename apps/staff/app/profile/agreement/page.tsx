import { redirect } from 'next/navigation';
import { Alert, EmptyState } from '@thc/ui';
import { ProfileShell } from '../_components/ProfileShell';
import { appLock, canReachAgreement } from '../lock';
import { loadMyContract, loadProfile, supabaseConfigured } from '../data';
import { signOwnPhoto } from '../photos';
import { LoadProblem } from '../../_components/LoadProblem';
import { ContractText, placeholderNote } from '../../onboarding/_components/ContractText';
import '../profile.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Signed agreement · THC Staff' };

/**
 * /profile/agreement — the agreement the worker signed (ADR-0083, §2.11).
 *
 * 10/11 has always said "A copy of the signed agreement is kept on your
 * profile"; this is that copy. It is the version the worker SIGNED
 * (`my_contract()`), not whatever is current — a published version is
 * immutable, so this is the text they agreed to, character for character.
 *
 * It is where a worker finds their holiday terms. The rest of the app shows
 * the base rate only and never the +12.07% (§9.8); THC's agreement states
 * the accrual in its own words (clause 9), and this screen shows those words
 * as signed — it does not summarise, calculate or restate them.
 *
 * The signature stamp is an audit record: UK time, formatted by the
 * database, never converted to the viewer's zone (§1.8). Read-only — there
 * is nothing to change here.
 */
export default async function Page() {
  if (!supabaseConfigured()) {
    return (
      <ProfileShell
        title="Signed agreement"
        back={{ href: '/profile', label: 'Profile' }}
        lock="none"
        name="THC"
      >
        <Alert tone="coral">
          This environment has no Supabase project, so your agreement cannot be read. See
          docs/04-setup-github-vercel-supabase.md.
        </Alert>
      </ProfileShell>
    );
  }

  const profile = await loadProfile();
  if (!profile) redirect('/profile');

  const lock = appLock(profile);
  if (!canReachAgreement(lock)) redirect('/profile');

  const name = `${profile.firstName} ${profile.lastName}`.trim();
  const { row: contract, problem } = await loadMyContract();

  return (
    <ProfileShell
      title="Signed agreement"
      back={{ href: '/profile', label: 'Profile' }}
      lock={lock}
      name={name}
      photoUrl={await signOwnPhoto(profile.photoPath)}
    >
      {problem ? (
        <LoadProblem what="your agreement" />
      ) : !contract ? (
        <EmptyState>
          <h3>No signed agreement</h3>
          Your agreement appears here once you have signed it in the app.
        </EmptyState>
      ) : (
        <>
          <div className="sig">
            Signed electronically · {contract.signedStamp} — this timestamp is your signature
          </div>
          {contract.isPlaceholder ? (
            <div className="note xs">{placeholderNote(contract.version)}</div>
          ) : null}
          <div className="xs muted">
            This is the exact text you agreed to. If we publish a new version, this copy does not
            change.
          </div>
          <ContractText title={contract.title} body={contract.body} size="full" />
        </>
      )}
    </ProfileShell>
  );
}
