// Verifies the standby (`idle`) rule: a standby agent takes a chair in the
// Meeting Area, the Lounge or the Pantry and never a workstation aisle, and it
// prefers a chair that already faces a seated colleague so the pair reads as a
// conversation.
// Run with: node --import ./scripts/register-ts.mjs scripts/verify-idle.mjs
import { buildLayout, zoneName } from '../src/office/Layout.ts';
import { isChattingSeat, isSocialSeat, isSocialZone, pickIdleSeat, pickIdleTile, visAVis } from '../src/office/Idle.ts';

let failed = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`verdict=${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` ${detail}` : ''}`);
};

const layout = buildLayout(16);
const seats = layout.seats;
const zoneOf = (s) => zoneName(s.approach.tx, s.approach.ty);

// --- Social rooms
check('social zones are the three lounge rooms', ['Lounge', 'Pantry & Storage', 'Meeting Area'].every(isSocialZone));
check('workstation area is not a social zone', !isSocialZone('Workstation Area') && !isSocialZone('Sirkulasi') && !isSocialZone('NOC'));

// --- Seat eligibility
const deskSeats = seats.filter((s) => s.kind === 'desk');
const socialSeats = seats.filter(isSocialSeat);
check('desk chairs are excluded from the idle pool', deskSeats.length > 0 && !socialSeats.some((s) => s.kind === 'desk'), `${deskSeats.length} desk / ${socialSeats.length} social`);
check('social pool covers meeting, lounge and pantry', ['Meeting Area', 'Lounge', 'Pantry & Storage'].every((z) => socialSeats.some((s) => zoneOf(s) === z)));
check('social pool seats at least one per agent', socialSeats.length >= 16, `${socialSeats.length} seats for 16 agents`);

// --- Picker never leaves the social rooms
const picks = Array.from({ length: 400 }, () => pickIdleSeat(seats, 'nobody'));
check('picker always returns a social chair', picks.every((s) => s === null || isSocialSeat(s)));
check('picker never targets a workstation aisle', picks.every((s) => s === null || zoneOf(s) !== 'Workstation Area'));

// --- Preference: a chair facing somebody seated wins
const probe = socialSeats.find((s) => !!visAVis(seats, s));
check('a vis-à-vis pair exists in the layout', !!probe, probe ? `${probe.id} faces ${visAVis(seats, probe).id}` : 'none');
if (probe) {
  const partner = visAVis(seats, probe);
  // Occupy an unrelated far chair and the partner; the partner-facing chair must win.
  const decoy = socialSeats.find((s) => s.id !== probe.id && s.id !== partner.id && s.kind === probe.kind && !!visAVis(seats, s));
  partner.occupant = 'colleague';
  const p = Array.from({ length: 50 }, () => pickIdleSeat(seats, 'nobody'));
  check('picker joins a seated colleague before taking an empty chair', p.every((s) => !!s && !!visAVis(seats, s)?.occupant), `decoy=${decoy?.id ?? '-'}`);
  check('chat bubble only on a paired, seated chair', isChattingSeat(seats, probe, 'nobody') && !isChattingSeat(seats, partner, 'colleague'));
  partner.occupant = null;
  check('no bubble when the vis-à-vis stands up', !isChattingSeat(seats, probe, 'nobody'));
}

// --- Floor fallback stays inside the social rooms
const socialTiles = [];
layout.blocked.forEach((row, ty) => row.forEach((b, tx) => { if (!b && isSocialZone(zoneName(tx, ty))) socialTiles.push({ tx, ty }); }));
check('social floor tiles exist in every social room', ['Lounge', 'Pantry & Storage', 'Meeting Area'].every((z) => socialTiles.some((t) => zoneName(t.tx, t.ty) === z)), `${socialTiles.length} tiles`);
check('social floor tiles exclude the workstation area', socialTiles.every((t) => zoneName(t.tx, t.ty) !== 'Workstation Area'));
check('tile picker draws only from that pool', Array.from({ length: 200 }, () => pickIdleTile(socialTiles)).every((t) => isSocialZone(zoneName(t.tx, t.ty))));

// --- Source guards: World wires the rule in
import { readFileSync } from 'node:fs';
const world = readFileSync(new URL('../src/office/World.ts', import.meta.url), 'utf8');
const guards = [
  ['idle and break share the social-seat picker', /seat = pickIdleSeat\(this\.layout\.seats, ch\.id\)/.test(world)],
  ['the global wander is no longer the idle fallback', /else this\.wanderIdle\(ch\)/.test(world)],
  ['socialTiles are built from the social zones', /this\.socialTiles = this\.walkable\.filter\(\(t\) => isSocialZone\(zoneName\(t\.tx, t\.ty\)\)\)/.test(world)],
  ['a seated idle agent keeps its chair instead of roaming', /ch\.state === 'sit' && Math\.random\(\) < 0\.6/.test(world)],
  ['an idle pair gets a talk bubble', /const chattingIdle = ch\.appliedStatus === 'idle'/.test(world)],
];
for (const [label, ok] of guards) check(label, ok);

if (failed) {
  console.error(`\n${failed} standby check(s) failed.`);
  process.exit(1);
}
console.log('\nAll standby checks passed: idle agents sit and chat in the social rooms, never pacing the desks.');
