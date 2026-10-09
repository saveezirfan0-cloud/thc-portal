import { cache } from 'react';
import { loadMonitor } from './data';

/**
 * The board, read once per request for the parsed log query it is given. The
 * topbar's counts and the monitor below it both need it and now render apart
 * (the topbar at once, the monitor streamed in), so `cache` lets the second
 * share the first's read. Callers pass the SAME query object: `cache` compares
 * arguments by identity.
 */
export const monitorView = cache(loadMonitor);
