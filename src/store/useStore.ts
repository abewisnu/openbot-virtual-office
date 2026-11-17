import type { AgentProfile } from '../data/openbotSource';
import { create } from 'zustand';
import type { Employee, Status } from '../types';
import { mockEmployees } from '../data/mockEmployees';
import { STATUS_LABEL } from '../constants';
import { fetchAgentProfilesAsync, closeOpenBotDbAsync, shirtColorFor } from '../data/openbotSource';
import type { ThemeMode } from '../theme';

export interface Notice { id: number; text: string; ts: number }
/** Sidebar font themes. Kept in memory only, like every other UI toggle. */
export type SidebarFont = 'mono' | 'pixel';
export interface Live { zone: string; task: string; x: number; y: number }
export interface SourceState {
  /** Where the employees came from. */
  source: 'openbot' | 'mock';
  /** Human-readable reason, e.g. "database not found". */
  reason: string | null;
  /** True while the live DB is being polled. */
  polling: boolean;
}

interface State {
  employees: Employee[];
  selectedId: string | null;
  live: Live;
  notices: Notice[];
  showLabels: boolean;
  /** Font theme for the sidebar: the original monospace, or Geist Pixel. */
  sidebarFont: SidebarFont;
  /** UI palette: follow the OS, or pin light/dark. Applied by `App.tsx`. */
  themeMode: ThemeMode;
  helpOpen: boolean;
  settingsOpen: boolean;
  exited: boolean;
  source: SourceState;
  select: (id: string | null) => void;
  setStatus: (id: string, status: Status) => void;
  setLive: (l: Live) => void;
  toggleLabels: () => void;
  setSidebarFont: (f: SidebarFont) => void;
  setThemeMode: (m: ThemeMode) => void;
  setHelp: (v: boolean) => void;
  setSettings: (v: boolean) => void;
  setExited: (v: boolean) => void;
  /** Load the real agents (option b). Falls back to mock on error. */
  loadOpenBot: () => Promise<void>;
  /** Start/stop the periodic live refresh. */
  setPolling: (on: boolean) => void;
}

let nid = 0;

// Convert an agent profile into an Employee. The simulation status is derived
// from the real runtime phase, so a working agent actually sits at a desk.
function statusForPhase(phase: AgentProfile['phase']): Status {
  return phase === 'working' || phase === 'ready' ? 'working' : 'idle';
}

function toEmployee(p: AgentProfile, index: number): Employee {
  return {
    id: p.agentId,
    name: p.name,
    role: p.role,
    avatarColor: p.avatarColor,
    avatarHue: p.avatarHue,
    avatarSeed: p.avatarSeed,
    phase: p.phase,
    activity: p.activity,
    status: statusForPhase(p.phase),
    position: { x: 0, y: 0 },
    // One desk per agent, ordered by roster: WS-01..WS-N (World owns seat ids).
    currentWorkstation: `WS-${String(index + 1).padStart(2, '0')}`,
    unreadCount: p.unreadCount,
  };
}

export const useStore = create<State>((set, get) => ({
  employees: mockEmployees,
  selectedId: null,
  live: { zone: '-', task: '-', x: 0, y: 0 },
  notices: [],
  showLabels: true,
  sidebarFont: 'mono',
  themeMode: 'system',
  helpOpen: false,
  settingsOpen: false,
  exited: false,
  source: { source: 'mock', reason: null, polling: false },
  select: (id) => set({ selectedId: id }),
  setStatus: (id, status) => {
    const emp = get().employees.find((x) => x.id === id);
    if (!emp || emp.status === status) return;
    const notice = { id: ++nid, ts: Date.now(), text: `${emp.name} → ${STATUS_LABEL[status]}` };
    set((s) => ({
      employees: s.employees.map((x) => (x.id === id ? { ...x, status } : x)),
      notices: [...s.notices, notice].slice(-6),
    }));
  },
  setLive: (live) => set({ live }),
  toggleLabels: () => set((s) => ({ showLabels: !s.showLabels })),
  setSidebarFont: (sidebarFont) => set({ sidebarFont }),
  setThemeMode: (themeMode) => set({ themeMode }),
  setHelp: (helpOpen) => set({ helpOpen }),
  setSettings: (settingsOpen) => set({ settingsOpen }),
  setExited: (exited) => set({ exited }),
  loadOpenBot: async () => {
    try {
      const profiles = await fetchAgentProfilesAsync();
      if (profiles.length === 0) {
        set((s) => ({ source: { ...s.source, source: 'mock', reason: 'no agents found' } }));
        return;
      }
      const next = profiles.map(toEmployee);
      set((s) => ({
        employees: next,
        source: { source: 'openbot', reason: null, polling: s.source.polling },
      }));
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      set((s) => ({ source: { ...s.source, source: 'mock', reason } }));
    }
  },
  setPolling: (on) => {
    set((s) => ({ source: { ...s.source, polling: on } }));
  },
}));

// ---------------------------------------------------------------------------
// Live polling loop. The app calls startPolling once; it reloads the real
// source on an interval while enabled. The DB connection is shared and closed
// on teardown.
// ---------------------------------------------------------------------------

let timer: ReturnType<typeof setInterval> | null = null;

export function startPolling(ms = 3000): void {
  if (timer) return;
  const run = () => {
    void useStore.getState().loadOpenBot();
  };
  run();
  timer = setInterval(run, ms);
}

export function stopPolling(): void {
  if (timer) clearInterval(timer);
  timer = null;
  void closeOpenBotDbAsync();
}

export { shirtColorFor };
