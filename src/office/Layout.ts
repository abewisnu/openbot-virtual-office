import { PROP, COLS, ROWS, TILE, MIN_WALK_ROW, RACK_COLS, RACK_ROWS, RACK_W, DOOR_SPAN, type Dir } from "../constants";
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
  { name: "LOUNGE", tx: 8, ty: 14, span: 0 },
  { name: "MEETING ROOM", tx: 19, ty: 9, span: 1 },
  { name: "WORKSTATIONS", tx: 48, ty: 7 },
  { name: "PANTRY & STORAGE", tx: 10, ty: 22, span: 1 },
  { name: "NOC", tx: 8, ty: 33, span: 1 },
];
const LABEL_SPAN = 2; // free tiles required on each side of the plate centre

export function zoneName(tx: number, ty: number): string {
  if (tx < 15 && ty < 16) return "Lounge";
  if (tx < 15 && ty < 30 && ty >= 17) return "Pantry & Storage";
  if (tx < 15 && ty >= 30) return "NOC";
  if (tx >= 17 && tx <= 32 && ty < 19) return "Meeting Area";
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
    if (!Number.isInteger(tx) || !Number.isInteger(ty))
      throw new Error(`block() needs integer tiles, got (${tx}, ${ty})`);
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
  /**
   * `front` draws the chair above the agent seated at `y`. A forward-facing
   * chair (agent faces `up`, back to the viewer) has its backrest between the
   * viewer and the agent, so it must overdraw the agent's back; otherwise the
   * shirt colour hides the chair. Backrests behind the agent stay below.
   *
   * A chair is solid: its seat tile (and the half of the 2-tile-wide sprite
   * overhang on the left) blocks walking, so a walker goes around instead of
   * through the backrest. The seat tile stays reserved for the agent that sits
   * there — that is why every seat's `approach` points at a neighbouring free
   * tile, not at the chair itself.
   */
  const chair = (
    type: FurnitureType,
    x: number,
    y: number,
    front = false,
  ) => {
    furniture.push({ type, x, y: y + 2, z: front ? y + 4 : y - 4 });
    const tx = Math.floor(x / TILE), ty = Math.floor((y + 1) / TILE);
    block(tx - 1, ty, 2, 1);
  };
  const dividerV = (
    tx: number,
    ty0: number,
    ty1: number,
    doorTy: number | null = null,
    doorSpan = DOOR_SPAN,
  ) => {
    for (let ty = ty0; ty <= ty1; ty++) {
      if (doorTy !== null && ty > doorTy - doorSpan && ty <= doorTy) continue;
      placePartition("partitionV", tx, ty);
    }
    if (doorTy !== null) placeDoor("doorV", tx, doorTy);
  };
  const dividerH = (
    ty: number,
    tx0: number,
    tx1: number,
    doorTx: number | null = null,
    startCorner = false,
    endCorner = false,
    doorSpan = DOOR_SPAN,
  ) => {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (doorTx !== null && tx > doorTx - doorSpan && tx <= doorTx) continue;
      if (tx === tx0 && startCorner)
        placePartition("partitionHHalf", tx, ty, TILE / 4);
      else if (tx === tx1 && endCorner)
        placePartition("partitionHHalf", tx, ty, -TILE / 4);
      else placePartition("partitionH", tx, ty);
    }
    if (doorTx !== null) placeDoor("doorH", doorTx, ty);
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
      // The sprite is centred on the whole `DOOR_SPAN` opening: `tx` is its
      // rightmost tile, so the opening starts at `tx - DOOR_SPAN + 1`.
      furniture.push({
        type,
        x: (tx + 1 - DOOR_SPAN / 2) * TILE,
        y,
        z: y,
      });
    } else {
      // `ty` is the lowest tile of the opening; the sprite is bottom-anchored
      // and grows upward across the cleared rows.
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
  // A 2x desk stands 4 tiles wide and 3.5 tiles tall, so bays sit on a 6-tile
  // column pitch (4 tiles of desk + a 2-tile aisle on the right of each bay)
  // and a 6-tile row pitch, which leaves roughly two clear rows between a desk
  // back and the chair in front of it. Four bays at that pitch need tiles
  // 36-57, so the block starts on column 37: the last bay stops one tile short
  // of the wall and the first one starts one tile off the glass partition at
  // column 35. Rows start at ty 9, clear of the window band (art rows 0-5).
  const deskTarget = Math.max(12, Math.min(16, Math.floor(deskCount) || 12));
  const DESK_COLS = [37, 43, 49, 55];
  // Tile footprint of one desk, measured from the sprite: the desk art is 32
  // art px wide, so at PROP px per art px it covers `32*PROP/TILE` tiles (4 at
  // the shipped 2x scale, 2 at ?props=1). The collision grid has to match that
  // width or a walker can slip through the overhang and cross a workstation.
  const DESK_W = Math.max(2, Math.round((32 * PROP) / TILE));
  const deskLeft = (tx: number) => tx - (DESK_W - 2) / 2;
  let n = 1;
  let placed = 0;
  for (let row = 0; placed < deskTarget; row++) {
    const ty = 9 + row * 6;
    for (const tx of DESK_COLS) {
      if (placed >= deskTarget) break;
      place("desk", deskLeft(tx), ty, DESK_W, 1);
      const pos = { x: (tx + 1) * TILE, y: (ty + 1) * TILE + 24 };
      chair("chairUp", pos.x, pos.y, true);
      seats.push({
        id: `WS-${String(n++).padStart(2, "0")}`,
        kind: "desk",
        pos,
        facing: "up",
        // The chair tile is solid now, so the agent stops one row short of the
        // backrest and steps into the seat from the aisle.
        approach: { tx, ty: ty + 2 },
        zOffset: 0,
        occupant: null,
        // Bottom edge of the 2x monitor sprite, 4 art px above the desk's front
        // edge: the screen fills the desk width and stops under the window band.
        monitor: {
          x: (tx + 1) * TILE,
          y: (ty + 1) * TILE - 4 * PROP,
          z: (ty + 1) * TILE + 0.5,
        },
      });
      placed++;
    }
  }
  // --- Lounge (kiri)
  // One seat per sofa cushion: `ks` are tile offsets from the sofa's left edge,
  // so a 6-tile 3-seat sofa gets cushions at +1/+3/+5 and a 4-tile loveseat at
  // +1/+3. Seat ids derive from the offset, keeping them stable per frame.
  /**
   * Seats on a down-facing sofa. The 3-seat sofa draws its backrest at the top
   * of the sprite and its cushions below, so the person sits in front of the
   * whole piece; `zOffset` lifts the body above the sofa sprite, otherwise the
   * backrest overdraws the torso and only the head shows over it, which reads as
   * the agent sitting the wrong way round. Up-facing loveseats keep the opposite
   * order (backrest between the viewer and the sitter) and therefore `0`.
   */
  const SOFA_FRONT_Z = 8;
  const sofaSeats = (
    tx: number,
    ty: number,
    kind: Seat["kind"],
    id: string,
    ks: number[] = [0.8, 2.2],
  ) => {
    for (const k of ks) {
      const x = (tx + k) * TILE;
      seats.push({
        id: `${id}-${k}`,
        kind,
        pos: { x, y: (ty + 1) * TILE - 6 },
        facing: "down",
        approach: { tx: Math.floor(x / TILE), ty: ty + 1 },
        zOffset: SOFA_FRONT_Z,
        occupant: null,
      });
    }
  };
  // Lounge seating bay, centred on the room (cols 1-13, centre 7):
  // - 6-tile 3-seat sofa against the north wall (cols 4-9, row 8), facing down,
  //   one row off the window band so its back still reads against the glass.
  // - 4x2 coffee table under it (cols 5-8, rows 10-11).
  // - a 4-tile loveseat on each side of the table (cols 1-4 and 10-13, row 13)
  //   facing up, so the three pieces ring the table without overlapping.
  // - 10x6 rug under the whole bay, a tall plant flanking the sofa on row 8 so
  //   each sprite stands fully inside the room instead of over the wall band.
  // Every seat is reachable: rows 9 and 14-15 stay open all the way across, and
  // the right side of the bay now opens straight into the columns 15-16 aisle
  // since column 14 carries no glass.
  place("sofa3Down", 4, 8, 6, 1);
  sofaSeats(4, 8, "lounge", "LS", [1, 3, 5]);
  place("coffeeTable", 5, 10, 4, 2);
  for (const [tx, id] of [[1, "LL"], [10, "LR"]] as const) {
    place("sofa2Up", tx, 13, 4, 1);
    for (const k of [1, 3]) {
      const x = (tx + k) * TILE;
      seats.push({
        id: `${id}-${k}`,
        kind: "lounge",
        pos: { x, y: 14 * TILE - 10 },
        facing: "up",
        approach: { tx: Math.floor(x / TILE), ty: 14 },
        zOffset: 0,
        occupant: null,
      });
    }
  }
  place("plant", 1, 8, 2, 1);
  place("plant", 12, 8, 2, 1);
  // Open plan on the left: the Lounge and the Pantry have no glass at all —
  // neither the old row-16 band with its T-junction corner panes nor the
  // column-14 wall that used to run down their right side. The two rooms share
  // one floor plate with the aisle at columns 15-16. The NOC below keeps its
  // glass box and door, and the Meeting Room keeps its partitions unchanged.
  // --- Meeting (kiri-tengah)
  // The room sits one room-width left of the workstation block: walls on
  // columns 17 and 32, interior columns 18-31 and rows 6-17, which leaves a
  // 3-tile aisle (33-35) between the glass and the first desk bay at column 36.
  // The floor runs one extra row past the table so the back chairs no longer
  // touch the bottom glass: chairs end at y 512 and the bottom wall sits at
  // row 18 (y 584).
  // Props are anchored in pixels, not tiles, because at the 2x default their
  // sprites are much wider and taller than their collision footprint. The
  // numbers keep a one-tile margin on every side and a visible gap between the
  // pieces: top band = sofa (x 592-784) then the 128 px whiteboard
  // (x 872-1000), which hangs above the chair line at the right end of the
  // wall; table (x 672-928, y 336-480) centred under the sofa with four
  // chairs per side.

  // Whiteboard at the right end of the top band, clear of the sofa: the sofa
  // ends at x 784 and the board (128 px at ART) runs x 872-1000, a 88 px air
  // gap that leaves room for the right arm to read on its own. It hangs a
  // little higher than the sofa base line (y 252 vs 264) and stands 104 px tall
  // (64x52 art), so it tops out level with the sofa back.
  furniture.push({ type: "whiteboard", x: 936, y: 252, z: 252 });
  block(27, 8, 4, 1);
  furniture.push({ type: "sofa3Down", x: 688, y: 264, z: 254 });
  block(20, 7, 3, 1);
  sofaSeats(20, 7, "meeting", "MS");
  // Table sprite is 8 x 4.5 tiles; only the middle four rows collide. The chair
  // seats themselves are solid, so the approach tiles sit in the free aisle
  // rows 9 and 16 just outside the backrests.
  furniture.push({ type: "meetingTable", x: 800, y: 480, z: 480 });
  block(21, 11, 8, 4);
  for (const cx of [704, 768, 832, 896]) {
    const tx = Math.floor(cx / TILE);
    const top = { x: cx, y: 334 };
    chair("chairDown", top.x, top.y);
    seats.push({
      id: `MT-${tx}`,
      kind: "meeting",
      pos: top,
      facing: "down",
      // The chair tile is solid, so both rows approach from the aisle: the
      // top chairs from row 9, the bottom chairs from row 16.
      approach: { tx, ty: 9 },
      zOffset: 0,
      occupant: null,
    });
    const bot = { x: cx, y: 510 };
    chair("chairUp", bot.x, bot.y, true);
    seats.push({
      id: `MB-${tx}`,
      kind: "meeting",
      pos: bot,
      facing: "up",
      approach: { tx, ty: 16 },
      zOffset: 0,
      occupant: null,
    });
  }
  dividerV(17, 5, 17);
  dividerV(32, 5, 17, 12);
  dividerH(18, 17, 32, null, true, true);
  place("plant", 19, 16);
  place("plant", 30, 16);
  // --- Pantry & Storage (kiri tengah, ruang atas): shelves and storage along
  // the room's top wall, dining nook below them. The NOC used to live here and
  // the two rooms have swapped places, so the upper room now holds the pantry.
  // No divider on column 14: the pantry reads as open plan against the Lounge.
  // Shelf wall along row 20, in three clusters with a one-tile gutter on each
  // side of it (col 5 and col 10) so the run reads evenly across the room. It
  // sits on row 21, three tiles below the top wall, so the tallest bookcase
  // (5.5 tiles) stands fully inside the room instead of over the glass.
  // footprints match the art at the 2x prop scale: the bookshelf is 32 art px
  // (4 tiles), every other unit 16 art px (2 tiles). `place()` now rejects
  // fractional tiles, so the old 1.5/11.5 hack is gone.
  place("bookshelf", 1, 20, 4, 1);
  place("cabinet", 6, 20, 2, 1);
  place("fridge", 8, 20, 2, 1);
  place("dispenser", 11, 20, 2, 1);
  place("plant", 1, 28, 2, 1);
  place("plant", 11, 28, 2, 1);
  // Dining nook in the pantry: a 4x2 table with two chairs on each long side.
  // The 4-tile `diningTable` sprite matches its footprint exactly, so the aisle
  // is not clipped by a table drawn wider than its collision.
  // Four chairs, two per long side, pitched two tiles apart and centred on the
  // 4-tile table (centres at x 192 and 256 = tiles 6 and 8): their 2-tile
  // sprites sit side by side without overlapping and the pair reads symmetric.
  // A chair is solid across two tiles, so each approach steps one row outside
  // the chair — row 22 above, row 27 below — where the aisle is clear.
  place("diningTable", 5, 24, 4, 2);
  for (const tx of [6, 8]) {
    const cx = tx * TILE;
    const top = { x: cx, y: 24 * TILE - 2 };
    chair("chairDown", top.x, top.y);
    seats.push({
      id: `DT-${tx}`,
      kind: "lounge",
      pos: top,
      facing: "down",
      approach: { tx, ty: 22 },
      zOffset: 0,
      occupant: null,
    });
    const bot = { x: cx, y: 27 * TILE - 4 };
    chair("chairUp", bot.x, bot.y, true);
    seats.push({
      id: `DB-${tx}`,
      kind: "lounge",
      pos: bot,
      facing: "up",
      approach: { tx, ty: 27 },
      zOffset: 0,
      occupant: null,
    });
  }
  // --- NOC (kiri bawah, ruang bawah): raised-floor server room.
  // Everything tall stands on row 36 so it grows up to row 31 and never clips
  // the pantry wall at row 30: two racks (each 2 tiles wide, 4 server units) on
  // the left, the CRAC in the middle and the UPS cabinet on the right. Both
  // walk lanes (col 6-7 and col 10) stay open. The wall row itself carries two
  // patch panels (access switches) above the racks.
  for (const ty of RACK_ROWS) {
    for (const tx of RACK_COLS) {
      place("serverRack", tx, ty, RACK_W, 1);
    }
  }
  place("crac", 8, 36, 2, 1);
  place("ups", 11, 36, 2, 1);
  place("switchBox", 7, 31, 2, 1);
  place("switchBox", 10, 31, 2, 1);
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
    spot(15, 29, "right"),
    spot(16, 29, "left"),
    spot(3, 22, "right"),
    spot(4, 22, "left"),
  ];
  return { furniture, seats, chatSpots, roomLabels: ROOM_LABELS, blocked };
}
