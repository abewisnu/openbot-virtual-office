import { Container, Graphics, Sprite, Text, type Texture } from 'pixi.js';
import { DENSITY, PROP, PROP_SCALE, CHAR_SPEED, type Dir } from '../constants';
import { CHAR_IDLE_FRAMES, CHAR_SIT_FRAMES, CHAR_WALK_FRAMES, type CharFrames } from './AssetGenerator';
import type { Seat } from './Layout';
import type { Status } from '../types';

export interface Vec { x: number; y: number }
type CState = 'idle' | 'walk' | 'sit';

/**
 * Plate offset in art px for a workstation sitter: negative, so the name hangs
 * just under the chair, snug against its bottom edge, instead of over the desk
 * bay. -10 art px puts the plate centre 20 screen px below the feet at the
 * shipped 2x prop scale, which clears the 16 art px chair sprite by ~4 px.
 */
const BELOW_CHAIR = -10;

export class Character {
  readonly container = new Container();
  readonly tag = new Container();
  private sprite = new Sprite();
  private shadow = new Graphics().ellipse(0, -2 * PROP_SCALE, 10 * PROP_SCALE, 4 * PROP_SCALE).fill({ color: 0x000000, alpha: 0.28 });
  private ring = new Graphics().ellipse(0, -2 * PROP_SCALE, 14 * PROP_SCALE, 6 * PROP_SCALE).stroke({ width: 2, color: 0xfff3a0 });
  /** Soft echo of the selection ring: pointer feedback, never a click state. */
  private hoverRing = new Graphics().ellipse(0, -2 * PROP_SCALE, 14 * PROP_SCALE, 6 * PROP_SCALE).stroke({ width: 1, color: 0xfff3a0, alpha: 0.45 });
  private dot = new Graphics();
  private bubble: Sprite;
  x = 0; y = 0; facing: Dir = 'down'; state: CState = 'idle';
  path: Vec[] = []; seat: Seat | null = null;
  private pendingSeat: Seat | null = null; private pendingFacing: Dir | null = null;
  appliedStatus: Status | null = null; changeIn = 20; wanderTimer = 3;
  talking = false; typing = false;
  private anim = 0; private frame = 0; private bubbleOn = false; private bubbleT = 1;
  /** `prefers-reduced-motion`: hold idle poses still and drop decorative bob. */
  private calm = false;
  private name: string;

  private labelText: Text;
  private pill: Graphics;
  private dotX = 0;

  constructor(readonly id: string, name: string, private frames: CharFrames, bubbleTex: Texture) {
    this.name = name;
    this.sprite.anchor.set(0.5, 1);
    this.sprite.scale.set(PROP / DENSITY);
    this.ring.visible = false;
    this.hoverRing.visible = false;
    this.container.addChild(this.shadow, this.hoverRing, this.ring, this.sprite);

    this.labelText = new Text({
      text: name,
      style: { fontFamily: 'monospace', fontSize: 12, fontWeight: 'bold', fill: 0xffffff },
      resolution: 2,
    });
    this.labelText.anchor.set(0.5);

    this.pill = new Graphics();
    this.dot.position.set(0, 0);
    this.bubble = new Sprite(bubbleTex);
    this.bubble.anchor.set(0.5, 1); this.bubble.scale.set(PROP / DENSITY); this.bubble.visible = false;
    this.bubble.position.set(0, -22);

    this.tag.addChild(this.bubble, this.pill, this.dot, this.labelText);
    this.resizePill();
  }

  private resizePill() {
    const w = this.labelText.width + 20;
    const half = w / 2;
    const dotX = -half + 9;
    this.pill.clear().roundRect(-half, -10, w, 19, 5).fill({ color: 0x000000, alpha: 0.62 });
    this.labelText.position.set(5, 0);
    this.dotX = dotX;
    this.dot.position.set(dotX, 0);
  }

  setDot(color: string) {
    this.dot.clear().circle(0, 0, 4).fill({ color });
  }

  /** Update the name shown on the tag. Resizes the pill to fit the new text. */
  setName(name: string) {
    if (this.name !== name) {
      this.name = name;
      this.labelText.text = name;
      this.resizePill();
    }
  }
  setSelected(v: boolean) { this.ring.visible = v; }
  /** Pointer feedback only; the selection ring still owns the click state. */
  setHovered(v: boolean) { this.hoverRing.visible = v && !this.ring.visible; }
  /**
   * `prefers-reduced-motion`: keeps the walk cycle (it carries real movement)
   * but freezes idle, typing and the decorative pulse/bob, so nothing on screen
   * animates for its own sake.
   */
  setCalm(v: boolean) { this.calm = v; }
  placeAt(p: Vec, facing: Dir) { this.x = p.x; this.y = p.y; this.facing = facing; this.state = 'idle'; this.path = []; this.seat = null; this.wanderTimer = 2 + Math.random() * 4; }
  sitAt(seat: Seat) { this.x = seat.pos.x; this.y = seat.pos.y; this.seat = seat; this.state = 'sit'; this.facing = seat.facing; this.path = []; }
  walkTo(pts: Vec[], seat: Seat | null, facing?: Dir) {
    this.path = pts; this.pendingSeat = seat; this.pendingFacing = facing ?? null; this.seat = null; this.state = 'walk';
  }
  private arrive() {
    if (this.pendingSeat) { this.seat = this.pendingSeat; this.state = 'sit'; this.facing = this.seat.facing; }
    else { this.state = 'idle'; if (this.pendingFacing) this.facing = this.pendingFacing; }
    this.pendingSeat = null; this.wanderTimer = 3 + Math.random() * 5;
  }
  update(dt: number) {
    this.anim += dt;
    if (this.path.length) {
      const t = this.path[0];
      const dx = t.x - this.x, dy = t.y - this.y, d = Math.hypot(dx, dy), step = CHAR_SPEED * dt;
      if (d > 0.01) this.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
      if (d <= step) { this.x = t.x; this.y = t.y; this.path.shift(); if (!this.path.length) this.arrive(); }
      else { this.x += (dx / d) * step; this.y += (dy / d) * step; }
      this.frame = Math.floor(this.anim / 0.11) % CHAR_WALK_FRAMES;
    } else if (this.state === 'sit') this.frame = this.typing && !this.calm ? Math.floor(this.anim / 0.22) % CHAR_SIT_FRAMES : 0;
    else this.frame = this.calm ? 0 : Math.floor(this.anim / 0.32) % CHAR_IDLE_FRAMES;
    // A breathing selection ring reads as "alive and picked" without needing a
    // second colour next to the status dot.
    if (this.ring.visible) this.ring.alpha = this.calm ? 1 : 0.72 + Math.sin(this.anim * 4) * 0.28;
    // bubble talk
    if (this.talking) {
      this.bubbleT -= dt;
      if (this.bubbleT <= 0) { this.bubbleOn = !this.bubbleOn; this.bubbleT = this.bubbleOn ? 1.6 : 1.5 + Math.random() * 3; }
    } else this.bubbleOn = false;
    this.refresh();
  }
  /**
   * Distance from the agent's feet to the name plate, in art pixels. Negative
   * means the plate sits *below* the feet.
   *
   * An agent seated at a workstation with status `working` (or `ready`, since
   * both phases map to `working` in `statusForPhase()`) carries the plate under
   * its chair: over the head it covers the monitor, the desk bay and the seated
   * sprite, and the request is specifically for the name to read under the
   * chair. Every other pose keeps the plate above the agent — social seats at
   * the normal seated height, standing and walking higher still.
   */
  private tagLift(): number {
    const seated = this.state === 'sit' && !!this.seat;
    if (seated && this.seat!.kind === 'desk' && this.appliedStatus === 'working') return BELOW_CHAIR;
    return seated ? 52 : 64;
  }
  private refresh() {
    const f = this.frames;
    let tex: Texture;
    if (this.state === 'sit' && this.seat) tex = this.seat.facing === 'up' ? f.sit.up[this.frame] : f.sit.down[this.frame];
    else tex = this.state === 'walk' ? f.walk[this.facing][this.frame] : f.idle[this.facing][this.frame];
    this.sprite.texture = tex;
    this.sprite.scale.set(PROP / DENSITY);
    const sitting = this.state === 'sit' && !!this.seat;
    this.container.position.set(Math.round(this.x), Math.round(this.y));
    this.container.zIndex = this.y + (sitting ? this.seat!.zOffset : 0);
    this.shadow.visible = !sitting;
    const lift = this.tagLift();
    this.tag.position.set(Math.round(this.x), Math.round(this.y - lift * PROP_SCALE));
    this.bubble.visible = this.bubbleOn;
    // The speech bubble rides on the plate. Under a workstation chair the plate
    // drops a whole tile, so the bubble cancels that drop and keeps its usual
    // clearance over the agent's head instead of landing on the chair.
    const bubbleBase = lift < 0 ? (lift - 74) * PROP_SCALE : -10 * PROP_SCALE;
    this.bubble.y = bubbleBase + (this.calm ? 0 : Math.sin(this.anim * 6) * 1.5);
  }
}
