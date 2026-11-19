import { Application, Container, Graphics, Sprite, Text, TextureStyle, type Texture } from 'pixi.js';
import { ART, DENSITY, PROP, PROP_SCALE, RACK_BLINK_BASE, RACK_W, FOOT_OFFSET, PHASE_COLORS, TILE, WORLD_H, WORLD_W, ZOOM_STEPS, badgeFor, shirtColorFor, type Dir } from '../constants';
import type { Status, AgentPhase, Employee } from '../types';
import { useStore } from '../store/useStore';
import { generateAssets, makeBackground, makeCharFrames, makeLook, makeRackLeds, rackBlinkRate, type Assets, type FurnitureType, type RackLed } from './AssetGenerator';
import { buildLayout, zoneName, type ChatSpot, type Layout, type RoomLabel, type Seat } from './Layout';
import { isChattingSeat, isSocialZone, pickIdleSeat, pickIdleTile } from './Idle';
import { isInLounge, staysInLounge } from './Lounge';
import { Character, type Vec } from './Character';
import { monitorStateFor } from './Monitor';
import { findPath, type Tile } from './Pathfinder';
import { Atmosphere } from './Atmosphere';
import { Particles, type EmitSpot } from './Particles';
import { daylightAt, type Daylight } from './DayCycle';

const STATUSES: Status[] = ['working', 'working', 'working', 'meeting', 'chatting', 'break', 'idle'];
/**
 * Room shell: glass partitions, doors and the wall-mounted whiteboard keep
 * `ART` instead of `PROP`. They own the tile grid, so enlarging them would hang
 * a run a tile past its last tile and eat the aisle; at `ART` a run ends
 * exactly where the layout says, and a 64 x 40 art board stays 4 x 2.5 tiles
 * on the meeting-room wall instead of eating half the room.
 */
const SHELL: ReadonlySet<FurnitureType> = new Set<FurnitureType>([
  'partitionH', 'partitionHHalf', 'partitionV', 'partitionCorner', 'doorH', 'doorV', 'whiteboard',
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
const tileOf = (x: number, y: number): Tile => ({ tx: Math.floor(x / TILE), ty: Math.floor((y - FOOT_OFFSET) / TILE) });
const centerOf = (t: Tile): Vec => ({ x: (t.tx + 0.5) * TILE, y: (t.ty + 0.5) * TILE + FOOT_OFFSET });

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null;

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
  /** Agent currently under the pointer, or null. Drives the hover ring. */
  private hoverId: string | null = null;
  private atmosphere = new Atmosphere();
  private particles = new Particles();
  /** Steam and haze outlets, resolved from the layout once at init. */
  private emitters: EmitSpot[] = [];
  /** Night pass of the background, re-used by the atmosphere wash. */
  private night = false;
  /** Live daylight curve; recomputed from the clock each frame. */
  private daylight: Daylight = daylightAt(12);
  private background!: Sprite;
  /** Baked background per pass, so a dawn/dusk flip never rebuilds twice. */
  private backgroundCache = new Map<boolean, Texture>();
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
  private cam = { x: WORLD_W / 2, y: WORLD_H / 2 + 60, zi: 1 };
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

  async init(host: HTMLElement) {
    this.host = host;
    TextureStyle.defaultOptions.scaleMode = 'nearest';
    await this.app.init({ resizeTo: host, background: '#14121c', antialias: false, roundPixels: true, resolution: window.devicePixelRatio || 1, autoDensity: true });
    host.appendChild(this.app.canvas);
    this.app.canvas.style.display = 'block';

    const h = new Date().getHours();
    this.daylight = daylightAt(h);
    this.night = this.daylight.night;
    const emps = useStore.getState().employees;
    this.assets = generateAssets(this.night, emps.map((e, i) => makeLook(shirtColorFor(e), i)));
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
    // Atmosphere sits between the floor art and the sorted props: the light
    // pools tint the floor, and the props stay crisp on top of the haze.
    this.atmosphere.mountWorld(this.root, this.sortLayer);
    // Particles ride between the props and the room plates, so steam reads over
    // the furniture without ever covering a plate or a name tag.
    this.particles.mount(this.root, this.sortLayer, this.roomLabelLayer);
    this.app.stage.addChild(this.root);
    this.atmosphere.mountScreen(this.app.stage);
    this.atmosphere.resize(this.app.screen.width, this.app.screen.height);

    for (const f of this.layout.furniture) {
      const s = new Sprite(this.assets.furn[f.type]);
      s.anchor.set(0.5, 1); s.scale.set(SHELL.has(f.type) ? ART / DENSITY : PROP / DENSITY); s.position.set(f.x, f.y); s.zIndex = f.z;
      this.sortLayer.addChild(s);
    }
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
    const onUnload = () => saveView(this.cam);
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
    this.cleanups.forEach((f) => f());
    this.particles.destroy();
    const live = this.background?.texture;
    this.app.destroy({ removeView: true }, { children: true, texture: true });
    // The off-pass background never joined the stage, so the stage-wide texture
    // teardown above cannot reach it.
    this.backgroundCache.forEach((tex) => { if (tex !== live) tex.destroy(true); });
    this.backgroundCache.clear();
  }

  // ---------- Input & kamera ----------
  /**
   * Emitter outlets, derived from the placed props so moving a fridge in the
   * layout moves its steam with it. Height is the art height times the prop
   * draw scale, which puts the outlet on the sprite's top edge.
   */
  private buildEmitters(): EmitSpot[] {
    const SPOTS: Partial<Record<FurnitureType, { artH: number; kind: 'steam' | 'air' }>> = {
      dispenser: { artH: 30, kind: 'steam' },
      coffeeTable: { artH: 16, kind: 'steam' },
      crac: { artH: 32, kind: 'air' },
    };
    const out: EmitSpot[] = [];
    for (const f of this.layout.furniture) {
      const spot = SPOTS[f.type];
      if (!spot) continue;
      out.push({ x: f.x, y: f.y - spot.artH * (PROP / DENSITY) + 2, kind: spot.kind });
    }
    return out;
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
    if (!id || !e) return;
    const seat = this.pickDesk(e);
    if (!seat) return;
    // World-space geometry is scaled by the camera, so a 1 px stroke would drop
    // under a screen pixel at the default 0.75 zoom. Width follows the zoom step
    // to stay a visible 2 px outline at every zoom level.
    const w = 34 * PROP_SCALE * 2, h = 24 * PROP_SCALE;
    const z = ZOOM_STEPS[this.cam.zi];
    const x = seat.pos.x - w / 2, y = seat.pos.y - h;
    this.hoverMark
      .roundRect(x, y, w, h, 6)
      .stroke({ width: 2 / z, color: 0xfff3a0, alpha: 0.55 })
      .roundRect(x, y, w, h, 6)
      .stroke({ width: 1 / z, color: 0xfffbe0, alpha: 0.9 });
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

  /** Rebuilds every character when the employee list changes (mock → live, poll refresh). */
  private rebuildCharacters() {
    for (const ch of this.chars) {
      ch.container.destroy({ children: true });
      ch.tag.destroy({ children: true });
    }
    this.chars = [];
    this.phases.clear();
    const emps = useStore.getState().employees;
    emps.forEach((e, i) => {
      const frames = this.assets.chars[i] ?? makeCharFrames(makeLook(shirtColorFor(e), i));
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
      // `idle` and `break` share one stage: a chair in the Meeting Area, the
      // Lounge or the Pantry, preferring one that already faces somebody seated
      // (so the bubble reads as a conversation). A standby agent never picks a
      // workstation aisle, which is what made the office look busy.
      seat = pickIdleSeat(this.layout.seats, ch.id);
    }
    if (seat) seat.occupant = ch.id;
    if (spot) spot.occupant = ch.id;
    // An agent that walked to its computer for a pending instruction is really
    // in front of the screen, so it types even while the phase stays idle. A
    // blocked agent is parked there waiting for a human, so it does not type.
    ch.typing = ch.typing || (owesDesk && seat?.kind === 'desk' && emp?.phase !== 'blocked');
    if (instant) {
      if (seat) ch.sitAt(seat);
      else if (spot) ch.placeAt(centerOf(spot), spot.facing);
      else {
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
  /**
   * `starting` and `restarting` agents wait inside the Lounge: a free lounge
   * seat, or a lounge floor tile. No desk, meeting chair or chat spot, so the
   * room is their only stage until the phase moves on.
   */
  private assignLounge(ch: Character, instant: boolean) {
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
    const st = useStore.getState(), z = ZOOM_STEPS[this.cam.zi], sp = (480 / z) * dt;
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
    if (this.clockT >= 1) { this.clockT = 0; this.updateClock(); this.refreshDaylight(); }
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
    this.atmosphere.update(dt, { daylight: this.daylight, working });
    this.particles.update(dt, this.emitters);
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
    for (const led of this.rackLeds) {
      const green = Math.sin(this.rackT * led.rate + led.phase) > 0;
      this.rackLedGraphics
        .circle(led.x, led.y, 2 * PROP_SCALE)
        .fill(green ? 0x5fd068 : 0xd9534f);
      this.rackLedGraphics
        .circle(led.x, led.y, 3.5 * PROP_SCALE)
        .stroke({ width: 1, color: green ? 0x5fd068 : 0xd9534f, alpha: 0.4 });
    }
  }
  private updateClock() {
    const d = new Date(), s = d.getSeconds(), m = d.getMinutes() + s / 60, h = (d.getHours() % 12) + m / 60;
    const cx = 640, cy = 60, a = (v: number, max: number) => (v / max) * Math.PI * 2 - Math.PI / 2;
    const hand = (ang: number, len: number, w: number, color: number) => this.hands.moveTo(cx, cy).lineTo(cx + Math.cos(ang) * len, cy + Math.sin(ang) * len).stroke({ width: w, color });
    this.hands.clear();
    hand(a(h, 12), 6, 2, 0x1d1722); hand(a(m, 60), 9, 2, 0x1d1722); hand(a(s, 60), 10, 1, 0xd9534f);
  }
  /**
   * Re-reads the wall clock and follows the daylight curve. The wash and the
   * rays ease every frame, but the baked background is a 1920 x 1280 texture,
   * so it is only regenerated when the day/night pass actually flips — once at
   * dawn and once at dusk. Both passes are cached, so a flip costs one texture
   * swap after the first build.
   */
  private refreshDaylight() {
    const d = new Date();
    const hours = d.getHours() + d.getMinutes() / 60;
    this.daylight = daylightAt(hours);
    if (this.daylight.night === this.night) return;
    this.night = this.daylight.night;
    const cached = this.backgroundCache.get(this.night);
    const tex = cached ?? makeBackground(this.night);
    if (!cached) this.backgroundCache.set(this.night, tex);
    this.background.texture = tex;
  }
}
