/**
 * Types for the rota-guard-vectors generator, so the Vitest drift test in
 * packages/domain can import it under `strict`. The generator stays plain
 * ESM for the reason cap-vectors.d.mts gives.
 */
export interface RotaGuardVectorCase {
  name: string;
  input: {
    canRoster: boolean;
    capHours: number | null;
    band: string;
    bookedHours: number;
    shiftHours: number;
    mode: string;
  };
  expect: { verdict: string; reason: string | null };
}

export interface RotaGuardVectors {
  cases: RotaGuardVectorCase[];
}

export declare const ROTA_VECTORS_JSON: string;
export declare const ROTA_VECTORS_PSQL: string;
export declare function renderRotaGuardVectors(vectors: RotaGuardVectors): string;
export declare function readRotaVectors(): RotaGuardVectors;
