/**
 * Types for the ready-deadline-vectors generator, so the Vitest drift test in
 * packages/domain can import it under `strict`. The generator stays plain
 * ESM for the reason cap-vectors.d.mts gives.
 */
export interface ReadyDeadlineVectorCase {
  name: string;
  note: string;
  startsAt: string;
  deadline: string;
}

export interface ReadyDeadlineVectors {
  description?: string;
  cases: ReadyDeadlineVectorCase[];
}

export declare const READY_VECTORS_JSON: string;
export declare const READY_VECTORS_PSQL: string;
export declare function renderReadyDeadlineVectors(vectors: ReadyDeadlineVectors): string;
export declare function readReadyVectors(): ReadyDeadlineVectors;
