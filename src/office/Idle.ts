// Where a standby agent spends its time, kept pure (types only) so a gate
// script can exercise the rule directly.
//
// An `idle` agent never chooses a workstation aisle: its goals come from the
// social rooms (Meeting Area, Lounge, Pantry & Storage), and it prefers a chair
// that already faces somebody seated, so two agents read as a conversation
// instead of two people pacing the office.
import type { Seat } from './Layout';
import type { Tile } from './Pathfinder';

/** Rooms an idle agent is allowed to occupy. */
export const SOCIAL_ZONES = new Set(['Lounge', 'Pantry & Storage', 'Meeting Area']);

export function isSocialZone(zone: string): boolean {
  return SOCIAL_ZONES.has(zone);
}

/** A chair anywhere except a workstation bay. */
export function isSocialSeat(seat: Seat): boolean {
  return seat.kind !== 'desk';
}

/**
 * The seat directly across from `seat`: same column, opposite facing. Meeting
 * chairs pair that way, and the lounge loveseats face the sofa the same way.
 */
export function visAVis(seats: Seat[], seat: Seat): Seat | undefined {
  return seats.find(
    (o) =>
      o.id !== seat.id &&
      o.kind === seat.kind &&
      o.pos.x === seat.pos.x &&
      o.facing !== seat.facing,
  );
}

/**
 * Pick an idle seat: first a free social chair whose vis-à-vis is already
 * seated (join the conversation), then any free social chair, then null so the
 * caller can fall back to a social floor tile.
 */
export function pickIdleSeat(
  seats: Seat[],
  selfId: string,
  rng: () => number = Math.random,
): Seat | null {
  const free = seats.filter((s) => isSocialSeat(s) && (!s.occupant || s.occupant === selfId));
  if (!free.length) return null;
  const withCompany = free.filter((s) => {
    const partner = visAVis(seats, s);
    return !!partner && !!partner.occupant && partner.occupant !== selfId;
  });
  const pool = withCompany.length ? withCompany : free;
  return pool[Math.floor(rng() * pool.length)];
}

/** Pick a social floor tile (used when every social chair is taken). */
export function pickIdleTile(tiles: Tile[], rng: () => number = Math.random): Tile | null {
  if (!tiles.length) return null;
  return tiles[Math.floor(rng() * tiles.length)];
}

/**
 * True when the seat is part of a conversation worth drawing a speech bubble
 * for: seated, with somebody seated directly across from it.
 */
export function isChattingSeat(seats: Seat[], seat: Seat, selfId: string): boolean {
  const partner = visAVis(seats, seat);
  return !!partner && !!partner.occupant && partner.occupant !== selfId;
}
