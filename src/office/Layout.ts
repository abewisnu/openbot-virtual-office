import { ART, COLS, ROWS, TILE, MIN_WALK_ROW, type Dir } from "../constants";
import type { FurnitureType } from "./AssetGenerator";

export interface FurnitureDef {
  type: FurnitureType;
  x: number;
  y: number;
  z: number;
}
export interface Seat {
  id: string;
  kind: "desk" | "meeting" | "lounge";
  pos: { x: number; y: number };
  facing: "up" | "down";
  approach: { tx: number; ty: number };
  zOffset: number;
  occupant: string | null;
  /** Top-center screen position of the desk monitor, drawn as its own sprite. */
  monitor?: { x: number; y: number; z: number };
}
export interface ChatSpot {
  tx: number;
  ty: number;
  facing: Dir;
  occupant: string | null;
}
/** Floor sign marking an enclosed room; `tx`/`ty` is the plate centre tile. */
export interface RoomLabel {
  name: string;
  tx: number;
  ty: number;
  span?: number;
}
export interface Layout {
  furniture: FurnitureDef[];
  seats: Seat[];
  chatSpots: ChatSpot[];
  roomLabels: RoomLabel[];
  blocked: boolean[][];
}

/** Plates sit on empty aisle tiles so they never cover furniture. */
const ROOM_LABELS: RoomLabel[] = [
  { name: "LOUNGE", tx: 8, ty: 7 },
  { name: "MEETING ROOM", tx: 31, ty: 10 },
  { name: "WORKSTATIONS", tx: 48, ty: 8 },
  { name: "PANTRY & STORAGE", tx: 11, ty: 37 },
  { name: "NOC", tx: 1, ty: 18, span: 0 },
];
const LABEL_SPAN = 2; // free tiles required on each side of the plate centre

export function zoneName(tx: number, ty: number): string {
  if (tx < 15 && ty < 16) return "Lounge";
  if (tx < 15 && ty < 30 && ty >= 17) return "NOC";
  if (tx < 15 && ty >= 30) return "Pantry & Storage";
  if (tx >= 20 && tx <= 34 && ty < 19) return "Meeting Area";
  if (tx >= 39) return "Workstation Area";
  return "Sirkulasi";
}

export function buildLayout(deskCount = 12): Layout {
  const blocked = Array.from({ length: ROWS }, (_, ty) =>
    Array.from(
      { length: COLS },
      (_, tx) =>
        ty < MIN_WALK_ROW || ty >= ROWS - 1 || tx < 1 || tx >= COLS - 1,
    ),
  );
  const furniture: FurnitureDef[] = [];
  const seats: Seat[] = [];
  const block = (tx: number, ty: number, w: number, h: number) => {
    for (let y = ty; y < ty + h; y++)
      for (let x = tx; x < tx + w; x++) blocked[y][x] = true;
  };
  /** Letakkan furniture; anchor = tengah-bawah footprint; Y-sort berdasar sisi bawah. */
  const place = (
    type: FurnitureType,
    tx: number,
    ty: number,
    w = 1,
    h = 1,
    zOff = 0,
  ) => {
    furniture.push({
      type,
      x: (tx + w / 2) * TILE,
      y: (ty + h) * TILE,
      z: (ty + h) * TILE + zOff,
    });
    block(tx, ty, w, h);
  };
  const chair = (type: FurnitureType, x: number, y: number) =>
    furniture.push({ type, x, y: y + 2, z: y - 4 });
  const dividerV = (
    tx: number,
    ty0: number,
    ty1: number,
    doorTy: number | null = null,
  ) => {
    for (let ty = ty0; ty <= ty1; ty++) {
      if (ty === doorTy) placeDoor("doorV", tx, ty);
      else placePartition("partitionV", tx, ty);
    }
  };
  const dividerH = (
    ty: number,
    tx0: number,
    tx1: number,
    doorTx: number | null = null,
    startCorner = false,
    endCorner = false,
  ) => {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (tx === doorTx) placeDoor("doorH", tx, ty);
      else if (tx === tx0 && startCorner)
        placePartition("partitionHHalf", tx, ty, TILE / 4);
      else if (tx === tx1 && endCorner)
        placePartition("partitionHHalf", tx, ty, -TILE / 4);
      else placePartition("partitionH", tx, ty);
    }
    if (startCorner) placeCorner(tx0, ty);
    if (endCorner) placeCorner(tx1, ty);
  };
  const placePartition = (
    type: "partitionH" | "partitionV" | "partitionHHalf",
    tx: number,
    ty: number,
    xOffset = 0,
  ) => {
    const isBoundary =
      ty < MIN_WALK_ROW || ty >= ROWS - 1 || tx < 1 || tx >= COLS - 1;
    if (!isBoundary && blocked[ty][tx])
      throw new Error(`Partition overlaps an occupied tile at (${tx}, ${ty})`);
    if (type === "partitionH" || type === "partitionHHalf") {
      const y = ty * TILE + 8;
      furniture.push({ type, x: (tx + 0.5) * TILE + xOffset, y, z: y });
      block(tx, ty, 1, 1);
    } else place(type, tx, ty);
  };
  const placeCorner = (tx: number, ty: number) => {
    const y = ty * TILE + 8;
    furniture.push({ type: "partitionCorner", x: (tx + 0.5) * TILE, y, z: y });
  };
  const placeDoor = (type: "doorH" | "doorV", tx: number, ty: number) => {
    if (blocked[ty][tx])
      throw new Error(`Door overlaps an occupied tile at (${tx}, ${ty})`);
    if (type === "doorH") {
      const y = ty * TILE + 8;
      furniture.push({ type, x: (tx + 0.5) * TILE, y, z: y });
    } else {
      furniture.push({
        type,
        x: (tx + 0.5) * TILE,
        y: (ty + 1) * TILE,
        z: (ty + 1) * TILE,
      });
    }
  };

  // --- Workstation (right side): one desk per agent, 4 columns per row.
  // The desk count tracks the live agent roster (min 12, max 16 so the room
  // still reads as an office) so no agent is left without a computer.
  const deskTarget = Math.max(12, Math.min(16, Math.floor(deskCount) || 12));
  const DESK_COLS = [42, 46, 50, 54];
  let n = 1;
  let placed = 0;
  for (let row = 0; placed < deskTarget; row++) {
    const ty = 6 + row * 4;
    for (const tx of DESK_COLS) {
      if (placed >= deskTarget) break;
      place("desk", tx, ty, 2, 1);
      place("filing", tx + 2, ty);
      const pos = { x: (tx + 1) * TILE, y: (ty + 1) * TILE + 24 };
      chair("chairUp", pos.x, pos.y);
      seats.push({
        id: `WS-${String(n++).padStart(2, "0")}`,
        kind: "desk",
        pos,
        facing: "up",
        approach: { tx, ty: ty + 1 },
        zOffset: 0,
        occupant: null,
        monitor: {
          x: (tx + 1) * TILE,
          y: (ty + 1) * TILE - 28 * ART,
          z: (ty + 1) * TILE + 0.5,
        },
      });
      placed++;
    }
  }
  // --- Lounge (kiri)
  const sofaSeats = (
    tx: number,
    ty: number,
    kind: Seat["kind"],
    id: string,
  ) => {
    for (const k of [0.8, 2.2]) {
      const x = (tx + k) * TILE;
      seats.push({
        id: `${id}-${k}`,
        kind,
        pos: { x, y: (ty + 1) * TILE - 6 },
        facing: "down",
        approach: { tx: Math.floor(x / TILE), ty: ty + 1 },
        zOffset: 0,
        occupant: null,
      });
    }
  };
  place("sofa3Down", 3, 8, 3, 1, -10);
  sofaSeats(3, 8, "lounge", "LS");
  place("coffeeTable", 4, 10, 2, 1);
  for (const tx of [3, 5]) {
    place("sofa2Up", tx, 12, 2, 1);
    seats.push({
      id: `LU-${tx}`,
      kind: "lounge",
      pos: { x: (tx + 1) * TILE, y: 13 * TILE - 10 },
      facing: "up",
      approach: { tx, ty: 11 },
      zOffset: -10,
      occupant: null,
    });
  }
  dividerV(14, 5, 15, 13);
  place("plant", 13, 12);
  place("plant", 13, 14);
  dividerH(16, 0, 13, null, false, false);
  // Close the bottom-right T-junction: the vertical run (col 14) ends at row 15 and the horizontal band (row 16) ends at
  // col 13. Two 8x8 panes sit on the empty tile 14 band square to seal the corner — a half pane bridges the right half
  // (x 440..448) into the vertical run, and a corner pane fills the left half (x 432..440). Both render after the
  // first vertical pane (z above 17 * TILE) so the frame lines stay joined and the corner no longer overhangs.
  const loungeBandY = 16 * TILE + 8;
  furniture.push({
    type: "partitionHHalf",
    x: (14 + 0.5) * TILE,
    y: loungeBandY,
    z: 17 * TILE + 1,
  });
  furniture.push({
    type: "partitionCorner",
    x: (14 + 0.5) * TILE - TILE / 4,
    y: loungeBandY,
    z: 17 * TILE + 2,
  });
  // --- Meeting (tengah)
  place("whiteboard", 24, 7, 3, 1);
  place("meetingTable", 23, 11, 4, 2);
  for (let x = 23; x < 27; x++) {
    const top = { x: (x + 0.5) * TILE, y: 11 * TILE - 2 };
    chair("chairDown", top.x, top.y);
    seats.push({
      id: `MT-${x}`,
      kind: "meeting",
      pos: top,
      facing: "down",
      approach: { tx: x, ty: 10 },
      zOffset: 0,
      occupant: null,
    });
    const bot = { x: (x + 0.5) * TILE, y: 14 * TILE - 4 };
    chair("chairUp", bot.x, bot.y);
    seats.push({
      id: `MB-${x}`,
      kind: "meeting",
      pos: bot,
      facing: "up",
      approach: { tx: x, ty: 13 },
      zOffset: 0,
      occupant: null,
    });
  }
  place("sofa3Down", 29, 8, 3, 1, -10);
  sofaSeats(29, 8, "meeting", "MS");
  dividerV(20, 5, 15);
  dividerV(35, 5, 15, 11);
  dividerH(16, 20, 35, null, true, true);
  place("plant", 34, 10);
  place("plant", 34, 12);
  // --- NOC (kiri tengah): 18 rack server 3 baris x 6 kolom
  dividerV(14, 16, 29, 23);
  for (const ty of [20, 24, 28]) {
    for (const tx of [2, 4, 6, 8, 10, 12]) {
      place("serverRack", tx, ty);
    }
  }
  // --- Facilities & storage (kiri bawah)
  place("bookshelf", 1.5, 33, 2, 1);
  place("bookshelf", 3, 33, 3, 1);
  place("cabinet", 6, 33);
  place("fridge", 7, 33);
  place("dispenser", 8, 33);
  place("storageTable", 10, 33, 3, 1);
  place("plant", 13, 33);
  place("plant", 13, 35);
  // Dining nook in the pantry: a 4x2 table with two chairs on each long side.
  place("meetingTable", 5, 36, 4, 2);
  for (const x of [6, 7]) {
    const top = { x: (x + 0.5) * TILE, y: 36 * TILE - 2 };
    chair("chairDown", top.x, top.y);
    seats.push({
      id: `DT-${x}`,
      kind: "lounge",
      pos: top,
      facing: "down",
      approach: { tx: x, ty: 35 },
      zOffset: 0,
      occupant: null,
    });
    const bot = { x: (x + 0.5) * TILE, y: 39 * TILE - 4 };
    chair("chairUp", bot.x, bot.y);
    seats.push({
      id: `DB-${x}`,
      kind: "lounge",
      pos: bot,
      facing: "up",
      approach: { tx: x, ty: 38 },
      zOffset: 0,
      occupant: null,
    });
  }
  dividerH(30, 0, 13);
  dividerV(14, 30, 39, 34);
  // Mirror of the lounge joint: the horizontal run stops at tile 13, a half pane bridges into the left half of tile 14,
  // and the corner sits on the band line to seal the junction with the vertical run. Both pieces render after the first
  // vertical pane (z above 31 * TILE) so the frame lines stay joined.
  const bandY = 30 * TILE + 8;
  furniture.push({
    type: "partitionHHalf",
    x: (14 + 0.5) * TILE - TILE / 4,
    y: bandY,
    z: 31 * TILE + 1,
  });
  furniture.push({
    type: "partitionCorner",
    x: (14 + 0.5) * TILE,
    y: bandY,
    z: 31 * TILE + 2,
  });

  const ensureRoomLabelsClear = () => {
    for (const label of ROOM_LABELS) {
      const span = label.span ?? LABEL_SPAN;
      for (let ty = label.ty - 1; ty <= label.ty + 1; ty++) {
        for (
          let tx = label.tx - span;
          tx <= label.tx + span;
          tx++
        ) {
          const inBounds = ty >= 0 && ty < ROWS && tx >= 0 && tx < COLS;
          if (!inBounds || blocked[ty][tx]) {
            throw new Error(
              `Room label "${label.name}" overlaps an occupied tile at (${tx}, ${ty})`,
            );
          }
        }
      }
    }
  };
  ensureRoomLabelsClear();

  const spot = (tx: number, ty: number, facing: Dir): ChatSpot => ({
    tx,
    ty,
    facing,
    occupant: null,
  });
  const chatSpots = [
    spot(18, 22, "right"),
    spot(19, 22, "left"),
    spot(24, 27, "right"),
    spot(25, 27, "left"),
    spot(30, 22, "right"),
    spot(31, 22, "left"),
    spot(14, 29, "right"),
    spot(15, 29, "left"),
    spot(3, 36, "right"),
    spot(4, 36, "left"),
  ];
  return { furniture, seats, chatSpots, roomLabels: ROOM_LABELS, blocked };
}
