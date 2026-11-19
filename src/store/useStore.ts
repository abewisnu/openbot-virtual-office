import type { AgentProfile } from '../data/openbotSource';
import { create } from 'zustand';
import type { Employee, Status } from '../types';
import { STATUS_LABEL } from '../constants';
import { fetchAgentProfilesAsync, closeOpenBotDbAsync, shirtColorFor } from '../data/openbotSource';
import type { ThemeMode } from '../theme';
import type { DaylightMode } from '../office/DayCycle';
import { FLOOR_STYLES, PLANT_STYLES, type FloorStyle, type PlantStyle } from '../office/AssetGenerator';
import { resolveSource, type SourceState } from './sourcePolicy';
import { mockEmployees } from '../data/mockEmployees';

const FLOOR_KEY = 'ovo-floor';
const PLANT_KEY = 'ovo-plant';
const MOODY_LIGHTING_KEY = 'ovo-moody-lighting';
function readStoredFloor(): FloorStyle {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(FLOOR_KEY);
    return raw && FLOOR_STYLES.includes(raw as FloorStyle) ? (raw as FloorStyle) : 'oak';
  } catch {
    return 'oak';
  }
}
function readStoredPlant(): PlantStyle {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(PLANT_KEY);
    return raw && PLANT_STYLES.includes(raw as PlantStyle) ? (raw as PlantStyle) : 'classic';
  } catch {
    return 'classic';
  }
}
function readStoredMoodyLighting(): boolean {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(MOODY_LIGHTING_KEY);
    return raw !== 'false' && raw !== '0';
  } catch {
    return true;
  }
}

export type { SourceState };

export interface Notice { id: number; text: string; ts: number }
/** Sidebar font themes. Kept in memory only, like every other UI toggle. */
export type SidebarFont = 'mono' | 'pixel';
export interface Live { zone: string; task: string; x: number; y: number }
export interface HoveredAgent {
  id: string;
  name: string;
  role: string;
  phaseLabel: string;
  phaseColor: string;
  zone: string;
  screenX: number;
  screenY: number;
}

export interface RoomHighlightRect {
  x: number;
  y: number;
  w: number;
  h: number;
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
  /** Atmosphere lighting mode: `auto` follows local clock or pins dawn/day/dusk/night. */
  daylightMode: DaylightMode;
  /** Low-key dark ambient & pool-of-light night lighting toggle (active by default). */
  moodyLighting: boolean;
  /** Office floor texture variant chosen in Settings. */
  floorStyle: FloorStyle;
  /** Office plant variant chosen in Settings. */
  plantStyle: PlantStyle;
  /** Keep camera centered on the selected agent until user pans manually. */
  followSelected: boolean;
  /** One-shot camera glide target (room quick-jump or agent center). */
  cameraTarget: { x: number; y: number; zoom?: number; highlight?: RoomHighlightRect; seq: number } | null;
  /** Current camera zoom percentage for toolbar readout. */
  zoomPercent: number;
  /** One-shot zoom button command from HUD toolbar. */
  zoomAction: { kind: 'in' | 'out' | 'reset'; seq: number } | null;
  /** Hovered agent/workstation tooltip payload for canvas feedback. */
  hoveredAgent: HoveredAgent | null;
  helpOpen: boolean;
  settingsOpen: boolean;
  exited: boolean;
  source: SourceState;
  select: (id: string | null) => void;
  focusAgent: (id: string) => void;
  setFollowSelected: (v: boolean) => void;
  focusPoint: (x: number, y: number, zoom?: number, highlight?: RoomHighlightRect) => void;
  setZoomPercent: (pct: number) => void;
  triggerZoom: (kind: 'in' | 'out' | 'reset') => void;
  setHoveredAgent: (h: HoveredAgent | null) => void;
  setStatus: (id: string, status: Status) => void;
  setLive: (l: Live) => void;
  toggleLabels: () => void;
  setSidebarFont: (f: SidebarFont) => void;
  setThemeMode: (m: ThemeMode) => void;
  setDaylightMode: (m: DaylightMode) => void;
  setMoodyLighting: (v: boolean) => void;
  setFloorStyle: (f: FloorStyle) => void;
  setPlantStyle: (p: PlantStyle) => void;
  setHelp: (v: boolean) => void;
  setSettings: (v: boolean) => void;
  setExited: (v: boolean) => void;
  /** Load the real agents (option b). Falls back to mock on error. */
  loadOpenBot: () => Promise<void>;
}

let nid = 0;
let camSeq = 0;
let zoomSeq = 0;

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
    workspaceBytes: p.workspaceBytes,
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
  // Start EMPTY. The first paint must not show fabricated agents; the roster
  // arrives from `loadOpenBot()`, which runs before the first frame is settled.
  employees: [],
  selectedId: null,
  live: { zone: '-', task: '-', x: 0, y: 0 },
  notices: [],
  showLabels: true,
  sidebarFont: 'mono',
  themeMode: 'system',
  daylightMode: 'auto',
  moodyLighting: readStoredMoodyLighting(),
  floorStyle: readStoredFloor(),
  plantStyle: readStoredPlant(),
  followSelected: false,
  cameraTarget: null,
  zoomPercent: 75,
  zoomAction: null,
  hoveredAgent: null,
  helpOpen: false,
  settingsOpen: false,
  exited: false,
  source: { source: 'pending', reason: null },
  select: (id) => set((s) => ({ selectedId: id, followSelected: id ? s.followSelected : false })),
  focusAgent: (id) => set({ selectedId: id, followSelected: true }),
  setFollowSelected: (followSelected) => set({ followSelected }),
  focusPoint: (x, y, zoom, highlight) => set({ followSelected: false, cameraTarget: { x, y, zoom, highlight, seq: ++camSeq } }),
  setZoomPercent: (zoomPercent) => set((s) => (s.zoomPercent === zoomPercent ? s : { zoomPercent })),
  triggerZoom: (kind) => set({ zoomAction: { kind, seq: ++zoomSeq } }),
  setHoveredAgent: (hoveredAgent) => set({ hoveredAgent }),
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
  setDaylightMode: (daylightMode) => set({ daylightMode }),
  setMoodyLighting: (moodyLighting) => {
    try {
      localStorage.setItem(MOODY_LIGHTING_KEY, String(moodyLighting));
    } catch {
      /* ignore unavailable storage */
    }
    set({ moodyLighting });
  },
  setFloorStyle: (floorStyle) => {
    try {
      localStorage.setItem(FLOOR_KEY, floorStyle);
    } catch {
      /* ignore unavailable storage */
    }
    set({ floorStyle });
  },
  setPlantStyle: (plantStyle) => {
    try {
      localStorage.setItem(PLANT_KEY, plantStyle);
    } catch {
      /* ignore unavailable storage */
    }
    set({ plantStyle });
  },
  setHelp: (helpOpen) => set({ helpOpen }),
  setSettings: (settingsOpen) => set({ settingsOpen }),
  setExited: (exited) => set({ exited }),
  loadOpenBot: async () => {
    const { source, employees } = get();
    try {
      const profiles = await fetchAgentProfilesAsync();
      const outcome =
        profiles.length === 0
          ? { kind: 'empty' as const, reason: 'no agents found' }
          : { kind: 'ok' as const, employees: profiles.map(toEmployee) };
      set(resolveSource(source, employees, outcome, mockEmployees));
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      set(resolveSource(source, employees, { kind: 'error', reason }, mockEmployees));
    }
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
