import { Container, Graphics, Sprite, Text, type Texture } from 'pixi.js';
import { PROP, PROP_SCALE, CHAR_SPEED, type Dir } from '../constants';
import type { CharFrames } from './AssetGenerator';
import type { Seat } from './Layout';
import type { Status } from '../types';

export interface Vec { x: number; y: number }
type CState = 'idle' | 'walk' | 'sit';

export class Character {
  readonly container = new Container();
  readonly tag = new Container();
  private sprite = new Sprite();
  private shadow = new Graphics().ellipse(0, -2 * PROP_SCALE, 10 * PROP_SCALE, 4 * PROP_SCALE).fill({ color: 0x000000, alpha: 0.28 });
  private ring = new Graphics().ellipse(0, -2 * PROP_SCALE, 14 * PROP_SCALE, 6 * PROP_SCALE).stroke({ width: 2, color: 0xfff3a0 });
  private dot = new Graphics();
  private bubble: Sprite;
  x = 0; y = 0; facing: Dir = 'down'; state: CState = 'idle';
  path: Vec[] = []; seat: Seat | null = null;
  private pendingSeat: Seat | null = null; private pendingFacing: Dir | null = null;
  appliedStatus: Status | null = null; changeIn = 20; wanderTimer = 3;
  talking = false; typing = false;
  private anim = 0; private frame = 0; private bubbleOn = false; private bubbleT = 1;
  private name: string;

  private labelText: Text;
  private pill: Graphics;
  private dotX = 0;

  constructor(readonly id: string, name: string, private frames: CharFrames, bubbleTex: Texture) {
    this.name = name;
    this.sprite.anchor.set(0.5, 1);
    this.sprite.scale.set(PROP);
    this.ring.visible = false;
    this.container.addChild(this.shadow, this.ring, this.sprite);

    this.labelText = new Text({
      text: name,
      style: { fontFamily: 'monospace', fontSize: 10, fontWeight: 'bold', fill: 0xffffff },
      resolution: 2,
    });
    this.labelText.anchor.set(0.5);

    this.pill = new Graphics();
    this.dot.position.set(0, 0);
    this.bubble = new Sprite(bubbleTex);
    this.bubble.anchor.set(0.5, 1); this.bubble.scale.set(PROP); this.bubble.visible = false;
    this.bubble.position.set(0, -10);

    this.tag.addChild(this.bubble, this.pill, this.dot, this.labelText);
    this.resizePill();
  }

  private resizePill() {
    const w = this.labelText.width + 16;
    const half = w / 2;
    const dotX = -half + 7;
    this.pill.clear().roundRect(-half, -8, w, 15, 4).fill({ color: 0x000000, alpha: 0.62 });
    this.labelText.position.set(4, 0);
    this.dotX = dotX;
    this.dot.position.set(dotX, 0);
  }

  setDot(color: string) {
    this.dot.clear().circle(0, 0, 3).fill({ color });
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
      this.frame = Math.floor(this.anim / 0.16) % 2;
    } else if (this.state === 'sit') this.frame = this.typing ? Math.floor(this.anim / 0.28) % 2 : 0;
    // bubble talk
    if (this.talking) {
      this.bubbleT -= dt;
      if (this.bubbleT <= 0) { this.bubbleOn = !this.bubbleOn; this.bubbleT = this.bubbleOn ? 1.6 : 1.5 + Math.random() * 3; }
    } else this.bubbleOn = false;
    this.refresh();
  }
  private refresh() {
    const f = this.frames;
    let tex: Texture, flip = false;
    const d = this.facing === 'right' ? 'left' : this.facing;
    if (this.state === 'sit' && this.seat) tex = this.seat.facing === 'up' ? f.sit.up[this.frame] : f.sit.down[this.frame];
    else { flip = this.facing === 'right'; tex = this.state === 'walk' ? f.walk[d][this.frame] : f.idle[d]; }
    this.sprite.texture = tex;
    this.sprite.scale.set(flip ? -PROP : PROP, PROP);
    const sitting = this.state === 'sit' && !!this.seat;
    this.container.position.set(Math.round(this.x), Math.round(this.y));
    this.container.zIndex = this.y + (sitting ? this.seat!.zOffset : 0);
    this.shadow.visible = !sitting;
    this.tag.position.set(Math.round(this.x), Math.round(this.y - (sitting ? 52 : 60) * PROP_SCALE));
    this.bubble.visible = this.bubbleOn;
    this.bubble.y = -10 * PROP_SCALE + Math.sin(this.anim * 6) * 1.5;
  }
}
