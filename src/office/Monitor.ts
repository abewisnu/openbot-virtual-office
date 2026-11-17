import type { AgentPhase } from '../types';

/** What a desk screen shows: dark, still image, scrolling animation, or grey wait. */
export type MonitorState = 'off' | 'still' | 'moving' | 'waiting';

/**
 * Decide a desk screen from the agent phase and whether the body is already in
 * the chair.
 *
 * `seated` gates everything: a seat is reserved the moment an agent starts
 * walking to it, so looking at the seat occupant alone lights the screen while
 * the agent is still crossing the floor. Only a seated `working` agent gets the
 * moving screen, a seated `ready` agent gets the still one, and a seated
 * `blocked` agent gets the grey waiting screen — it is parked in front of the
 * computer while the human has to answer a prompt, approve a request or wait
 * for a usage reset. Every other case (walking, idle, restarting, stopped)
 * stays dark.
 */
export function monitorStateFor(phase: AgentPhase | undefined, seated: boolean): MonitorState {
  if (!seated) return 'off';
  if (phase === 'working') return 'moving';
  if (phase === 'ready') return 'still';
  if (phase === 'blocked') return 'waiting';
  return 'off';
}
