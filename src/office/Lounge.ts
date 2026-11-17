// Lounge confinement rule, kept pure (no imports) so a gate script can run it
// directly with `node`, the same way Monitor.ts is verified.
//
// Two phases keep an agent inside the Lounge room (top-left), standing, sitting
// on the sofas or walking between floor tiles, and never give it a goal outside
// it:
//   - `starting`: not in the office yet, warming up.
//   - `restarting`: provider error / manual restart, so the agent is out of
//     service until it becomes `ready` (or falls to `blocked`/`stopped`).
// The room is sealed by partitions on column 14 and row 16 and by the north
// wall, so its only exit is the doorway at (14, 13); goals inside the room never
// route through it.

import type { AgentPhase } from '../types';

/** Interior floor of the Lounge room. Mirrors MIN_WALK_ROW (6) in `constants.ts`. */
export const LOUNGE_ROOM = {
  minTx: 1,
  maxTx: 13,
  minTy: 6,
  maxTy: 15,
} as const;

/** True when a tile is inside the Lounge room (walls and doorway excluded). */
export function isInLounge(tx: number, ty: number): boolean {
  return (
    tx >= LOUNGE_ROOM.minTx &&
    tx <= LOUNGE_ROOM.maxTx &&
    ty >= LOUNGE_ROOM.minTy &&
    ty <= LOUNGE_ROOM.maxTy
  );
}

/** True when the agent must stay in the Lounge until its phase moves on. */
export function staysInLounge(phase: AgentPhase | undefined): boolean {
  return phase === 'starting' || phase === 'restarting';
}
