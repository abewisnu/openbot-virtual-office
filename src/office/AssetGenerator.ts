/**
 * All pixel art is generated here programmatically (Canvas 2D -> Texture).
 * Image unit = "pixel art"; sprites are scaled 2x on screen with nearest filter.
 */
import { Texture } from 'pixi.js';
import { COLS, ROWS, TILE } from '../constants';

const OL = '#1d1722';
// Semi-transparent glass partitions: pane tint keeps floor visible through the texture.
const GLASS_TINT = 'rgba(150,214,224,0.34)';
const GLASS_SHEEN = 'rgba(226,252,255,0.46)';
const GLASS_SPARK = 'rgba(255,255,255,0.62)';
const FRAME_DARK = 'rgba(52,55,70,0.92)';
const FRAME_EDGE = 'rgba(122,132,151,0.85)';
const FRAME_LIGHT = 'rgba(84,90,110,0.95)';
type Ctx = CanvasRenderingContext2D;
export type FurnitureType =
  | 'desk' | 'chairUp' | 'chairDown' | 'sofa3Down' | 'sofa2Up' | 'coffeeTable' | 'plant' | 'whiteboard'
  | 'meetingTable' | 'bookshelf' | 'cabinet' | 'fridge' | 'dispenser' | 'storageTable' | 'filing'
  | 'serverRack'
  | 'partitionH' | 'partitionV' | 'partitionHHalf' | 'partitionCorner' | 'doorH' | 'doorV';
export interface Look { skin: string; hair: string; shirt: string; pants: string }
type D3 = 'up' | 'down' | 'left';
export interface CharFrames {
  idle: Record<D3, Texture>;
  walk: Record<D3, [Texture, Texture]>;
  sit: { up: [Texture, Texture]; down: [Texture, Texture] };
}
export interface Assets {
  background: Texture;
  furn: Record<FurnitureType, Texture>;
  bubble: Texture;
  /** Workstation monitor screen, lit and still: a `ready` agent sits there. */
  monitorOn: Texture;
  /** Workstation monitor screens, animated: a `working` agent sits there. */
  monitorWorking: Texture[];
  /** Workstation monitor screen, grey with pause bars: a `blocked` agent waits there. */
  monitorWaiting: Texture;
  /** Workstation monitor screen, dark: no working/ready/blocked agent at that desk. */
  monitorOff: Texture;
  chars: CharFrames[];
}

const R = (c: Ctx, col: string, x: number, y: number, w: number, h: number) => { c.fillStyle = col; c.fillRect(x, y, w, h); };
const B = (c: Ctx, x: number, y: number, w: number, h: number, col: string) => { R(c, OL, x, y, w, h); R(c, col, x + 1, y + 1, w - 2, h - 2); };
const rng = (seed: number) => () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
function make(w: number, h: number, draw: (c: Ctx) => void): Texture {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const c = cv.getContext('2d')!;
  c.imageSmoothingEnabled = false;
  draw(c);
  return Texture.from(cv);
}

// ---------- Background: wooden floor, walls, window + skyline, clock, rugs, light ----------
const F = { a: '#b07a4a', b: '#a56f42', c: '#bb8556', line: '#8c5d36' };
function windowPane(c: Ctx, x: number, y: number, w: number, h: number, night: boolean, rnd: () => number) {
  B(c, x, y, w, h, '#5a5f73');
  const gx = x + 3, gy = y + 3, gw = w - 6, gh = h - 6;
  const sky = night ? ['#10142f', '#161b40', '#1d2350', '#262d63', '#303874', '#3a4385']
    : ['#5aa9e0', '#6db5e6', '#82c1ea', '#9acdee', '#b3d9f1', '#cbe5f4'];
  sky.forEach((col, i) => R(c, col, gx, gy + Math.floor((gh / sky.length) * i), gw, Math.ceil(gh / sky.length)));
  if (night) for (let i = 0; i < 22; i++) R(c, '#dfe6ff', gx + Math.floor(rnd() * gw), gy + Math.floor(rnd() * gh * 0.5), 1, 1);
  else for (let i = 0; i < 3; i++) { const cx = gx + Math.floor(rnd() * (gw - 24)), cy = gy + 4 + Math.floor(rnd() * 12); R(c, '#fff', cx, cy, 16, 3); R(c, '#fff', cx + 4, cy - 2, 8, 2); }
  let bx = gx;
  while (bx < gx + gw) {
    const bw = Math.min(6 + Math.floor(rnd() * 12), gx + gw - bx), bh = 10 + Math.floor(rnd() * 30);
    const col = night ? ['#141830', '#1a1f3d', '#202647'][Math.floor(rnd() * 3)] : ['#6f8aa6', '#7d97b0', '#8aa3ba'][Math.floor(rnd() * 3)];
    R(c, col, bx, gy + gh - bh, bw, bh);
    for (let yy = gy + gh - bh + 2; yy < gy + gh - 2; yy += 4)
      for (let xx = bx + 1; xx < bx + bw - 1; xx += 3)
        if (rnd() < 0.35) R(c, night ? '#ffd76a' : '#bcd4ea', xx, yy, 1, 2);
    bx += bw;
  }
  for (let i = 1; i < 4; i++) R(c, '#5a5f73', gx + Math.round((gw * i) / 4), gy, 2, gh);
  R(c, 'rgba(255,255,255,0.07)', gx + 6, gy, 10, gh); R(c, 'rgba(255,255,255,0.05)', gx + 22, gy, 4, gh);
  B(c, x - 2, y + h, w + 4, 3, '#6b6f85');
}
function rug(c: Ctx, tx: number, ty: number, tw: number, th: number, main: string, accent: string) {
  const x = tx * 16, y = ty * 16, w = tw * 16, h = th * 16;
  B(c, x, y, w, h, accent); R(c, main, x + 3, y + 3, w - 6, h - 6);
  for (let i = 0; i < w - 12; i += 8) for (let j = 0; j < h - 12; j += 8) if (((i + j) / 8) % 2 === 0) R(c, accent, x + 6 + i, y + 6 + j, 4, 4);
}
function makeBackground(night: boolean): Texture {
  const W = COLS * 16, H = ROWS * 16;
  return make(W, H, (c) => {
    const rnd = rng(7);
    R(c, '#14121c', 0, 0, W, H);
    for (let ty = 5; ty < ROWS; ty++) for (let tx = 0; tx < COLS; tx++) {
      const x = tx * 16, y = ty * 16;
      R(c, [F.a, F.b, F.c][Math.floor(rnd() * 3)], x, y, 16, 16);
      R(c, F.line, x, y + 15, 16, 1);
      for (let p = 0; p < 16; p++) if ((tx * 16 + p + ty * 19) % 48 === 0) R(c, F.line, x + p, y, 1, 15);
      if (rnd() < 0.25) R(c, '#c9945f', x + Math.floor(rnd() * 13), y + Math.floor(rnd() * 13), 2, 1);
    }
    // walls
    R(c, '#3a3d4a', 0, 0, W, 80);
    for (let x = 0; x < W; x += 32) R(c, '#343746', x, 0, 1, 72);
    R(c, '#2b2d38', 0, 72, W, 8); R(c, '#4b4f5f', 0, 72, W, 1); R(c, OL, 0, 79, W, 1);
    for (const wx of [16, 336, 656]) windowPane(c, wx, 6, 288, 56, night, rnd);
    // wall clock (hands drawn at runtime)
    R(c, OL, 313, 24, 14, 12); R(c, OL, 314, 23, 12, 14); R(c, '#f2ede0', 315, 25, 10, 10); R(c, '#f2ede0', 314, 26, 12, 8);
    R(c, OL, 319, 25, 2, 1); R(c, OL, 319, 34, 2, 1); R(c, OL, 315, 29, 1, 2); R(c, OL, 324, 29, 1, 2);
    // rugs
    rug(c, 2, 8, 8, 5, '#3f7f8c', '#2b5560');
    rug(c, 22, 10, 6, 5, '#6a5a78', '#473c55');
    rug(c, 3, 35, 8, 4, '#7a8a5a', '#4e5a38');
    // wall shadow + window light rays
    R(c, 'rgba(0,0,0,0.25)', 0, 80, W, 2); R(c, 'rgba(0,0,0,0.12)', 0, 82, W, 3);
    c.fillStyle = night ? 'rgba(120,150,255,0.07)' : 'rgba(255,240,200,0.09)';
    for (const wx of [16, 336, 656]) {
      c.beginPath(); c.moveTo(wx + 20, 80); c.lineTo(wx + 268, 80); c.lineTo(wx + 330, 200); c.lineTo(wx + 82, 200); c.closePath(); c.fill();
    }
  });
}

// ---------- Furniture ----------
function sofa(w: number, up: boolean, dark: string, light: string, hi: string): Texture {
  return make(w, 26, (c) => {
    const n = w > 40 ? 3 : 2, step = (w - 8) / n;
    if (!up) {
      B(c, 0, 0, w, 13, dark); R(c, hi, 2, 1, w - 4, 1);
      B(c, 4, 9, w - 8, 13, light);
      for (let i = 1; i < n; i++) R(c, dark, 4 + Math.round(step * i), 10, 1, 11);
      B(c, 0, 6, 6, 17, dark); B(c, w - 6, 6, 6, 17, dark);
      R(c, OL, 2, 23, 3, 3); R(c, OL, w - 5, 23, 3, 3);
    } else {
      B(c, 0, 2, 6, 18, dark); B(c, w - 6, 2, 6, 18, dark);
      B(c, 4, 2, w - 8, 14, light);
      for (let i = 1; i < n; i++) R(c, dark, 4 + Math.round(step * i), 3, 1, 12);
      B(c, 0, 13, w, 13, dark); R(c, hi, 2, 14, w - 4, 1);
    }
  });
}
function makeFurniture(): Record<FurnitureType, Texture> {
  const rnd = rng(21);
  return {
    desk: make(32, 28, (c) => {
      B(c, 0, 12, 32, 9, '#a8744a'); R(c, '#c18c5e', 1, 13, 30, 1);
      R(c, '#2b2f3a', 10, 15, 10, 3); R(c, '#555a6b', 11, 16, 8, 1); R(c, '#2b2f3a', 23, 15, 3, 3); R(c, '#e8e0d0', 3, 14, 3, 4);
      B(c, 0, 20, 32, 8, '#6b4429'); R(c, '#8a5a34', 2, 22, 12, 4); R(c, OL, 7, 23, 2, 1);
    }),
    chairUp: make(16, 16, (c) => {
      B(c, 2, 0, 12, 9, '#4b5178'); B(c, 3, 8, 10, 5, '#3a3f5c'); R(c, OL, 6, 13, 4, 2); R(c, OL, 3, 15, 4, 1); R(c, OL, 9, 15, 4, 1);
    }),
    chairDown: make(16, 16, (c) => {
      B(c, 3, 0, 10, 5, '#3a3f5c'); B(c, 2, 4, 12, 9, '#4b5178'); R(c, OL, 6, 13, 4, 2); R(c, OL, 3, 15, 4, 1); R(c, OL, 9, 15, 4, 1);
    }),
    sofa3Down: sofa(48, false, '#2f6670', '#3f8795', '#57a5b3'),
    sofa2Up: sofa(32, true, '#7a4455', '#9c5a6e', '#b87388'),
    coffeeTable: make(32, 16, (c) => {
      B(c, 1, 3, 30, 9, '#a8744a'); R(c, '#c18c5e', 2, 4, 28, 1);
      B(c, 3, 11, 3, 5, '#6b4429'); B(c, 26, 11, 3, 5, '#6b4429'); R(c, '#e8e0d0', 20, 5, 3, 3); R(c, '#c05a4a', 6, 5, 7, 4);
    }),
    plant: make(16, 28, (c) => {
      B(c, 4, 18, 8, 10, '#b5653d'); R(c, '#d98355', 5, 19, 6, 2); R(c, '#2f7a45', 7, 10, 2, 9);
      for (const [x, y, w, h] of [[1, 8, 6, 4], [9, 8, 6, 4], [4, 2, 8, 6], [2, 13, 5, 3], [9, 13, 5, 3]]) { B(c, x, y, w, h, '#3f9a55'); R(c, '#6fd083', x + 1, y + 1, 2, 1); }
    }),
    whiteboard: make(48, 40, (c) => {
      B(c, 0, 0, 48, 28, '#e9edf2'); R(c, '#d9534f', 4, 5, 20, 1); R(c, '#4f86c6', 4, 9, 30, 1); R(c, '#4f86c6', 4, 12, 24, 1);
      R(c, '#5aa469', 28, 15, 14, 6); R(c, '#e9edf2', 29, 16, 12, 4); R(c, '#2b2f3a', 4, 17, 16, 1); R(c, '#8c8f99', 6, 25, 12, 1);
      B(c, 6, 28, 3, 12, '#555a6b'); B(c, 39, 28, 3, 12, '#555a6b');
    }),
    meetingTable: make(64, 36, (c) => {
      B(c, 0, 2, 64, 27, '#a8744a'); R(c, '#c18c5e', 2, 3, 60, 1);
      B(c, 2, 28, 60, 6, '#6b4429'); B(c, 4, 33, 4, 3, '#6b4429'); B(c, 56, 33, 4, 3, '#6b4429');
      B(c, 10, 8, 10, 6, '#2b2f3a'); R(c, '#4aa3d8', 11, 9, 8, 3); B(c, 44, 8, 10, 6, '#2b2f3a'); R(c, '#4aa3d8', 45, 9, 8, 3);
      R(c, '#e9edf2', 28, 12, 8, 6); R(c, '#e8e0d0', 24, 18, 3, 3); R(c, '#e8e0d0', 40, 19, 3, 3);
    }),
    bookshelf: make(32, 44, (c) => {
      B(c, 0, 0, 32, 44, '#6b4429');
      const cols = ['#c05a4a', '#4f86c6', '#d9a441', '#5aa469', '#8a6fc6', '#e8e0d0'];
      for (let i = 0; i < 3; i++) {
        R(c, '#2b1d14', 2, 2 + i * 14, 28, 12);
        for (let x = 3; x < 28;) { const bw = 2 + Math.floor(rnd() * 3), bh = 7 + Math.floor(rnd() * 4); R(c, cols[Math.floor(rnd() * cols.length)], x, 14 + i * 14 - bh, bw, bh); x += bw + 1; }
        R(c, '#8a5a34', 2, 13 + i * 14, 28, 2);
      }
    }),
    cabinet: make(16, 36, (c) => {
      B(c, 0, 0, 16, 36, '#6c7284'); R(c, '#8a91a6', 2, 2, 12, 14); R(c, '#8a91a6', 2, 19, 12, 14); R(c, OL, 6, 15, 4, 1); R(c, OL, 6, 32, 4, 1);
    }),
    fridge: make(16, 38, (c) => {
      B(c, 0, 0, 16, 38, '#cfd6e0'); R(c, OL, 1, 14, 14, 1); R(c, '#777e8f', 12, 5, 2, 6); R(c, '#777e8f', 12, 18, 2, 8); R(c, '#d9534f', 4, 4, 3, 3);
    }),
    dispenser: make(16, 30, (c) => {
      B(c, 3, 0, 10, 12, '#7ec8f0'); R(c, '#bfe6fa', 4, 1, 3, 8); B(c, 2, 12, 12, 18, '#dfe5ee');
      R(c, '#3b82c4', 5, 18, 2, 2); R(c, '#d9534f', 9, 18, 2, 2); R(c, '#555a6b', 4, 25, 8, 2);
    }),
    storageTable: make(48, 22, (c) => {
      B(c, 5, 0, 13, 8, '#555a6b'); R(c, '#9ad6f5', 7, 2, 7, 4); B(c, 30, 0, 8, 8, '#2b2f3a'); R(c, '#d9534f', 32, 2, 2, 2);
      B(c, 0, 4, 48, 8, '#a8744a'); B(c, 1, 12, 46, 10, '#6b4429'); R(c, '#8a5a34', 3, 14, 20, 6); R(c, '#8a5a34', 25, 14, 20, 6);
    }),
    filing: make(16, 22, (c) => {
      B(c, 0, 0, 16, 22, '#6c7284');
      for (let i = 0; i < 3; i++) { R(c, '#8a91a6', 2, 2 + i * 7, 12, 5); R(c, OL, 6, 4 + i * 7, 4, 1); }
    }),
    serverRack: make(16, 48, (c) => {
      B(c, 0, 0, 16, 48, '#2b2f3a');
      R(c, '#343746', 1, 1, 14, 46);
      for (let i = 0; i < 5; i++) {
        const y = 2 + i * 9;
        B(c, 2, y, 12, 8, '#1d1722');
        R(c, '#252838', 3, y + 1, 10, 6);
        R(c, '#4aa3d8', 3, y + 2, 3, 1);
        R(c, '#4aa3d8', 3, y + 4, 5, 1);
        R(c, '#555a6b', 3, y + 6, 8, 1);
        R(c, '#555a6b', 12, y + 2, 1, 1);
      }
      R(c, OL, 1, 1, 14, 1);
      R(c, OL, 1, 46, 14, 1);
    }),
    partitionH: make(16, 8, (c) => {
      R(c, GLASS_TINT, 0, 1, 16, 6);
      R(c, GLASS_SHEEN, 1, 2, 6, 1);
      R(c, GLASS_SHEEN, 10, 3, 4, 1);
      R(c, GLASS_SPARK, 8, 2, 1, 4);
      R(c, FRAME_DARK, 0, 0, 16, 1);
      R(c, FRAME_EDGE, 0, 1, 1, 6); R(c, FRAME_EDGE, 15, 1, 1, 6);
      R(c, FRAME_LIGHT, 0, 7, 16, 1);
    }),
    partitionV: make(8, 16, (c) => {
      R(c, GLASS_TINT, 1, 0, 6, 16);
      R(c, GLASS_SHEEN, 2, 1, 1, 7);
      R(c, GLASS_SHEEN, 5, 9, 1, 5);
      R(c, GLASS_SPARK, 4, 3, 1, 4);
      R(c, FRAME_DARK, 0, 0, 1, 16);
      R(c, FRAME_EDGE, 1, 0, 6, 1); R(c, FRAME_EDGE, 1, 15, 6, 1);
      R(c, FRAME_LIGHT, 7, 0, 1, 16);
    }),
    partitionHHalf: make(8, 8, (c) => {
      R(c, GLASS_TINT, 0, 1, 8, 6);
      R(c, GLASS_SHEEN, 1, 2, 4, 1);
      R(c, GLASS_SPARK, 4, 2, 1, 4);
      R(c, FRAME_DARK, 0, 0, 8, 1);
      R(c, FRAME_EDGE, 0, 1, 1, 6); R(c, FRAME_EDGE, 7, 1, 1, 6);
      R(c, FRAME_LIGHT, 0, 7, 8, 1);
    }),
    partitionCorner: make(8, 8, (c) => {
      R(c, GLASS_TINT, 1, 1, 6, 6);
      R(c, GLASS_SHEEN, 2, 2, 1, 4);
      R(c, GLASS_SPARK, 3, 3, 1, 2);
      R(c, FRAME_DARK, 0, 0, 8, 1); R(c, FRAME_DARK, 0, 0, 1, 8);
      R(c, FRAME_EDGE, 1, 1, 6, 1); R(c, FRAME_EDGE, 1, 1, 1, 6);
      R(c, FRAME_LIGHT, 0, 7, 8, 1); R(c, FRAME_LIGHT, 7, 0, 1, 8);
    }),
    doorH: make(16, 8, (c) => {
      R(c, '#343746', 0, 0, 16, 8);
      R(c, '#d7aa5d', 1, 1, 14, 6);
      R(c, '#355d67', 2, 2, 12, 4);
      R(c, 'rgba(230,255,255,0.38)', 3, 2, 5, 2);
      R(c, '#e8c67a', 11, 3, 1, 2);
      R(c, '#a98b54', 0, 0, 16, 1);
    }),
    doorV: make(8, 16, (c) => {
      R(c, '#343746', 0, 0, 8, 16);
      R(c, '#d7aa5d', 1, 1, 6, 14);
      R(c, '#355d67', 2, 2, 4, 12);
      R(c, 'rgba(230,255,255,0.38)', 2, 3, 2, 5);
      R(c, '#e8c67a', 3, 11, 2, 1);
      R(c, '#a98b54', 0, 0, 1, 16);
    }),
  };
}

// ---------- Characters ----------
const SKINS = ['#f1c6a0', '#d9a273', '#a8744a', '#f4d2b0', '#8c5a3a'];
const HAIRS = ['#2b1d14', '#4a2f1c', '#1a1a24', '#7a4a24', '#c9a24a', '#3a2a4a'];
const PANTS = ['#2b3350', '#3a3a44', '#4a3a2a'];
export const makeLook = (shirt: string, i: number): Look => ({ skin: SKINS[i % SKINS.length], hair: HAIRS[(i * 2 + 1) % HAIRS.length], shirt, pants: PANTS[i % PANTS.length] });

function drawChar(c: Ctx, L: Look, dir: D3, pose: number, sit: boolean) {
  const y0 = sit ? 4 : 0;
  const leg = (x: number) => { R(c, OL, x, 17, 4, 7); R(c, L.pants, x + 1, 17, 2, 5); R(c, '#2a2230', x + 1, 22, 2, 1); };
  if (!sit) {
    const lift = (x: number, up: boolean) => { if (up) { R(c, OL, x, 17, 4, 6); R(c, L.pants, x + 1, 17, 2, 4); R(c, '#2a2230', x + 1, 21, 2, 1); } else leg(x); };
    if (dir === 'left') { if (pose === 1) { leg(3); leg(9); } else if (pose === 2) { leg(6); leg(7); } else { leg(5); leg(8); } }
    else { lift(4, pose === 1); lift(9, pose === 2); }
  }
  const th = sit ? 8 : 9;
  B(c, 3, 9 + y0, 10, th, L.shirt);
  if (sit) { R(c, OL, 3, 21, 10, 3); R(c, L.pants, 4, 21, 8, 2); }
  // lengan
  if (dir === 'left') { const ax = pose === 1 ? 4 : pose === 2 ? 8 : 6; B(c, ax, 10 + y0, 4, 7, L.shirt); R(c, L.skin, ax + 1, 15 + y0, 2, 1); }
  else if (sit && dir === 'up') { B(c, 1, 12, 3, 6 - (pose % 2), L.shirt); B(c, 12, 12, 3, 6 - ((pose + 1) % 2), L.shirt); }
  else { const sw = pose === 1 ? 1 : pose === 2 ? -1 : 0; B(c, 1, 10 + y0 + sw, 3, 7, L.shirt); B(c, 12, 10 + y0 - sw, 3, 7, L.shirt); R(c, L.skin, 2, 16 + y0 + sw, 1, 1); R(c, L.skin, 13, 16 + y0 - sw, 1, 1); }
  // kepala
  B(c, 3, y0, 10, 9, L.skin);
  if (dir === 'down') { R(c, L.hair, 4, 1 + y0, 8, 3); R(c, L.hair, 4, 4 + y0, 1, 2); R(c, L.hair, 11, 4 + y0, 1, 2); R(c, OL, 5, 5 + y0, 1, 2); R(c, OL, 10, 5 + y0, 1, 2); R(c, '#b0605a', 7, 7 + y0, 2, 1); }
  else if (dir === 'up') R(c, L.hair, 4, 1 + y0, 8, 7);
  else { R(c, L.hair, 4, 1 + y0, 8, 3); R(c, L.hair, 8, 3 + y0, 4, 5); R(c, OL, 5, 5 + y0, 1, 2); }
}
export function makeCharFrames(L: Look): CharFrames {
  const mk = (d: D3, p: number, s = false) => make(16, 24, (c) => drawChar(c, L, d, p, s));
  const dirs: D3[] = ['up', 'down', 'left'];
  const idle = {} as CharFrames['idle'], walk = {} as CharFrames['walk'];
  for (const d of dirs) { idle[d] = mk(d, 0); walk[d] = [mk(d, 1), mk(d, 2)]; }
  return { idle, walk, sit: { up: [mk('up', 0, true), mk('up', 1, true)], down: [mk('down', 0, true), mk('down', 0, true)] } };
}
function makeBubble(): Texture {
  return make(14, 11, (c) => {
    B(c, 0, 0, 14, 9, '#ffffff'); R(c, OL, 3, 9, 3, 2); R(c, '#ffffff', 4, 9, 1, 1);
    R(c, OL, 3, 4, 2, 2); R(c, OL, 6, 4, 2, 2); R(c, OL, 9, 4, 2, 2);
  });
}

/** Frames of the working screen; the code rows scroll one pixel per frame. */
export const MONITOR_WORK_FRAMES = 4;

/**
 * Workstation monitor drawn separately from the desk so the screen can go dark
 * when nobody is working or ready at that computer. 16x14 art px, anchor top-center.
 * `mode` picks the screen: `off` dark, `still` lit (`ready`), `moving` scrolling
 * code (`working`), `waiting` grey with pause bars (`blocked`).
 */
function makeMonitor(mode: 'off' | 'still' | 'moving' | 'waiting', frame = 0): Texture {
  return make(16, 14, (c) => {
    B(c, 1, 0, 14, 12, '#2b2f3a');
    if (mode === 'off') {
      R(c, '#1b1f27', 2, 1, 12, 9);
      R(c, '#2a3040', 4, 2, 5, 1); R(c, '#242a36', 8, 4, 4, 1);
    } else if (mode === 'waiting') {
      R(c, '#6f7887', 2, 1, 12, 9);
      for (let y = 3; y < 10; y += 2) R(c, '#808a99', 2, y, 12, 1);
      R(c, '#3c434f', 5, 4, 2, 3); R(c, '#3c434f', 9, 4, 2, 3);
    } else if (mode === 'still') {
      R(c, '#4aa3d8', 2, 1, 12, 9);
      for (let y = 2; y < 10; y += 2) R(c, '#6fc0e8', 2, y, 12, 1);
      R(c, '#9ad6f5', 3, 2, 6, 1); R(c, '#e8f4ff', 3, 6, 4, 1);
    } else {
      R(c, '#3f93c9', 2, 1, 12, 9);
      R(c, '#6fc0e8', 2, 1, 12, 1);
      const rows = [2, 4, 6, 8];
      const widths = [9, 6, 7, 4];
      for (let i = 0; i < rows.length; i++) {
        const k = (i + frame) % rows.length;
        R(c, i % 2 ? '#1f5d8c' : '#2a6a9c', 3, rows[k], widths[(i + frame) % widths.length], 1);
      }
      R(c, '#e8f4ff', 3 + (frame % 3) * 3, 9, 2, 1);
    }
    R(c, OL, 6, 12, 4, 2);
  });
}

export function generateAssets(night: boolean, looks: Look[]): Assets {
  return {
    background: makeBackground(night),
    furn: makeFurniture(),
    bubble: makeBubble(),
    monitorOn: makeMonitor('still'),
    monitorWorking: Array.from({ length: MONITOR_WORK_FRAMES }, (_, f) => makeMonitor('moving', f)),
    monitorWaiting: makeMonitor('waiting'),
    monitorOff: makeMonitor('off'),
    chars: looks.map(makeCharFrames),
  };
}

export interface RackLed { x: number; y: number; phase: number; }
export function makeRackLeds(): RackLed[] {
  const cols = [2, 4, 6, 8, 10, 12];
  const rows = [20, 24, 28];
  const leds: RackLed[] = [];
  let idx = 0;
  for (const ty of rows) {
    for (const tx of cols) {
      const x = (tx + 0.5) * TILE;
      const spriteTop = (ty + 1) * TILE - 48;
      for (let j = 0; j < 5; j++) {
        const y = spriteTop + 2 + j * 9;
        leds.push({ x, y, phase: idx * 0.5 + j * 0.3 });
      }
      idx++;
    }
  }
  return leds;
}
