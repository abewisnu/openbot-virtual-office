import { Application, Container, Graphics, Sprite, Text, TextureStyle, type Texture } from 'pixi.js';
import { ART, DEFAULT_ZOOM_INDEX, DENSITY, PROP, PROP_SCALE, RACK_BLINK_BASE, RACK_W, FOOT_OFFSET, TILE, WORLD_H, WORLD_W, ZOOM_STEPS, badgeFor, shirtColorFor, type Dir } from '../constants';
import type { Status, AgentPhase, Employee } from '../types';
import { useStore, type RoomHighlightRect } from '../store/useStore';
import { generateAssets, makeBackground, makeCharFrames, makeLook, makeRackLeds, rackBlinkRate, type Assets, type ConcretePlantStyle, type FloorStyle, type FurnitureType, type LampType, type Look, type PlantStyle, type RackLed } from './AssetGenerator';
import { avatarSpec } from './Avatar';
import { buildLayout, zoneName, type ChatSpot, type Layout, type RoomLabel, type Seat } from './Layout';
import { isChattingSeat, isSocialSeat, isSocialZone, pickIdleSeat, pickIdleTile } from './Idle';
import { isInLounge, staysInLounge } from './Lounge';
import { Character, type Vec } from './Character';
import { monitorStateFor } from './Monitor';
import { findPath, type Tile } from './Pathfinder';
import { Atmosphere, type EmissiveLight } from './Atmosphere';
import { Particles, type EmitSpot } from './Particles';
import { daylightAt, daylightForMode, type Daylight, type DaylightMode } from './DayCycle';

const STATUSES: Status[] = ['working', 'working', 'working', 'meeting', 'chatting', 'break', 'idle'];
/**
 * Room shell & small desk/wall fixtures: glass partitions, doors, whiteboard,
 * desk lamps and wall sconces keep `ART` instead of `PROP` so they stay
 * proportional to walls and desk corners.
 */
const SHELL: ReadonlySet<FurnitureType> = new Set<FurnitureType>([
  'partitionH', 'partitionHHalf', 'partitionV', 'partitionCorner', 'doorH', 'doorV', 'whiteboard', 'deskLamp', 'wallSconce',
]);
/** Workstation monitor: a bit denser than the props (1.25x), so the 16 x 14 art
 * screen covers ~2.5 of its 4-tile desk without towering over it. Textures hold
 * `DENSITY` texels per art px, so the draw scale divides it back out. */
const MONITOR_SCALE = (PROP * 1.25) / DENSITY;
/** Sprite footprint in screen px, kept next to the type so the hit test and the
 * layout padding can never drift from the drawn size. */
const MONITOR_W = 16 * DENSITY * MONITOR_SCALE;
const MONITOR_H = 14 * DENSITY * MONITOR_SCALE;
/** How long one animated monitor frame stays on screen (ms). */
const MONITOR_FRAME_MS = 220;
/** Last camera + selection, kept across reloads so the office reopens where it left off. */
const VIEW_KEY = 'ovo-view';
/** Last known poses for idle/break/lounge agents so page reloads preserve their spot. */
const POSES_KEY = 'ovo-agent-poses';
const DIRS: ReadonlySet<Dir> = new Set(['up', 'down', 'left', 'right']);
interface SavedPose { seatId: string | null; x: number; y: number; facing: Dir }

const tileOf = (x: number, y: number): Tile => ({ tx: Math.floor(x / TILE), ty: Math.floor((y - FOOT_OFFSET) / TILE) });
const centerOf = (t: Tile): Vec => ({ x: (t.tx + 0.5) * TILE, y: (t.ty + 0.5) * TILE + FOOT_OFFSET });

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null;

function loadAgentPoses(): Map<string, SavedPose> {
  const out = new Map<string, SavedPose>();
  try {
    const raw = localStorage.getItem(POSES_KEY);
    if (!raw) return out;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return out;
    for (const [id, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (!v || typeof v !== 'object') continue;
      const rec = v as Record<string, unknown>;
      const x = num(rec.x);
      const y = num(rec.y);
      const facing = DIRS.has(rec.facing as Dir) ? (rec.facing as Dir) : 'down';
      const seatId = typeof rec.seatId === 'string' && rec.seatId ? rec.seatId : null;
      if (x !== null && y !== null) out.set(id, { seatId, x, y, facing });
    }
  } catch {
    /* corrupt or unavailable storage */
  }
  return out;
}

function saveAgentPoses(chars: Character[]) {
  if (!chars.length) return;
  try {
    const out: Record<string, SavedPose> = {};
    for (const ch of chars) {
      if (ch.appliedStatus !== 'idle' && ch.appliedStatus !== 'break') continue;
      if (ch.seat && ch.seat.kind === 'desk') continue;
      out[ch.id] = {
        seatId: ch.seat ? ch.seat.id : null,
        x: Math.round(ch.x),
        y: Math.round(ch.y),
        facing: ch.facing,
      };
    }
    localStorage.setItem(POSES_KEY, JSON.stringify(out));
  } catch {
    /* ignore unavailable storage */
  }
}

function restoreView(): { cam: { x: number; y: number; zi: number } | null; selected: string | null } {
  const selected = new URLSearchParams(location.search).get('agent');
  let cam: { x: number; y: number; zi: number } | null = null;
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    if (raw) {
      const v = JSON.parse(raw);
      const zi = num(v?.zi);
      if (zi !== null && zi >= 0 && zi < ZOOM_STEPS.length) {
        const x = num(v?.x);
        const y = num(v?.y);
        cam = {
          x: x ?? WORLD_W / 2,
          y: y ?? WORLD_H / 2 + 60,
          zi,
        };
      }
    }
  } catch {
    /* corrupt or unavailable storage: fall back to the shipped view */
  }
  return { cam, selected };
}

function saveView(cam: { x: number; y: number; zi: number }) {
  try {
    localStorage.setItem(
      VIEW_KEY,
      JSON.stringify({ x: Math.round(cam.x), y: Math.round(cam.y), zi: cam.zi }),
    );
  } catch {
    /* quota or private mode: the office still works, it just forgets the view */
  }
}

export class World {
  private app = new Application();
  private root = new Container();
  private sortLayer = new Container();
  private roomLabelLayer = new Container();
  private labelLayer = new Container();
  private hands = new Graphics();
  private rackLedGraphics = new Graphics();
  /** Soft outline under the workstation the pointer rests on. */
  private hoverMark = new Graphics();
  /** 3-second slow-flashing highlight box around a room clicked in the quick-jump bar. */
  private roomHighlight = new Graphics();
  private roomHighlightState: (RoomHighlightRect & { age: number; duration: number }) | null = null;
  /** Agent currently under the pointer, or null. Drives the hover ring. */
  private hoverId: string | null = null;
  private atmosphere = new Atmosphere();
  private particles = new Particles();
  /** Steam and haze outlets, resolved from the layout once at init. */
  private emitters: EmitSpot[] = [];
  /** Night pass of the background, re-used by the atmosphere wash. */
  private night = false;
  /** Selected office floor pattern from Settings. */
  private floorStyle: FloorStyle = 'oak';
  /** Selected plant variant from Settings. */
  private plantStyle: PlantStyle = 'classic';
  /** Whether Moody / Low-Key dark ambient + warm lamps are enabled in Settings. */
  private moodyLighting = true;
  private plantSprites: Sprite[] = [];
  private lampSprites: { type: LampType; sprite: Sprite }[] = [];
  /** Live daylight curve; recomputed from the clock each frame. */
  private daylight: Daylight = daylightAt(12);
  private background!: Sprite;
  /** Baked background per pass + floor style, so switching never rebuilds twice. */
  private backgroundCache = new Map<string, Texture>();
  /** One-shot saved poses for idle/lounge agents read on startup. */
  private savedPoses = loadAgentPoses();
  private rackLeds: RackLed[] = [];
  /** Desk monitors: dark unless a working/ready agent occupies the desk; animated while working. */
  private monitors: { seat: Seat; sprite: Sprite }[] = [];
  private chars: Character[] = [];
  private phases = new Map<string, AgentPhase>();
  /** True while an agent owes the desk a visit because work is waiting. */
  private instructions = new Map<string, boolean>();
  private layout!: Layout;
  private assets!: Assets;
  private walkable: Tile[] = [];
  /** Floor tiles and lounge-kind seats inside the Lounge room: the starting/restarting pen. */
  private loungeTiles: Tile[] = [];
  private loungeSeats: Seat[] = [];
  /** Floor tiles in the social rooms (Meeting, Lounge, Pantry): the idle stage. */
  private socialTiles: Tile[] = [];
  private cam = { x: WORLD_W / 2, y: WORLD_H / 2 + 60, zi: DEFAULT_ZOOM_INDEX };
  private keys = new Set<string>();
  private drag = { active: false, moved: 0, lx: 0, ly: 0 };
  private clockT = 0; private liveT = 0; private rackT = 0; private monitorT = 0;
  /** Current rack-LED clock speed, eased toward the rate the workload asks for. */
  private rackRate = RACK_BLINK_BASE;
  private cleanups: (() => void)[] = [];
  private ready = false;
  private host!: HTMLElement;
  /** `prefers-reduced-motion`: freeze decorative motion, keep real movement. */
  private calm = false;
  /** Slow-frame average, in seconds, driving the particle budget. */
  private frameAvg = 0;
  private budgetT = 0;
  /** Particle budget scale; 1 is the shipped density, 1/3 is the emergency floor. */
  private particleQuality = 1;
  /** Smooth camera glide goal (room jump or selected-agent follow). */
  private camGoal: { x: number; y: number } | null = null;
  private lastCamSeq = 0;
  private lastZoomSeq = 0;
  private lastDaylightMode: DaylightMode = 'auto';
  /** Precomputed hardware & appliance glow anchors (NOC racks, CRAC, UPS, pantry). */
  private staticLights: EmissiveLight[] = [];

  async init(host: HTMLElement) {
    this.host = host;
    TextureStyle.defaultOptions.scaleMode = 'nearest';
    await this.app.init({ resizeTo: host, background: '#14121c', antialias: false, roundPixels: true, resolution: window.devicePixelRatio || 1, autoDensity: true });
    host.appendChild(this.app.canvas);
    this.app.canvas.style.display = 'block';

    const st = useStore.getState();
    this.lastDaylightMode = st.daylightMode;
    this.moodyLighting = st.moodyLighting;
    this.floorStyle = st.floorStyle;
    this.plantStyle = st.plantStyle;
    this.daylight = daylightForMode(this.lastDaylightMode);
    this.night = this.daylight.night;
    const emps = st.employees;
    this.assets = generateAssets(this.night, emps.map((e, i) => this.lookFor(e, i)), this.floorStyle);
    this.backgroundCache.set(`${this.night}:${this.floorStyle}`, this.assets.background);
    // Size the workstation block to the live roster: one desk per agent.
    this.layout = buildLayout(emps.length);
    this.layout.blocked.forEach((row, ty) => row.forEach((b, tx) => { if (!b) this.walkable.push({ tx, ty }); }));
    // Penned agents (`starting`, `restarting`) only ever get goals from these two
    // lists, so they cannot walk out of the open-plan Lounge even though the
    // column-14 and row-16 edges carry no glass.
    this.loungeTiles = this.walkable.filter((t) => isInLounge(t.tx, t.ty));
    this.loungeSeats = this.layout.seats.filter(
      (s) => s.kind === 'lounge' && isInLounge(s.approach.tx, s.approach.ty),
    );
    // Idle agents live in the social rooms and nowhere else: their floor goals
    // are these tiles, so a standby agent never paces the workstation aisles.
    this.socialTiles = this.walkable.filter((t) => isSocialZone(zoneName(t.tx, t.ty)));

    const bg = new Sprite(this.assets.background);
    bg.scale.set(ART / DENSITY);
    this.background = bg;
    this.sortLayer.sortableChildren = true;
    // Room plates sit above the furniture: a plate that lands on a tall prop
    // (the NOC CRAC, a rack) would otherwise be hidden behind its sprite.
    this.root.addChild(bg, this.hands, this.sortLayer, this.roomLabelLayer, this.labelLayer);
    this.rackLeds = makeRackLeds(PROP, RACK_W);
    this.root.addChild(this.rackLedGraphics);
    // Hover mark slides in just under the props: it outlines a desk bay without
    // covering the chair, the monitor or the name plate.
    this.root.addChildAt(this.hoverMark, this.root.getChildIndex(this.sortLayer));
    this.root.addChildAt(this.roomHighlight, this.root.getChildIndex(this.labelLayer));
    // Atmosphere floor pools sit beneath sorted props; dark ambient veil sits
    // right above sorted props (and under room plates/name tags).
    this.atmosphere.mountWorld(this.root, this.sortLayer, this.roomLabelLayer);
    // Particles ride between the props and the room plates, so steam reads over
    // the furniture without ever covering a plate or a name tag.
    this.particles.mount(this.root, this.sortLayer, this.roomLabelLayer);
    this.app.stage.addChild(this.root);
    this.atmosphere.mountScreen(this.app.stage);
    this.atmosphere.resize(this.app.screen.width, this.app.screen.height);

    this.plantSprites = [];
    this.lampSprites = [];
    for (const f of this.layout.furniture) {
      const s = new Sprite(this.assets.furn[f.type]);
      s.anchor.set(0.5, 1); s.scale.set(SHELL.has(f.type) ? ART / DENSITY : PROP / DENSITY); s.position.set(f.x, f.y); s.zIndex = f.z;
      this.sortLayer.addChild(s);
      if (f.type === 'plant') this.plantSprites.push(s);
      else if (f.type === 'floorLamp' || f.type === 'deskLamp' || f.type === 'wallSconce') {
        this.lampSprites.push({ type: f.type, sprite: s });
      }
    }
    this.applyPlantStyle();
    this.updateLamps();
    // One monitor per workstation, lit only while a working/ready agent sits there.
    this.monitors = [];
    for (const seat of this.layout.seats) {
      if (!seat.monitor) continue;
      const s = new Sprite(this.assets.monitorOff);
      // Bottom-anchored: the layout stores the sprite's bottom edge just above
      // the desk front, so doubling the scale grows the screen upward.
      s.anchor.set(0.5, 1); s.scale.set(MONITOR_SCALE);
      s.position.set(seat.monitor.x, seat.monitor.y); s.zIndex = seat.monitor.z;
      this.sortLayer.addChild(s);
      this.monitors.push({ seat, sprite: s });
    }
    this.layout.roomLabels.forEach((label) => this.roomLabelLayer.addChild(this.buildRoomLabel(label)));
    this.emitters = this.buildEmitters();
    this.staticLights = this.buildStaticLights();
    this.rebuildCharacters();    this.bindInput(); this.bindMotion();
    this.restoreView();
    this.updateClock();
    this.app.ticker.add((t) => this.update(t.deltaMS / 1000));
    this.ready = true;
  }
  /**
   * Motion preferences and tab visibility. `prefers-reduced-motion` pins the
   * decorative layer (breathe, idle bob, motes) while the walk cycle keeps
   * running, because that motion is the simulation itself. A hidden tab stops
   * the ticker outright: PixiJS keeps rendering rAF frames otherwise, and a
   * background office burns GPU for pixels nobody can see.
   */
  private bindMotion() {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => {
      this.calm = mq.matches;
      this.atmosphere.setCalm(this.calm);
      this.chars.forEach((c) => c.setCalm(this.calm));
      if (this.calm) this.particles.setQuality(0);
      else this.particles.setQuality(this.particleQuality);
    };
    apply();
    mq.addEventListener('change', apply);
    this.cleanups.push(() => mq.removeEventListener('change', apply));
    const onVisibility = () => {
      if (document.hidden) this.app.ticker.stop();
      else { this.frameAvg = 0; this.budgetT = 0; this.app.ticker.start(); }
    };
    document.addEventListener('visibilitychange', onVisibility);
    this.cleanups.push(() => document.removeEventListener('visibilitychange', onVisibility));
    const onUnload = () => { saveView(this.cam); saveAgentPoses(this.chars); };
    window.addEventListener('pagehide', onUnload);
    this.cleanups.push(() => window.removeEventListener('pagehide', onUnload));
  }

  resize() {
    if (!this.ready) return;
    this.app.renderer.resize(this.host.clientWidth, this.host.clientHeight);
    this.atmosphere.resize(this.app.screen.width, this.app.screen.height);
    this.applyCamera();
  }

  destroy() {
    saveView(this.cam);
    saveAgentPoses(this.chars);
    this.cleanups.forEach((f) => f());
    this.particles.destroy();
    const live = this.background?.texture;
    this.app.destroy({ removeView: true }, { children: true, texture: true });
    // Off-pass cached backgrounds never joined the stage, so destroy them here.
    this.backgroundCache.forEach((tex) => { if (tex !== live) tex.destroy(true); });
    this.backgroundCache.clear();
  }

  // ---------- Input & kamera ----------
  /**
   * Emitter outlets, derived from the placed props so moving a prop in the
   * layout moves its steam/haze with it. Offsets are in art pixels scaled by
   * `PROP`, placing each emitter precisely at its visual source (e.g. directly
   * over the coffee cup on the lounge coffeeTable).
   */
  private buildEmitters(): EmitSpot[] {
    const SPOTS: Partial<Record<FurnitureType, { dx: number; dy: number; kind: 'steam' | 'air' }>> = {
      dispenser: { dx: 1, dy: 15, kind: 'steam' },
      coffeeTable: { dx: 5.5, dy: 10.5, kind: 'steam' },
      crac: { dx: 0, dy: 19, kind: 'air' },
    };
    const out: EmitSpot[] = [];
    for (const f of this.layout.furniture) {
      const spot = SPOTS[f.type];
      if (!spot) continue;
      out.push({ x: f.x + spot.dx * PROP, y: f.y - spot.dy * PROP, kind: spot.kind });
    }
    return out;
  }
  private staticLampLights: EmissiveLight[] = [];
  private buildStaticLights(): EmissiveLight[] {
    const out: EmissiveLight[] = [];
    this.staticLampLights = [];
    for (const f of this.layout.furniture) {
      if (f.type === 'serverRack') out.push({ x: f.x, y: f.y - 24, w: 132, h: 108, color: 0x4aa3d8, intensity: 0.48, pulse: 2.2, cutout: 0.72 });
      else if (f.type === 'crac') out.push({ x: f.x, y: f.y - 16, w: 120, h: 90, color: 0x6fd8ff, intensity: 0.38, pulse: 1.5, cutout: 0.65 });
      else if (f.type === 'ups') out.push({ x: f.x, y: f.y - 12, w: 104, h: 72, color: 0xd9a441, intensity: 0.34, pulse: 1.8, cutout: 0.62 });
      else if (f.type === 'fridge') out.push({ x: f.x, y: f.y - 12, w: 108, h: 80, color: 0xbfe6fa, intensity: 0.24, cutout: 0.45 });
      else if (f.type === 'dispenser') out.push({ x: f.x, y: f.y - 20, w: 96, h: 70, color: 0x7ec8f0, intensity: 0.28, cutout: 0.50 });
      else if (f.type === 'floorLamp') {
        this.staticLampLights.push({ x: f.x, y: f.y - 36, w: 280, h: 220, color: 0xffb85c, intensity: 0.85, pulse: 0.8, cutout: 0.96 });
      } else if (f.type === 'deskLamp') {
        this.staticLampLights.push({ x: f.x - 10, y: f.y + 4, w: 172, h: 134, color: 0xffc66d, intensity: 0.72, cutout: 0.88 });
      } else if (f.type === 'wallSconce') {
        this.staticLampLights.push({ x: f.x, y: f.y + 24, w: 190, h: 156, color: 0xffb259, intensity: 0.70, cutout: 0.84 });
      }
    }
    return out;
  }
  private collectEmissiveLights(): EmissiveLight[] {
    const lights = [...this.staticLights];
    const lampScale = !this.moodyLighting
      ? 0
      : this.daylight.key === 'night'
        ? 1
        : this.daylight.key === 'dusk'
          ? 0.68
          : this.daylight.key === 'dawn'
            ? 0.40
            : 0;
    if (lampScale > 0) {
      for (const l of this.staticLampLights) {
        lights.push({ ...l, intensity: l.intensity * lampScale, cutout: (l.cutout ?? 0.85) * Math.min(1, lampScale * 1.1) });
      }
    }
    for (const { seat } of this.monitors) {
      if (!seat.monitor) continue;
      const ch = seat.occupant ? this.chars.find((c) => c.id === seat.occupant) : undefined;
      const seated = !!ch && ch.state === 'sit' && ch.seat === seat;
      const state = monitorStateFor(seated && ch ? this.empOf(ch.id)?.phase : undefined, seated);
      if (state === 'moving') {
        lights.push({ x: seat.monitor.x, y: seat.monitor.y + 18, w: 164, h: 116, color: 0x4aa3d8, intensity: 0.78, pulse: 3.4, cutout: 0.90 });
      } else if (state === 'still') {
        lights.push({ x: seat.monitor.x, y: seat.monitor.y + 18, w: 148, h: 102, color: 0x3b8ac4, intensity: 0.56, cutout: 0.78 });
      } else if (state === 'waiting') {
        lights.push({ x: seat.monitor.x, y: seat.monitor.y + 18, w: 132, h: 92, color: 0x94a3b8, intensity: 0.40, cutout: 0.65 });
      }
    }
    return lights;
  }
  private buildRoomLabel(label: RoomLabel): Container {
    const plate = new Container();
    const text = new Text({
      text: label.name,
      style: { fontFamily: 'monospace', fontSize: 9, fontWeight: 'bold', letterSpacing: 1, fill: 0xf2ede0 },
      resolution: 4,
    });
    text.anchor.set(0.5);
    const w = Math.round(text.width + 12), h = 14;
    const plateBg = new Graphics()
      .roundRect(-w / 2, -h / 2, w, h, 3)
      .fill({ color: 0x1d1722, alpha: 0.5 })
      .stroke({ width: 1, color: 0x8e8676, alpha: 0.45 });
    plate.addChild(plateBg, text);
    plate.position.set((label.tx + 0.5) * TILE, (label.ty + 0.5) * TILE);
    return plate;
  }
  private bindInput() {
    const cv = this.app.canvas as HTMLCanvasElement;
    const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement | Window, ev: string, fn: (e: any) => void, opt?: AddEventListenerOptions) => {
      el.addEventListener(ev, fn, opt); this.cleanups.push(() => el.removeEventListener(ev, fn));
    };
    on(cv, 'pointerdown', (e: PointerEvent) => { this.drag = { active: true, moved: 0, lx: e.clientX, ly: e.clientY }; cv.setPointerCapture(e.pointerId); });
    on(cv, 'pointermove', (e: PointerEvent) => {
      if (this.drag.active) {
        const dx = e.clientX - this.drag.lx, dy = e.clientY - this.drag.ly, z = ZOOM_STEPS[this.cam.zi];
        this.drag.moved += Math.abs(dx) + Math.abs(dy); this.drag.lx = e.clientX; this.drag.ly = e.clientY;
        this.cam.x -= dx / z; this.cam.y -= dy / z; cv.style.cursor = 'grabbing';
        if (this.drag.moved > 4) {
          this.camGoal = null;
          if (useStore.getState().followSelected) useStore.getState().setFollowSelected(false);
        }
        this.setHover(null);
      } else {
        const id = this.pickEmployeeId(e);
        cv.style.cursor = id ? 'pointer' : 'default';
        this.setHover(id, e);
      }
    });
    on(cv, 'pointerleave', () => { this.setHover(null); cv.style.cursor = 'default'; });
    on(cv, 'pointerup', (e: PointerEvent) => {
      if (this.drag.active && this.drag.moved < 5) useStore.getState().select(this.pickEmployeeId(e));
      this.drag.active = false; cv.style.cursor = 'default';
    });
    on(cv, 'wheel', (e: WheelEvent) => { e.preventDefault(); this.zoomBy(e.deltaY < 0 ? 1 : -1); }, { passive: false });
    on(window, 'keydown', (e: KeyboardEvent) => {
      this.keys.add(e.code);
      if (e.code.startsWith('Arrow')) e.preventDefault();
      if (e.code === 'KeyW' || e.code === 'KeyA' || e.code === 'KeyS' || e.code === 'KeyD' || e.code.startsWith('Arrow')) {
        this.camGoal = null;
        if (useStore.getState().followSelected) useStore.getState().setFollowSelected(false);
      }
      if (e.code === 'KeyE') this.shuffle();
      if (e.code === 'Escape') useStore.getState().select(null);
      if (e.code === 'Equal' || e.code === 'NumpadAdd') this.zoomBy(1);
      if (e.code === 'Minus' || e.code === 'NumpadSubtract') this.zoomBy(-1);
    });
    on(window, 'keyup', (e: KeyboardEvent) => this.keys.delete(e.code));
  }
  private zoomBy(d: number) { this.cam.zi = Math.max(0, Math.min(ZOOM_STEPS.length - 1, this.cam.zi + d)); }
  /**
   * Reopen where the last session left off: the camera from `localStorage`
   * (clamped to the world by `applyCamera`) and `?agent=<id>` for the selected
   * employee. Both are inert for a brand-new visitor — no stored view, no
   * query — so the shipped defaults still win.
   */
  private restoreView() {
    const view = restoreView();
    if (view.cam) this.cam = view.cam;
    if (view.selected && useStore.getState().employees.some((e) => e.id === view.selected)) {
      useStore.getState().select(view.selected);
    }
    this.applyCamera();
  }
  /** Canvas pointer → world coordinates, through the camera transform. */
  private worldPoint(e: PointerEvent): { x: number; y: number } {
    const r = this.app.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left - this.root.x) / this.root.scale.x,
      y: (e.clientY - r.top - this.root.y) / this.root.scale.y,
    };
  }
  private pick(e: PointerEvent): Character | null {
    const { x: wx, y: wy } = this.worldPoint(e);
    return [...this.chars].sort((a, b) => b.y - a.y).find(
      (c) => Math.abs(wx - c.x) <= 14 * PROP_SCALE && wy <= c.y + 4 * PROP_SCALE && wy >= c.y - 50 * PROP_SCALE,
    ) ?? null;
  }
  /**
   * The workstation computer under the pointer: monitor screen first, then the
   * desk and chair footprint. Returns the seat, so a click can resolve to the
   * agent that owns that computer even while the agent is walking elsewhere.
   */
  private pickDesk(e: PointerEvent): Seat | null {
    const { x: wx, y: wy } = this.worldPoint(e);
    const desks = this.layout.seats.filter((s) => s.kind === 'desk');
    for (const s of desks) {
      if (!s.monitor) continue;
      // Monitor art is 16x14 art px, anchored top-center.
      if (Math.abs(wx - s.monitor.x) <= MONITOR_W / 2 + 4 && wy >= s.monitor.y - MONITOR_H - 4 && wy <= s.monitor.y + 6) return s;
    }
    for (const s of desks) {
      if (Math.abs(wx - s.pos.x) <= 34 * PROP_SCALE && wy >= s.pos.y - 48 * PROP_SCALE && wy <= s.pos.y + 16 * PROP_SCALE) return s;
    }
    return null;
  }
  /** Character under the pointer, else the agent whose computer was clicked. */
  private pickEmployeeId(e: PointerEvent): string | null {
    const ch = this.pick(e);
    if (ch) return ch.id;
    const seat = this.pickDesk(e);
    if (!seat) return null;
    if (seat.occupant) return seat.occupant;
    return useStore.getState().employees.find((x) => x.currentWorkstation === seat.id)?.id ?? null;
  }
  /**
   * Hover feedback: mirror the pointer target as a faint ring on the agent and,
   * when the hit came from a desk rather than a body, outline that desk bay. The
   * mark lives below the sorted layer so it never hides a prop or a name plate.
   */
  private setHover(id: string | null, e?: PointerEvent) {
    if (id !== this.hoverId) {
      this.hoverId = id;
      for (const ch of this.chars) ch.setHovered(false);
    }
    if (id) for (const ch of this.chars) if (ch.id === id) ch.setHovered(true);
    this.hoverMark.clear();
    const st = useStore.getState();
    if (!id || !e) {
      if (st.hoveredAgent !== null) st.setHoveredAgent(null);
      return;
    }
    const emp = this.empOf(id);
    if (emp) {
      const ch = this.chars.find((c) => c.id === id);
      const badge = badgeFor(emp);
      const t = ch ? tileOf(ch.x, ch.y) : null;
      const zone = t ? zoneName(t.tx, t.ty) : (emp.currentWorkstation ?? 'Office');
      st.setHoveredAgent({
        id: emp.id,
        name: emp.name,
        role: emp.role,
        phaseLabel: badge.label,
        phaseColor: badge.color,
        zone,
        screenX: e.clientX,
        screenY: e.clientY,
      });
    }
    const seat = this.pickDesk(e);
    if (!seat) return;
    // Crisp 32-bit pixel frame + corner pips around the hovered workstation bay.
    const w = 34 * PROP_SCALE * 2, h = 24 * PROP_SCALE;
    const z = ZOOM_STEPS[this.cam.zi];
    const x = Math.round(seat.pos.x - w / 2), y = Math.round(seat.pos.y - h);
    const t = Math.max(2, Math.round(2 / z));
    const pip = 6;
    this.hoverMark
      .rect(x, y, w, h)
      .stroke({ width: t, color: 0xfff3a0, alpha: 0.65 })
      .rect(x, y, pip, t).fill({ color: 0xfffbe0, alpha: 0.95 })
      .rect(x, y, t, pip).fill({ color: 0xfffbe0, alpha: 0.95 })
      .rect(x + w - pip, y, pip, t).fill({ color: 0xfffbe0, alpha: 0.95 })
      .rect(x + w - t, y, t, pip).fill({ color: 0xfffbe0, alpha: 0.95 })
      .rect(x, y + h - t, pip, t).fill({ color: 0xfffbe0, alpha: 0.95 })
      .rect(x, y + h - pip, t, pip).fill({ color: 0xfffbe0, alpha: 0.95 })
      .rect(x + w - pip, y + h - t, pip, t).fill({ color: 0xfffbe0, alpha: 0.95 })
      .rect(x + w - t, y + h - pip, t, pip).fill({ color: 0xfffbe0, alpha: 0.95 });
  }
  private applyCamera() {
    const vw = this.app.screen.width, vh = this.app.screen.height, z = ZOOM_STEPS[this.cam.zi];
    const hw = vw / 2 / z, hh = vh / 2 / z;
    this.cam.x = WORLD_W <= vw / z ? WORLD_W / 2 : Math.max(hw, Math.min(WORLD_W - hw, this.cam.x));
    this.cam.y = WORLD_H <= vh / z ? WORLD_H / 2 : Math.max(hh, Math.min(WORLD_H - hh, this.cam.y));
    this.root.scale.set(z);
    this.root.position.set(Math.round(vw / 2 - this.cam.x * z), Math.round(vh / 2 - this.cam.y * z));
  }

  // ---------- Simulasi ----------
  private empOf(id: string) { return useStore.getState().employees.find((e) => e.id === id); }

  private lookFor(e: Employee, i: number): Look {
    const spec = avatarSpec({
      seed: e.avatarSeed,
      hue: e.avatarHue,
      color: e.avatarColor,
      agentId: e.id,
      fallbackSeed: e.id,
    });
    return makeLook(shirtColorFor(e), i, spec.accessory, spec.hair);
  }

  /** Rebuilds every character when the employee list changes (mock → live, poll refresh). */
  private rebuildCharacters() {
    if (this.chars.length) {
      saveAgentPoses(this.chars);
      this.savedPoses = loadAgentPoses();
    }
    for (const ch of this.chars) {
      ch.container.destroy({ children: true });
      ch.tag.destroy({ children: true });
    }
    this.chars = [];
    this.phases.clear();
    const emps = useStore.getState().employees;
    emps.forEach((e, i) => {
      const frames = this.assets.chars[i] ?? makeCharFrames(this.lookFor(e, i));
      const ch = new Character(e.id, e.name, frames, this.assets.bubble);
      ch.setCalm(this.calm);
      this.sortLayer.addChild(ch.container);
      this.labelLayer.addChild(ch.tag);
      this.chars.push(ch);
      this.assign(ch, e.status, true);
    });
  }

  private charactersMatchSource(): boolean {
    const emps = useStore.getState().employees;
    if (emps.length !== this.chars.length) return false;
    for (let i = 0; i < emps.length; i++) {
      if (emps[i].id !== this.chars[i].id) return false;
    }
    return true;
  }
  private shuffle() {
    const st = useStore.getState();
    if (st.source.source !== 'mock') return;
    st.employees.forEach((e) => { if (Math.random() < 0.7) st.setStatus(e.id, STATUSES[Math.floor(Math.random() * STATUSES.length)]); });
  }
  private release(id: string) {
    this.layout.seats.forEach((s) => { if (s.occupant === id) s.occupant = null; });
    this.layout.chatSpots.forEach((s) => { if (s.occupant === id) s.occupant = null; });
  }
  private freeSeat(kind: Seat['kind']): Seat | null {
    const f = this.layout.seats.filter((s) => s.kind === kind && !s.occupant);
    return f.length ? f[Math.floor(Math.random() * f.length)] : null;
  }
  private freeSpot(): ChatSpot | null {
    const f = this.layout.chatSpots.filter((s) => !s.occupant);
    return f.length ? f[Math.floor(Math.random() * f.length)] : null;
  }
  /**
   * A meeting-room chair for a `chatting` agent. Chairs come in facing pairs
   * across the table (top row faces `down`, bottom row faces `up`), so the
   * agent prefers a free seat whose partner is already occupied — it joins the
   * conversation instead of sitting alone — and otherwise pairs two free seats.
   */
  private freeMeetingChatSeat(): Seat | null {
    const free = this.layout.seats.filter(
      (s) => s.kind === 'meeting' && !s.occupant,
    );
    const partnerOf = (s: Seat) =>
      this.layout.seats.find(
        (o) =>
          o.kind === 'meeting' &&
          o.id !== s.id &&
          o.pos.x === s.pos.x &&
          o.facing !== s.facing,
      );
    const withCompany = free.filter((s) => partnerOf(s)?.occupant);
    const fresh = free.filter((s) => {
      const p = partnerOf(s);
      return !!p && !p.occupant;
    });
    const pool = withCompany.length ? withCompany : fresh;
    return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
  }
  /**
   * True when the agent owes its desk a visit: a new instruction from a human
   * (unread message) or a pending answer request. Physical movement follows this
   * even while the phase is idle/restarting/blocked, so an agent that was
   * wandering walks back to its computer as soon as work arrives.
   */
  private owesDesk(emp: Employee | undefined): boolean {
    if (!emp) return false;
    const kind = emp.activity?.kind;
    return (emp.unreadCount ?? 0) > 0 || kind === 'unread' || kind === 'waiting';
  }
  private assign(ch: Character, status: Status, instant: boolean) {
    this.release(ch.id);
    ch.appliedStatus = status;
    const emp = this.empOf(ch.id);
    const penned = staysInLounge(emp?.phase);
    const owesDesk = this.owedDesk(emp);
    this.instructions.set(ch.id, owesDesk);
    if (emp) {
      const badge = badgeFor(emp);
      ch.setDot(badge.color);
      this.phases.set(ch.id, emp.phase);
    }
    ch.changeIn = 20 + Math.random() * 25;
    // Only a live 'working' phase produces the typing animation.
    ch.typing = status === 'working' && emp?.phase === 'working';
    // A starting or restarting agent has no desk, chair or chat partner yet: it
    // stays in the Lounge (sit, stand, walk) until the phase moves on.
    if (penned) {
      this.assignLounge(ch, instant);
      return;
    }
    let seat: Seat | null = null, spot: ChatSpot | null = null;
    let restoredPos: { x: number; y: number; facing: Dir } | null = null;
    const saved = instant ? this.savedPoses.get(ch.id) : undefined;
    if (instant) this.savedPoses.delete(ch.id);
    if (status === 'working' || owesDesk) {
      // Prefer the agent's own desk, then any free desk, then a seat elsewhere.
      const freeDesks = this.layout.seats.filter(
        (s) => s.kind === 'desk' && (!s.occupant || s.occupant === ch.id),
      );
      seat =
        freeDesks.find((s) => s.id === emp?.currentWorkstation) ??
        freeDesks[0] ??
        null;
    } else if (status === 'meeting') seat = this.freeSeat('meeting');
    else if (status === 'chatting') {
      // A chat can happen seated at the meeting table (two agents facing each
      // other across it, both with a talk bubble) or standing at an aisle chat
      // spot when every chair is taken.
      seat = this.freeMeetingChatSeat();
      if (!seat) spot = this.freeSpot();
    } else {
      // `idle` and `break` share one stage: restore the last saved social pose on
      // initial reload if still valid; otherwise pick a chair in Meeting, Lounge
      // or Pantry, preferring one that faces somebody seated.
      if (saved?.seatId) {
        const candidate = this.layout.seats.find(
          (s) => s.id === saved.seatId && isSocialSeat(s) && (!s.occupant || s.occupant === ch.id),
        );
        if (candidate) seat = candidate;
      } else if (saved) {
        const t = tileOf(saved.x, saved.y);
        if (!this.layout.blocked[t.ty]?.[t.tx] && isSocialZone(zoneName(t.tx, t.ty))) {
          restoredPos = { x: saved.x, y: saved.y, facing: saved.facing };
        }
      }
      if (!seat && !restoredPos) seat = pickIdleSeat(this.layout.seats, ch.id);
    }
    if (seat) seat.occupant = ch.id;
    if (spot) spot.occupant = ch.id;
    // An agent that walked to its computer for a pending instruction is really
    // in front of the screen, so it types even while the phase stays idle. A
    // blocked agent is parked there waiting for a human, so it does not type.
    ch.typing = ch.typing || (owesDesk && seat?.kind === 'desk' && emp?.phase !== 'blocked');
    if (instant) {
      if (seat) {
        ch.sitAt(seat);
        ch.wanderTimer = 18 + Math.random() * 20;
      } else if (spot) ch.placeAt(centerOf(spot), spot.facing);
      else if (restoredPos) {
        ch.placeAt({ x: restoredPos.x, y: restoredPos.y }, restoredPos.facing);
        ch.wanderTimer = 18 + Math.random() * 20;
      } else {
        const t = this.socialSpot();
        if (t) ch.placeAt(centerOf(t), 'down');
        else ch.placeAt(centerOf(this.walkable[Math.floor(Math.random() * this.walkable.length)]), 'down');
      }
    } else if (seat) this.routeTo(ch, seat.approach, seat);
    else if (spot) this.routeTo(ch, spot, null, spot.facing);
    else if (owesDesk) {
      // Every desk is taken: stand at the aisle beside the agent's own computer
      // instead of wandering off with the instruction unread.
      const own = this.layout.seats.find((s) => s.id === emp?.currentWorkstation);
      if (own) this.routeTo(ch, own.approach, null, own.facing);
      else this.wander(ch);
    }
    // Every social chair is taken: stand somewhere in a social room rather than
    // pacing the whole office.
    else this.wanderIdle(ch);
  }
  private routeTo(ch: Character, goal: Tile, seat: Seat | null, facing?: Dir) {
    if (seat && ch.seat === seat) return;
    const start = ch.seat ? ch.seat.approach : tileOf(ch.x, ch.y);
    const p = findPath(this.layout.blocked, start, goal);
    if (!p) return;
    const pts = p.map(centerOf);
    if (seat) pts.push(seat.pos);
    ch.walkTo(pts, seat, facing);
  }
  private wander(ch: Character) {
    this.routeTo(ch, this.walkable[Math.floor(Math.random() * this.walkable.length)], null);
    ch.wanderTimer = 2;
  }
  /** A floor tile in one of the social rooms, or null when none is free. */
  private socialSpot(): Tile | null {
    return pickIdleTile(this.socialTiles);
  }
  /**
   * Idle agent with no free chair left: stroll inside the social rooms only, at
   * a slow pace and for a short distance, so the office stays calm.
   */
  private wanderIdle(ch: Character) {
    const t = this.socialSpot();
    if (!t) return;
    this.routeTo(ch, t, null);
    ch.wanderTimer = 10 + Math.random() * 10;
  }
  /**
   * Stand up and take another social chair, or stay put: called when an idle
   * agent's dwell timer runs out. Staying seated is the common case.
   */
  private roomHop(ch: Character) {
    const seat = pickIdleSeat(this.layout.seats, ch.id);
    if (seat && ch.seat !== seat) {
      this.release(ch.id);
      seat.occupant = ch.id;
      this.routeTo(ch, seat.approach, seat);
      return;
    }
    this.wanderIdle(ch);
  }
  /**
   * A starting/restarting agent has no desk yet, so a pending instruction must
   * not pull it out of the Lounge.
   */
  private owedDesk(emp: Employee | undefined): boolean {
    return staysInLounge(emp?.phase) ? false : this.owesDesk(emp);
  }
  private restoreLoungePose(ch: Character): boolean {
    const saved = this.savedPoses.get(ch.id);
    this.savedPoses.delete(ch.id);
    if (!saved) return false;
    if (saved.seatId) {
      const seat = this.loungeSeats.find((s) => s.id === saved.seatId && (!s.occupant || s.occupant === ch.id));
      if (seat) {
        seat.occupant = ch.id;
        ch.sitAt(seat);
        ch.wanderTimer = 18 + Math.random() * 20;
        return true;
      }
      return false;
    }
    const t = tileOf(saved.x, saved.y);
    if (!this.layout.blocked[t.ty]?.[t.tx] && isInLounge(t.tx, t.ty)) {
      ch.placeAt({ x: saved.x, y: saved.y }, saved.facing);
      ch.wanderTimer = 18 + Math.random() * 20;
      return true;
    }
    return false;
  }
  /**
   * `starting` and `restarting` agents wait inside the Lounge: a free lounge
   * seat, or a lounge floor tile. No desk, meeting chair or chat spot, so the
   * room is their only stage until the phase moves on.
   */
  private assignLounge(ch: Character, instant: boolean) {
    if (instant && this.restoreLoungePose(ch)) return;
    const free = this.loungeSeats.filter((s) => !s.occupant || s.occupant === ch.id);
    const seat = free.length ? free[Math.floor(Math.random() * free.length)] : null;
    if (seat) {
      seat.occupant = ch.id;
      if (instant) ch.sitAt(seat);
      else this.routeTo(ch, seat.approach, seat);
      return;
    }
    if (!this.loungeTiles.length) return;
    const tile = this.loungeTiles[Math.floor(Math.random() * this.loungeTiles.length)];
    if (instant) ch.placeAt(centerOf(tile), 'down');
    else this.routeTo(ch, tile, null);
  }
  /** Idle starting/restarting agent: stroll between lounge tiles, never out of the room. */
  private wanderLounge(ch: Character) {
    if (!this.loungeTiles.length) return;
    this.routeTo(ch, this.loungeTiles[Math.floor(Math.random() * this.loungeTiles.length)], null);
    ch.wanderTimer = 3 + Math.random() * 4;
  }
  /** Live caption while an agent is penned: the phase word plus what it is doing. */
  private loungeText(phase: AgentPhase, walking: boolean): string {
    const label = phase === 'restarting' ? 'Restarting' : 'Starting up';
    return `${label} — ${walking ? 'walking' : 'waiting'} in Lounge`;
  }
  private taskText(s: Status, ws?: string, zone?: string) {
    const where = zone ?? 'the office';
    return ({ working: `Working at ${ws ?? 'desk'}`, meeting: 'Team meeting in Meeting Area', chatting: 'Chatting with colleagues', break: `Resting in ${where}`, idle: `Standing by in ${where}` })[s];
  }

  private update(dt: number) {
    if (!this.ready) return;
    dt = Math.min(dt, 0.1);
    this.tuneParticles(dt);
    const st = useStore.getState();
    if (st.daylightMode !== this.lastDaylightMode) {
      this.lastDaylightMode = st.daylightMode;
      this.refreshDaylight();
    }
    if (st.moodyLighting !== this.moodyLighting) {
      this.moodyLighting = st.moodyLighting;
      this.updateLamps();
    }
    if (st.floorStyle !== this.floorStyle) {
      this.floorStyle = st.floorStyle;
      this.applyBackground();
    }
    if (st.plantStyle !== this.plantStyle) {
      this.plantStyle = st.plantStyle;
      this.applyPlantStyle();
    }
    if (st.zoomAction && st.zoomAction.seq !== this.lastZoomSeq) {
      this.lastZoomSeq = st.zoomAction.seq;
      if (st.zoomAction.kind === 'in') this.zoomBy(1);
      else if (st.zoomAction.kind === 'out') this.zoomBy(-1);
      else this.cam.zi = DEFAULT_ZOOM_INDEX;
    }
    if (st.cameraTarget && st.cameraTarget.seq !== this.lastCamSeq) {
      this.lastCamSeq = st.cameraTarget.seq;
      this.camGoal = { x: st.cameraTarget.x, y: st.cameraTarget.y };
      if (typeof st.cameraTarget.zoom === 'number') {
        const targetZi = ZOOM_STEPS.indexOf(st.cameraTarget.zoom);
        if (targetZi >= 0) this.cam.zi = targetZi;
      }
      if (st.cameraTarget.highlight) {
        this.roomHighlightState = { ...st.cameraTarget.highlight, age: 0, duration: 3.0 };
      }
    }
    const z = ZOOM_STEPS[this.cam.zi], sp = (480 / z) * dt;
    if (!this.charactersMatchSource()) this.rebuildCharacters();
    const k = this.keys;
    if (k.has('KeyW') || k.has('ArrowUp')) this.cam.y -= sp;
    if (k.has('KeyS') || k.has('ArrowDown')) this.cam.y += sp;
    if (k.has('KeyA') || k.has('ArrowLeft')) this.cam.x -= sp;
    if (k.has('KeyD') || k.has('ArrowRight')) this.cam.x += sp;
    for (const ch of this.chars) {
      const emp = st.employees.find((e) => e.id === ch.id);
      if (!emp) continue;
      ch.setName(emp.name);
      const penned = staysInLounge(emp.phase);
      if (
        emp.status !== ch.appliedStatus ||
        this.phases.get(ch.id) !== emp.phase ||
        this.instructions.get(ch.id) !== this.owedDesk(emp)
      ) {
        this.assign(ch, emp.status, false);
      }
      // Random churn belongs to the mock simulation only. Live phases are facts.
      if (st.source.source === 'mock') {
        ch.changeIn -= dt;
        if (ch.changeIn <= 0) {
          ch.changeIn = 20 + Math.random() * 25;
          st.setStatus(ch.id, STATUSES[Math.floor(Math.random() * STATUSES.length)]);
        }
      }
      // Idle dwell: a seated agent keeps its chair (and its conversation) until
      // the timer runs out, then maybe takes another social chair. A standing
      // idle agent strolls inside the social rooms only.
      if (ch.appliedStatus === 'idle' && !this.instructions.get(ch.id) && !ch.path.length) {
        ch.wanderTimer -= dt;
        if (ch.wanderTimer <= 0) {
          ch.wanderTimer = 18 + Math.random() * 22;
          if (penned) this.wanderLounge(ch);
          else if (ch.state === 'sit' && Math.random() < 0.6) {
            // Stay put: sitting still is the calm, expected read.
          } else this.roomHop(ch);
        }
      }
      // A penned agent is alone in the Lounge: no chat or meeting bubble. An
      // idle agent that sits vis-à-vis a seated colleague does get one, so two
      // standby agents read as a conversation instead of two idle bodies.
      const chattingIdle = ch.appliedStatus === 'idle' && ch.state === 'sit' && !!ch.seat && isChattingSeat(this.layout.seats, ch.seat, ch.id);
      ch.talking = !penned && !ch.path.length && (ch.appliedStatus === 'meeting' || ch.appliedStatus === 'chatting' || chattingIdle);
      ch.update(dt);
      ch.tag.visible = st.showLabels;
      ch.setSelected(st.selectedId === ch.id);
    }
    this.clockT += dt; this.liveT += dt; this.monitorT += dt;
    // The rack panel answers the workload: every `working` agent is one notch of
    // blink speed. Easing the rate (never the phase) keeps the LEDs from jumping
    // when a phase changes, and makes a busy office read visibly quicker.
    const working = st.employees.reduce((n, e) => n + (e.phase === 'working' ? 1 : 0), 0);
    this.rackRate += (rackBlinkRate(working) - this.rackRate) * Math.min(1, dt * 1.2);
    // Reduced motion: the panels hold their current LED pattern instead of blinking.
    if (!this.calm) this.rackT += dt * this.rackRate;
    if (this.clockT >= 1) { this.clockT = 0; this.updateClock(); this.refreshDaylight(); saveAgentPoses(this.chars); }
    if (this.liveT >= 0.4) {
      this.liveT = 0;
      const ch = this.chars.find((c) => c.id === st.selectedId);
      if (ch) {
        const t = tileOf(ch.x, ch.y), emp = this.empOf(ch.id)!;
        const penned = staysInLounge(emp.phase);
        const task = penned
          ? this.loungeText(emp.phase, ch.path.length > 0)
          : emp.phase === 'blocked'
            ? (ch.path.length ? 'Blocked — walking to desk' : 'Blocked — waiting for your answer')
            : ch.path.length
              ? (this.instructions.get(ch.id) ? 'Walking to desk — new instruction' : 'Walking…')
              : this.instructions.get(ch.id) && emp.status === 'idle'
                ? 'At desk — reviewing new instruction'
                : this.taskText(emp.status, emp.currentWorkstation, zoneName(t.tx, t.ty));
        st.setLive({ zone: zoneName(t.tx, t.ty), task, x: Math.round(ch.x), y: Math.round(ch.y) });
      }
    }
    this.updateRackLeds();
    this.updateMonitors();
    this.particles.setDayKey(this.daylight.key);
    this.atmosphere.update(dt, {
      daylight: this.daylight,
      working,
      moodyLighting: this.moodyLighting,
      lights: this.collectEmissiveLights(),
    });
    this.particles.update(dt, this.emitters);
    this.updateRoomHighlight(dt);
    if (st.followSelected && st.selectedId) {
      const targetCh = this.chars.find((c) => c.id === st.selectedId);
      if (targetCh) this.camGoal = { x: targetCh.x, y: targetCh.y - 16 };
    }
    if (this.camGoal && !this.drag.active) {
      const factor = this.calm ? 1 : 1 - Math.exp(-7 * dt);
      this.cam.x += (this.camGoal.x - this.cam.x) * factor;
      this.cam.y += (this.camGoal.y - this.cam.y) * factor;
      if (!st.followSelected && Math.hypot(this.camGoal.x - this.cam.x, this.camGoal.y - this.cam.y) < 1.5) {
        this.cam.x = this.camGoal.x;
        this.cam.y = this.camGoal.y;
        this.camGoal = null;
      }
    }
    st.setZoomPercent(Math.round(ZOOM_STEPS[this.cam.zi] * 100));
    this.applyCamera();
  }
  /**
   * Screen on = the agent is actually sitting at that desk (`Character.state`
   * `sit` on the same seat) and its phase is `working`, `ready` or `blocked`. A
   * desk is reserved for the whole walk over, so the seat occupant alone is not
   * enough: the screen must stay dark until the body has arrived. A `working`
   * agent gets the animated frames (code rows scroll); `ready` gets the still
   * screen; `blocked` gets the grey waiting screen, because the agent is parked
   * in front of the computer until a human answers. Everyone else, including an
   * agent still walking to the desk, leaves the monitor dark.
   */
  /**
   * Adaptive particle budget. Averages frame time over a short window and steps
   * the mote budget down when the frame runs long (a 60 Hz frame is ~16.7 ms),
   * then creeps back up once the machine has headroom again. Reduced motion
   * owns the layer outright, so this never fights `bindMotion`.
   */
  private tuneParticles(dt: number) {
    if (this.calm) return;
    // Ignore the first frames after a tab wake-up: one huge delta would read as
    // a slow machine and drop the effect for no reason.
    if (dt > 0.25) return;
    this.frameAvg += (dt - this.frameAvg) * 0.05;
    this.budgetT += dt;
    if (this.budgetT < 1.5) return;
    this.budgetT = 0;
    const next = this.frameAvg > 0.026 ? Math.max(1 / 3, this.particleQuality - 1 / 3)
      : this.frameAvg < 0.0185 ? Math.min(1, this.particleQuality + 1 / 3)
        : this.particleQuality;
    if (next === this.particleQuality) return;
    this.particleQuality = next;
    this.particles.setQuality(next);
  }
  private updateMonitors() {
    if (!this.monitors.length) return;
    const frames = this.assets.monitorWorking;
    // Reduced motion: hold the first working frame instead of scrolling rows.
    const frame = frames[this.calm ? 0 : Math.floor(this.monitorT / (MONITOR_FRAME_MS / 1000)) % frames.length];
    for (const { seat, sprite } of this.monitors) {
      const ch = seat.occupant ? this.chars.find((c) => c.id === seat.occupant) : undefined;
      const seated = !!ch && ch.state === 'sit' && ch.seat === seat;
      const state = monitorStateFor(seated && ch ? this.empOf(ch.id)?.phase : undefined, seated);
      const tex =
        state === 'moving'
          ? frame
          : state === 'still'
            ? this.assets.monitorOn
            : state === 'waiting'
              ? this.assets.monitorWaiting
              : this.assets.monitorOff;
      if (sprite.texture !== tex) sprite.texture = tex;
    }
  }
  private updateRackLeds() {
    this.rackLedGraphics.clear();
    const core = 2 * PROP_SCALE;
    const half = core / 2;
    const halo = 4 * PROP_SCALE;
    for (const led of this.rackLeds) {
      const green = Math.sin(this.rackT * led.rate + led.phase) > 0;
      const col = green ? 0x5fd068 : 0xd9534f;
      const lx = Math.round(led.x);
      const ly = Math.round(led.y);
      // Pixel cross halo + crisp square LED core
      this.rackLedGraphics
        .rect(lx - halo / 2, ly - half, halo, core).fill({ color: col, alpha: 0.34 })
        .rect(lx - half, ly - halo / 2, core, halo).fill({ color: col, alpha: 0.34 })
        .rect(lx - half, ly - half, core, core).fill({ color: col, alpha: 1 })
        .rect(lx - half, ly - half, PROP_SCALE, PROP_SCALE).fill({ color: 0xffffff, alpha: 0.45 });
    }
  }
  private updateClock() {
    const d = new Date(), s = d.getSeconds(), m = d.getMinutes() + s / 60, h = (d.getHours() % 12) + m / 60;
    const cx = 640, cy = 60, a = (v: number, max: number) => (v / max) * Math.PI * 2 - Math.PI / 2;
    const snap = (v: number) => Math.round(v / ART) * ART;
    const hand = (ang: number, len: number, color: number) => {
      const steps = Math.max(2, Math.round(len / ART));
      for (let i = 0; i <= steps; i++) {
        const px = snap(cx + Math.cos(ang) * ((len * i) / steps));
        const py = snap(cy + Math.sin(ang) * ((len * i) / steps));
        this.hands.rect(px - 1, py - 1, ART, ART).fill(color);
      }
    };
    this.hands.clear();
    hand(a(h, 12), 6, 0x1d1722);
    hand(a(m, 60), 9, 0x1d1722);
    hand(a(s, 60), 10, 0xd9534f);
  }
  /**
   * Re-reads the wall clock and follows the daylight curve. The wash and the
   * rays ease every frame, but the baked background is a 1920 x 1280 texture,
   * so it is only regenerated when the day/night pass actually flips — once at
   * dawn and once at dusk. Both passes are cached, so a flip costs one texture
   * swap after the first build.
   */
  private updateRoomHighlight(dt: number) {
    this.roomHighlight.clear();
    const h = this.roomHighlightState;
    if (!h) return;
    h.age += dt;
    if (h.age >= h.duration) {
      this.roomHighlightState = null;
      return;
    }
    const rem = h.duration - h.age;
    const fade = rem < 0.45 ? rem / 0.45 : h.age < 0.15 ? h.age / 0.15 : 1;
    // Slow flash wave (~0.85 Hz) over 3 seconds, static under reduced motion
    const pulse = this.calm ? 0.8 : 0.22 + 0.78 * (0.5 - 0.5 * Math.cos(h.age * Math.PI * 2 * 0.85));
    const alpha = pulse * fade;
    const x = Math.round(h.x), y = Math.round(h.y), w = Math.round(h.w), hh = Math.round(h.h);
    const t = 4;
    const corner = 18;
    this.roomHighlight
      .rect(x, y, w, hh)
      .fill({ color: 0xfde68a, alpha: 0.07 * alpha })
      .stroke({ width: t, color: 0xfef08a, alpha: 0.88 * alpha })
      .rect(x - 2, y - 2, corner, t).fill({ color: 0xffffff, alpha: 0.95 * alpha })
      .rect(x - 2, y - 2, t, corner).fill({ color: 0xffffff, alpha: 0.95 * alpha })
      .rect(x + w - corner + 2, y - 2, corner, t).fill({ color: 0xffffff, alpha: 0.95 * alpha })
      .rect(x + w - t + 2, y - 2, t, corner).fill({ color: 0xffffff, alpha: 0.95 * alpha })
      .rect(x - 2, y + hh - t + 2, corner, t).fill({ color: 0xffffff, alpha: 0.95 * alpha })
      .rect(x - 2, y + hh - corner + 2, t, corner).fill({ color: 0xffffff, alpha: 0.95 * alpha })
      .rect(x + w - corner + 2, y + hh - t + 2, corner, t).fill({ color: 0xffffff, alpha: 0.95 * alpha })
      .rect(x + w - t + 2, y + hh - corner + 2, t, corner).fill({ color: 0xffffff, alpha: 0.95 * alpha });
  }
  private updateLamps() {
    const lit = this.moodyLighting && (this.daylight.key === 'night' || this.daylight.key === 'dusk');
    const bank = lit ? this.assets.lampOn : this.assets.lampOff;
    for (const item of this.lampSprites) {
      const tex = bank[item.type];
      if (item.sprite.texture !== tex) item.sprite.texture = tex;
    }
  }
  private applyPlantStyle() {
    const order: readonly ConcretePlantStyle[] = ['monstera', 'bonsai', 'palm', 'cactus', 'classic'];
    this.plantSprites.forEach((sprite, idx) => {
      const kind = this.plantStyle === 'mixed' ? order[idx % order.length] : this.plantStyle;
      const tex = this.assets.plantVariants[kind];
      if (sprite.texture !== tex) sprite.texture = tex;
    });
  }
  private applyBackground() {
    const key = `${this.night}:${this.floorStyle}`;
    const cached = this.backgroundCache.get(key);
    const tex = cached ?? makeBackground(this.night, this.floorStyle);
    if (!cached) this.backgroundCache.set(key, tex);
    this.background.texture = tex;
  }
  private refreshDaylight() {
    this.daylight = daylightForMode(useStore.getState().daylightMode);
    this.updateLamps();
    if (this.daylight.night === this.night) return;
    this.night = this.daylight.night;
    this.applyBackground();
  }
}
