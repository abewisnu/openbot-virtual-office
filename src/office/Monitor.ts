import type { AgentPhase } from '../types';

/** What a desk screen shows: dark, still image, or the scrolling animation. */
export type MonitorState = 'off' | 'still' | 'moving';

/**
 * Decide a desk screen from the agent phase and whether the body is already in
 * the chair.
 *
 * `seated` gates everything: a seat is reserved the moment an agent starts
 * walking to it, so looking at the seat occupant alone lights the screen while
 * the agent is still crossing the floor. Only a seated `working` agent gets the
 * moving screen, a seated `ready` agent gets the still one, and every other
 * case (walking, idle, blocked, restarting, stopped) stays dark.
 */
export function monitorStateFor(phase: AgentPhase | undefined, seated: boolean): MonitorState {
  if (!seated) return 'off';
  if (phase === 'working') return 'moving';
  if (phase === 'ready') return 'still';
  return 'off';
}
