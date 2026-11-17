/**
 * Where the roster comes from, and when it is allowed to fall back to mock.
 *
 * The rule is simple: the office never opens on fabricated agents. It starts
 * empty with `pending`, fills from the first successful fetch, and only shows
 * the mock roster when a fetch actually fails *and* there is no live snapshot to
 * keep. A transient polling error therefore never blanks or fakes a working
 * board.
 *
 * Import-free on purpose (only a type import), so `scripts/verify-store.mjs`
 * drives every transition with plain `node`. The mock roster is passed in by the
 * caller instead of being imported here.
 */

import type { Employee } from '../types';

/** `pending` = first fetch in flight, nothing to show yet. */
export type SourceKind = 'openbot' | 'mock' | 'pending';

export interface SourceState {
  /** Where the employees came from. */
  source: SourceKind;
  /** Human-readable reason, e.g. "database not found". */
  reason: string | null;
  /** True while the live DB is being polled. */
  polling: boolean;
}

export type FetchOutcome =
  | { kind: 'ok'; employees: Employee[] }
  | { kind: 'empty'; reason: string }
  | { kind: 'error'; reason: string };

export interface SourceTransition {
  employees: Employee[];
  source: SourceState;
}

/**
 * Apply one fetch outcome to the current state.
 *
 * - `ok`        -> live roster, `openbot`.
 * - `empty`     -> empty live roster, `openbot`. Never mock: the API answered.
 * - `error`     -> keep the last live snapshot if there is one, otherwise fall
 *                  back to `fallback` (the mock roster).
 *
 * `polling` is carried over untouched: it is a UI toggle, not fetch state.
 */
export function resolveSource(
  current: SourceState,
  employees: Employee[],
  outcome: FetchOutcome,
  fallback: Employee[],
): SourceTransition {
  const polling = current.polling;

  if (outcome.kind === 'ok') {
    return { employees: outcome.employees, source: { source: 'openbot', reason: null, polling } };
  }

  if (outcome.kind === 'empty') {
    return { employees: [], source: { source: 'openbot', reason: outcome.reason, polling } };
  }

  // A live snapshot is a fact; a failed refresh must not replace it with fake
  // rows, and it must not relabel live rows as mock either. Only a board that
  // never loaded live falls back to the mock roster.
  const hasLiveSnapshot = current.source === 'openbot' && employees.length > 0;
  return {
    employees: hasLiveSnapshot ? employees : fallback,
    source: {
      source: hasLiveSnapshot ? 'openbot' : 'mock',
      reason: outcome.reason,
      polling,
    },
  };
}
