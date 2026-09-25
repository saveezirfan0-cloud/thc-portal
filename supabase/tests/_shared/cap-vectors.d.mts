/**
 * Types for the cap-vectors generator, so the Vitest drift test in
 * packages/domain can import it under `strict`. The generator itself stays
 * plain ESM: it has to run from `node` with no build step, because pgTAP is
 * run by `supabase test db` and never sees the TypeScript toolchain.
 */
export interface CapVectorCase {
  name: string;
  input: {
    visaLimited: boolean;
    termState: string;
    completionLetterVerified: boolean;
    optOut48h: boolean;
    weekStart?: string;
    belowDegreeLevel?: boolean;
    completionDate?: string;
    visaExpiry?: string;
    optOutCancelledFrom?: string;
    under18?: boolean;
    verifiedOn?: string;
    visaHourLimit?: number | null;
  };
  expect: { capHours: number | null; band: string };
}

export interface CapVectors {
  cases: CapVectorCase[];
}

/** Absolute path of packages/domain/src/cap.vectors.json. */
export declare const VECTORS_JSON: string;
/** Absolute path of the generated supabase/tests/_shared/cap_vectors.psql. */
export declare const VECTORS_PSQL: string;

/** The .psql file body for a parsed cap.vectors.json. Pure — no I/O. */
export declare function renderCapVectors(vectors: CapVectors): string;

export declare function readVectors(): CapVectors;
