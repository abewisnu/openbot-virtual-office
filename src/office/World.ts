import { Application, Container, Graphics, Sprite, Text, TextureStyle } from 'pixi.js';
import { ART, FOOT_OFFSET, PHASE_COLORS, TILE, WORLD_H, WORLD_W, ZOOM_STEPS, badgeFor, shirtColorFor, type Dir } from '../constants';
import type { Status, AgentPhase, Employee } from '../types';
import { useStore } from '../store/useStore';
import { generateAssets, makeCharFrames, makeLook, makeRackLeds, type Assets, type RackLed } from './AssetGenerator';
import { buildLayout, zoneName, type ChatSpot, type Layout, type RoomLabel, type Seat } from './Layout';
import { isInLounge, staysInLounge } from './Lounge';
import { Character, type Vec } from './Character';
import { monitorStateFor } from './Monitor';
import { findPath, type Tile } from './Pathfinder';

const STATUSES: Status[] = ['working', 'working', 'working', 'meeting', 'chatting', 'break', 'idle'];
/** How long one animated monitor frame stays on screen (ms). */
const MONITOR_FRAME_MS = 220;
const tileOf = (x: number, y: number): Tile => ({ tx: Math.floor(x / TILE), ty: Math.floor((y - FOOT_OFFSET) / TILE) });
const centerOf = (t: Tile): Vec => ({ x: (t.tx + 0.5) * TILE, y: (t.ty + 0.5) * TILE + FOOT_OFFSET });

export class World {
  private app = new Application();
  private root = new Container();
  private sortLayer = new Container();
  private roomLabelLayer = new Container();
  private labelLayer = new Container();
  private hands = new Graphics();
  private rackLedGraphics = new Graphics();
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
  /** Floor tiles and lounge-kind seats inside the Lounge room: the `starting` pen. */
  private loungeTiles: Tile[] = [];
  private loungeSeats: Seat[] = [];
  private cam = { x: WORLD_W / 2, y: WORLD_H / 2 + 60, zi: 1 };
  private keys = new Set<string>();
  private drag = { active: false, moved: 0, lx: 0, ly: 0 };
  private clockT = 0; private liveT = 0; private rackT = 0; private monitorT = 0;
  private cleanups: (() => void)[] = [];
  private ready = false;
  private host!: HTMLElement;

  async init(host: HTMLElement) {
    this.host = host;
    TextureStyle.defaultOptions.scaleMode = 'nearest';
    await this.app.init({ resizeTo: host, background: '#14121c', antialias: false, roundPixels: true, resolution: window.devicePixelRatio || 1, autoDensity: true });
    host.appendChild(this.app.canvas);
    this.app.canvas.style.display = 'block';

    const h = new Date().getHours();
    const emps = useStore.getState().employees;
    this.assets = generateAssets(h < 6 || h >= 18, emps.map((e, i) => makeLook(shirtColorFor(e), i)));
    // Size the workstation block to the live roster: one desk per agent.
    this.layout = buildLayout(emps.length);
    this.layout.blocked.forEach((row, ty) => row.forEach((b, tx) => { if (!b) this.walkable.push({ tx, ty }); }));
    // `starting` agents only ever get goals from these two lists, so they cannot
    // walk out of the Lounge even though the doorway at (14, 13) stays open.
    this.loungeTiles = this.walkable.filter((t) => isInLounge(t.tx, t.ty));
    this.loungeSeats = this.layout.seats.filter(
      (s) => s.kind === 'lounge' && isInLounge(s.approach.tx, s.approach.ty),
    );

    const bg = new Sprite(this.assets.background);
    bg.scale.set(ART);
    this.sortLayer.sortableChildren = true;
    this.root.addChild(bg, this.hands, this.roomLabelLayer, this.sortLayer, this.labelLayer);
    this.rackLeds = makeRackLeds();
    this.root.addChild(this.rackLedGraphics);
    this.app.stage.addChild(this.root);

    for (const f of this.layout.furniture) {
      const s = new Sprite(this.assets.furn[f.type]);
      s.anchor.set(0.5, 1); s.scale.set(ART); s.position.set(f.x, f.y); s.zIndex = f.z;
      this.sortLayer.addChild(s);
    }
    // One monitor per workstation, lit only while a working/ready agent sits there.
    this.monitors = [];
    for (const seat of this.layout.seats) {
      if (!seat.monitor) continue;
      const s = new Sprite(this.assets.monitorOff);
      s.anchor.set(0.5, 0); s.scale.set(ART);
      s.position.set(seat.monitor.x, seat.monitor.y); s.zIndex = seat.monitor.z;
      this.sortLayer.addChild(s);
      this.monitors.push({ seat, sprite: s });
    }
    this.layout.roomLabels.forEach((label) => this.roomLabelLayer.addChild(this.buildRoomLabel(label)));
    this.rebuildCharacters();    this.bindInput();
    this.updateClock();
    this.app.ticker.add((t) => this.update(t.deltaMS / 1000));
    this.ready = true;
  }

  resize() {
    if (!this.ready) return;
    this.app.renderer.resize(this.host.clientWidth, this.host.clientHeight);
    this.applyCamera();
  }

  destroy() {
    this.cleanups.forEach((f) => f());
    this.app.destroy({ removeView: true }, { children: true, texture: true });
  }

  // ---------- Input & kamera ----------
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
      } else cv.style.cursor = this.pick(e) ? 'pointer' : 'default';
    });
    on(cv, 'pointerup', (e: PointerEvent) => {
      if (this.drag.active && this.drag.moved < 5) useStore.getState().select(this.pick(e)?.id ?? null);
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
  private pick(e: PointerEvent): Character | null {
    const r = this.app.canvas.getBoundingClientRect();
    const wx = (e.clientX - r.left - this.root.x) / this.root.scale.x, wy = (e.clientY - r.top - this.root.y) / this.root.scale.y;
    return [...this.chars].sort((a, b) => b.y - a.y).find((c) => Math.abs(wx - c.x) <= 14 && wy <= c.y + 4 && wy >= c.y - 50) ?? null;
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
    const starting = staysInLounge(emp?.phase);
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
    // An agent still starting has no desk, chair or chat partner yet: it stays
    // in the Lounge (sit, stand, walk) until the phase moves on.
    if (starting) {
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
    else if (status === 'break') seat = this.freeSeat('lounge');
    else if (status === 'chatting') spot = this.freeSpot();
    if (seat) seat.occupant = ch.id;
    if (spot) spot.occupant = ch.id;
    // An agent that walked to its computer for a pending instruction is really
    // in front of the screen, so it types even while the phase stays idle.
    ch.typing = ch.typing || (owesDesk && seat?.kind === 'desk');
    if (instant) {
      if (seat) ch.sitAt(seat);
      else if (spot) ch.placeAt(centerOf(spot), spot.facing);
      else ch.placeAt(centerOf(this.walkable[Math.floor(Math.random() * this.walkable.length)]), 'down');
    } else if (seat) this.routeTo(ch, seat.approach, seat);
    else if (spot) this.routeTo(ch, spot, null, spot.facing);
    else if (owesDesk) {
      // Every desk is taken: stand at the aisle beside the agent's own computer
      // instead of wandering off with the instruction unread.
      const own = this.layout.seats.find((s) => s.id === emp?.currentWorkstation);
      if (own) this.routeTo(ch, own.approach, null, own.facing);
      else this.wander(ch);
    }
    else this.wander(ch);
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
  /**
   * `starting` agents have no desk yet, so a pending instruction must not pull
   * them out of the Lounge.
   */
  private owedDesk(emp: Employee | undefined): boolean {
    return staysInLounge(emp?.phase) ? false : this.owesDesk(emp);
  }
  /**
   * `starting` agents wait inside the Lounge: a free lounge seat, or a lounge
   * floor tile. No desk, meeting chair or chat spot, so the room is their only
   * stage until the phase leaves `starting`.
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
  /** Idle `starting` agent: stroll between lounge tiles, never out of the room. */
  private wanderLounge(ch: Character) {
    if (!this.loungeTiles.length) return;
    this.routeTo(ch, this.loungeTiles[Math.floor(Math.random() * this.loungeTiles.length)], null);
    ch.wanderTimer = 3 + Math.random() * 4;
  }
  private taskText(s: Status, ws?: string) {
    return ({ working: `Working at ${ws ?? 'desk'}`, meeting: 'Team meeting in Meeting Area', chatting: 'Chatting with colleagues', break: 'Resting in Lounge', idle: 'Wandering the office' })[s];
  }

  private update(dt: number) {
    if (!this.ready) return;
    dt = Math.min(dt, 0.1);
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
      const starting = staysInLounge(emp.phase);
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
      if (ch.appliedStatus === 'idle' && !this.instructions.get(ch.id) && ch.state === 'idle' && !ch.path.length) { ch.wanderTimer -= dt; if (ch.wanderTimer <= 0) { if (starting) this.wanderLounge(ch); else this.wander(ch); } }
      // A starting agent is alone in the Lounge: no chat or meeting bubble.
      ch.talking = !starting && (ch.appliedStatus === 'meeting' || ch.appliedStatus === 'chatting') && !ch.path.length;
      ch.update(dt);
      ch.tag.visible = st.showLabels;
      ch.setSelected(st.selectedId === ch.id);
    }
    this.clockT += dt; this.liveT += dt; this.rackT += dt; this.monitorT += dt;
    if (this.clockT >= 1) { this.clockT = 0; this.updateClock(); }
    if (this.liveT >= 0.4) {
      this.liveT = 0;
      const ch = this.chars.find((c) => c.id === st.selectedId);
      if (ch) {
        const t = tileOf(ch.x, ch.y), emp = this.empOf(ch.id)!;
        const starting = staysInLounge(emp.phase);
        st.setLive({ zone: zoneName(t.tx, t.ty), task: starting ? (ch.path.length ? 'Starting up — walking in Lounge' : 'Starting up — waiting in Lounge') : ch.path.length ? (this.instructions.get(ch.id) ? 'Walking to desk — new instruction' : 'Walking…') : this.instructions.get(ch.id) && emp.status === 'idle' ? 'At desk — reviewing new instruction' : this.taskText(emp.status, emp.currentWorkstation), x: Math.round(ch.x), y: Math.round(ch.y) });
      }
    }
    this.updateRackLeds();
    this.updateMonitors();
    this.applyCamera();
  }
  /**
   * Screen on = the agent is actually sitting at that desk (`Character.state`
   * `sit` on the same seat) and its phase is `working` or `ready`. A desk is
   * reserved for the whole walk over, so the seat occupant alone is not enough:
   * the screen must stay dark until the body has arrived. A `working` agent gets
   * the animated frames (code rows scroll); `ready` gets the still screen.
   * Everyone else, including an agent still walking to the desk, leaves the
   * monitor dark.
   */
  private updateMonitors() {
    if (!this.monitors.length) return;
    const frames = this.assets.monitorWorking;
    const frame = frames[Math.floor(this.monitorT / (MONITOR_FRAME_MS / 1000)) % frames.length];
    for (const { seat, sprite } of this.monitors) {
      const ch = seat.occupant ? this.chars.find((c) => c.id === seat.occupant) : undefined;
      const seated = !!ch && ch.state === 'sit' && ch.seat === seat;
      const state = monitorStateFor(seated && ch ? this.empOf(ch.id)?.phase : undefined, seated);
      const tex = state === 'moving' ? frame : state === 'still' ? this.assets.monitorOn : this.assets.monitorOff;
      if (sprite.texture !== tex) sprite.texture = tex;
    }
  }
  private updateRackLeds() {
    this.rackLedGraphics.clear();
    for (const led of this.rackLeds) {
      const green = Math.sin(this.rackT * 2.5 + led.phase) > 0;
      this.rackLedGraphics
        .circle(led.x, led.y, 2)
        .fill(green ? 0x5fd068 : 0xd9534f);
      this.rackLedGraphics
        .circle(led.x, led.y, 3.5)
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
}
