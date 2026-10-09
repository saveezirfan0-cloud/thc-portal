import { cache } from 'react';
import { loadCompliance } from './data';

/**
 * The review queue and radar, read once per request. The topbar's counts and
 * the screen below it both need them, and they now render apart (the topbar
 * at once, the screen streamed in), so `cache` lets the second share the
 * first's read.
 */
export const complianceView = cache(loadCompliance);
