// Verifies the chair collision fix and the meeting-room chat feature.
// A chair sprite is 2 tiles wide at the default prop scale and used to leave no
// footprint on the collision grid, so a walking agent slid straight through the
// backrest. Every seat tile must now be solid while its `approach` tile stays
// walkable and reachable, and a `chatting` agent must be able to sit at the
// meeting table with a colleague.
// Run with: node scripts/verify-chairs.mjs
import { readFileSync } from 'node:fs';
import { buildLayout } from '../src/office/Layout.ts';
import { findPath } from '../src/office/Pathfinder.ts';
import { TILE } from '../src/constants.ts';

let failed = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`verdict=${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` ${detail}` : ''}`);
};

const layout = buildLayout(12);
const blocked = layout.blocked;
const tileOf = (p) => ({ tx: Math.floor(p.x / TILE), ty: Math.floor(p.y / TILE) });

// The doorway on the meeting room's right wall (column 32, rows 10-12) is the
// only way in, so every seat has to be reachable from it.
const door = { tx: 32, ty: 11 };
check('meeting doorway tile is walkable', !blocked[door.ty][door.tx]);

const seatKinds = new Set(layout.seats.map((s) => s.kind));
check('layout ships desk, meeting and lounge seats', ['desk', 'meeting', 'lounge'].every((k) => seatKinds.has(k)));

for (const s of layout.seats) {
  const seatTile = tileOf(s.pos);
  check(
    `seat ${s.id} tile is solid`,
    blocked[seatTile.ty]?.[seatTile.tx] === true,
    `(${seatTile.tx},${seatTile.ty})`,
  );
  check(
    `seat ${s.id} approach is walkable`,
    blocked[s.approach.ty]?.[s.approach.tx] === false,
    `(${s.approach.tx},${s.approach.ty})`,
  );
  check(
    `seat ${s.id} approach is not the chair tile`,
    s.approach.tx !== seatTile.tx || s.approach.ty !== seatTile.ty,
  );
}

// A walker must be able to route around the solid chairs: from the meeting door
// to every meeting chair, and from the west aisle to every desk chair.
const meetingChairs = layout.seats.filter((s) => /^M[TB]-/.test(s.id));
check('meeting table has eight chairs', meetingChairs.length === 8, `got ${meetingChairs.length}`);
const hubs = [door, { tx: 34, ty: 20 }, { tx: 10, ty: 34 }];
for (const s of layout.seats) {
  const reachable = hubs.some((hub) => findPath(blocked, hub, s.approach));
  check(`path hub -> ${s.id}`, reachable);
}
// A chatting pair sits opposite each other across the table, so each meeting
// chair has to own exactly one facing partner on the same column.
for (const s of meetingChairs) {
  const partners = meetingChairs.filter((o) => o !== s && o.pos.x === s.pos.x && o.facing !== s.facing);
  check(`meeting chair ${s.id} has one facing partner`, partners.length === 1, `got ${partners.length}`);
}

const world = readFileSync(new URL('../src/office/World.ts', import.meta.url), 'utf8');
const layoutSrc = readFileSync(new URL('../src/office/Layout.ts', import.meta.url), 'utf8');

const guards = [
  ['chair() writes a collision footprint', /const chair = \([\s\S]{0,400}?block\(tx - 1, ty, 2, 1\);/.test(layoutSrc)],
  ['chair() measures the seat row, not the sprite base', /ty = Math\.floor\(\(y \+ 1\) \/ TILE\)/.test(layoutSrc)],
  ['desk seats approach from row ty + 2', /kind: "desk",[\s\S]{0,200}?approach: \{ tx, ty: ty \+ 2 \}/.test(layoutSrc)],
  ['top meeting chairs approach from row 9', /facing: "down",[\s\S]{0,200}?approach: \{ tx, ty: 9 \}/.test(layoutSrc)],
  ['bottom meeting chairs approach from row 16', /facing: "up",[\s\S]{0,200}?approach: \{ tx, ty: 16 \}/.test(layoutSrc)],
  ['chatting can take a meeting chair', /status === 'chatting'[\s\S]{0,400}?freeMeetingChatSeat\(\)/.test(world)],
  ['chatting falls back to an aisle spot', /freeMeetingChatSeat\(\);\s*\n\s*if \(!seat\) spot = this\.freeSpot\(\);/.test(world)],
  ['a chat seat prefers a partner already sitting', /withCompany = free\.filter\(\(s\) => partnerOf\(s\)\?\.occupant\)/.test(world)],
  ['meeting chat seats pair by x and opposite facing', /o\.pos\.x === s\.pos\.x &&[\s\S]{0,80}?o\.facing !== s\.facing/.test(world)],
  ['a sitting chatting agent still shows the talk bubble', /ch\.appliedStatus === 'meeting' \|\| ch\.appliedStatus === 'chatting'/.test(world)],
];
for (const [label, ok] of guards) check(label, ok);

if (failed) {
  console.error(`\n${failed} chair check(s) failed.`);
  process.exit(1);
}
console.log('\nAll chair checks passed: chairs are solid and agents can sit and chat at the meeting table.');
