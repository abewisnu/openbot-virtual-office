// Lounge confinement rule, kept pure (no imports) so a gate script can run it
// directly with `node`, the same way Monitor.ts is verified.
//
// `starting` agents are not in the office yet: they wait inside the Lounge room
// (top-left), standing, sitting on the sofas or walking between floor tiles, and
// are never given a goal outside it. The room is sealed by partitions on column
// 14 and row 16 and by the north wall, so its only exit is the doorway at
// (14, 13); goals inside the room never route through it.

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
  return phase === 'starting';
}
