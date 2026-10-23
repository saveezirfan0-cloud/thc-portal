import { cookies } from 'next/headers';
import { createClient } from '@thc/db/server';

/**
 * A passport is never verified without an expiry in place (THC, 23.10.2026,
 * ADR-0201). The form asks for it; this is the same rule where it cannot be
 * skipped, in the server actions both Verify buttons call. Read through the
 * reviewer's own session (compliance_docs is theirs to read), so only a
 * document they can see is judged; a failed read does not block (the database
 * still decides everything it decides).
 */
interface DocRead {
  from(table: 'compliance_docs'): {
    select(columns: 'doc_type, expiry_date'): {
      eq(
        column: 'id',
        value: string,
      ): {
        maybeSingle(): PromiseLike<{
          data: { doc_type: string; expiry_date: string | null } | null;
          error: unknown;
        }>;
      };
    };
  };
}

/** True when `docId` is a passport and neither the form nor the row has an expiry. */
export async function passportExpiryMissing(
  docId: string,
  expiry: string | null | undefined,
): Promise<boolean> {
  if (expiry) return false;
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return false;
  }
  const supabase = createClient(await cookies()) as unknown as DocRead;
  const { data } = await supabase
    .from('compliance_docs')
    .select('doc_type, expiry_date')
    .eq('id', docId)
    .maybeSingle();
  return data?.doc_type === 'passport' && !data.expiry_date;
}
