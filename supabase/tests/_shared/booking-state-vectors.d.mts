/**
 * Types for the booking-state-vectors generator, so the Vitest drift test in
 * packages/domain can import it under `strict`. The generator stays plain
 * ESM for the reason cap-vectors.d.mts gives.
 */
export interface BookingStateVectors {
  description: string;
  statuses: string[];
  edges: { from: string; to: string; ref: string }[];
  cancelCauses: { cause: string; status: string; ref: string }[];
  legacyCauses: Record<string, string>;
}

export declare const BOOKING_VECTORS_JSON: string;
export declare const BOOKING_VECTORS_PSQL: string;
export declare function renderBookingStateVectors(vectors: BookingStateVectors): string;
export declare function readBookingVectors(): BookingStateVectors;
