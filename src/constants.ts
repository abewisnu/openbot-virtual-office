import type { Status, AgentPhase, AgentActivity, ActivityKind } from './types';
export type Dir = 'up' | 'down' | 'left' | 'right';
/** One "pixel art" = ART screen pixels. All assets are drawn at the same density. */
export const ART = 2;
export const TILE = 32; // px per screen tile (16 pixel art)
export const COLS = 60;
export const ROWS = 40;
export const WORLD_W = COLS * TILE; // 1920
export const WORLD_H = ROWS * TILE; // 1280
export const WALL_ROWS = 5;
export const MIN_WALK_ROW = 6;
export const CHAR_SPEED = 72; // px/detik
export const FOOT_OFFSET = 8; // character feet offset relative to tile center
export const ZOOM_STEPS = [0.70, 0.75, 1, 1.25, 1.5, 2, 3];
export const STATUS_COLORS: Record<Status, string> = {
  working: '#4ade80', meeting: '#60a5fa', chatting: '#f59e0b', break: '#c084fc', idle: '#9ca3af',
};
export const STATUS_LABEL: Record<Status, string> = {
  working: 'Working', meeting: 'Meeting', chatting: 'Chatting', break: 'Break', idle: 'Idle',
};

// ---------------------------------------------------------------------------
// Real agent phase: badge color + Indonesian label, and the activity badge
// color + Indonesian label. The simulation STATUS stays the *zone* driver;
// the phase/activity pair is the *indicator* layer on top of it.
// ---------------------------------------------------------------------------

export const PHASE_COLORS: Record<AgentPhase, string> = {
  idle: '#9ca3af',
  starting: '#38bdf8',
  ready: '#4ade80',
  working: '#60a5fa',
  restarting: '#f59e0b',
  blocked: '#f87171',
  stopped: '#6b7280',
};

export const PHASE_LABEL: Record<AgentPhase, string> = {
  idle: 'Standby',
  starting: 'Starting',
  ready: 'Ready',
  working: 'Working',
  restarting: 'Restarting',
  blocked: 'Blocked',
  stopped: 'Stopped',
};

export const ACTIVITY_LABEL: Record<ActivityKind, string> = {
  waiting: 'Waiting',
  limited: 'Limited',
  routine: 'Routine',
  working: 'Working on turn',
  unread: 'Unread',
  responded: 'Replied just now',
};

/** Deterministic shirt color for an employee: hex color, else hue fallback. */
export function shirtColorFor(emp: { avatarColor: string | null; avatarHue: number }): string {
  if (emp.avatarColor) return emp.avatarColor;
  const h = Math.round((((emp.avatarHue % 360) + 360) % 360));
  return `hsl(${h}, 45%, 55%)`;
}

/**
 * The single badge to draw for an employee: the phase colour + phase label.
 * The activity never recolours the dot, because the dot is the *status*
 * indicator next to the agent name; activity is shown as a separate note.
 */
export function badgeFor(emp: { phase: AgentPhase; activity: AgentActivity | null }): {
  color: string;
  label: string;
  note?: string;
} {
  const badge: { color: string; label: string; note?: string } = {
    color: PHASE_COLORS[emp.phase],
    label: PHASE_LABEL[emp.phase],
  };
  if (emp.activity) badge.note = ACTIVITY_LABEL[emp.activity.kind];
  return badge;
}
