import type { AgentPhase } from '../types';

/**
 * Decide whether a workstation desk lamp is lit.
 *
 * Moody night lighting is applied per desk, not per room: the lamp only glows
 * while the agent that owns that desk is physically in the chair (`seated`)
 * and its phase is `ready` or `working`. A reserved seat is not enough — an
 * agent still walking over, or one that left for a meeting, the lounge or the
 * pantry, would otherwise leave an empty desk glowing. Every other phase
 * (`blocked`, `idle`, `starting`, `restarting`, `stopped`) keeps the lamp dark;
 * a `blocked` agent waits for a human in the dark while its monitor shows the
 * grey waiting screen.
 */
export function deskLampLitFor(phase: AgentPhase | undefined, seated: boolean): boolean {
  if (!seated) return false;
  return phase === 'ready' || phase === 'working';
}
