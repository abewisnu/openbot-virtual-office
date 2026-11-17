// Re-export the real-source agent model so the rest of the app has one place
// for phases, activities, and agent types (single source of truth).
export type { AgentPhase, AgentActivity, ActivityKind } from './data/openbotSource';
export { AGENT_PHASES, ACTIVITY_KINDS } from './data/openbotSource';

// The simulation status drives *where* an employee physically is in the
// office (zone/seat). It is kept separate from the real agent phase so the
// office simulation continues to move characters even when the live DB is
// absent.
export type Status = 'idle' | 'working' | 'meeting' | 'chatting' | 'break';

export interface Employee {
  id: string;
  name: string;
  role: string;
  /** Hex color when the source provides one, otherwise null. */
  avatarColor: string | null;
  /** 0-360 hue used to derive a shirt color when avatarColor is null. */
  avatarHue: number;
  /** Live agent runtime phase from the real source, when available. */
  phase: import('./data/openbotSource').AgentPhase;
  /** Single highest-priority activity, or null when there is none. */
  activity: import('./data/openbotSource').AgentActivity | null;
  status: Status;
  position: { x: number; y: number };
  currentWorkstation?: string;
  unreadCount?: number;
}
