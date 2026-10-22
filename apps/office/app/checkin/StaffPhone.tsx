import { formatPhone } from '../staff/[id]/additions';

/**
 * The worker's mobile under their name on a monitor row, a `tel:` link so a
 * laptop or desk phone set up for calls rings it. "—" for a removed worker
 * (§1.7) or none on record; nothing when the numbers could not be read.
 */
export function StaffPhone({ phone }: { phone: string | null | undefined }) {
  if (phone === undefined) return null;
  return (
    <div className="s mono checkin-phone">
      {phone ? (
        <a href={`tel:${phone.replace(/[^\d+]/g, '')}`}>{formatPhone(phone)}</a>
      ) : (
        <span title="No phone number on record">—</span>
      )}
    </div>
  );
}
