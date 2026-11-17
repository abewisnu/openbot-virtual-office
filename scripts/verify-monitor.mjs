// Verifies the desk-monitor rule: a screen may only light once the agent is
// actually sitting in that chair, never while it is still walking over.
// Run with: node scripts/verify-monitor.mjs
import { readFileSync } from 'node:fs';
import { monitorStateFor } from '../src/office/Monitor.ts';

const cases = [
  // [phase, seated, expected]
  ['working', true, 'moving'],
  ['ready', true, 'still'],
  ['idle', true, 'off'],
  ['blocked', true, 'off'],
  ['restarting', true, 'off'],
  ['stopped', true, 'off'],
  ['starting', true, 'off'],
  [undefined, true, 'off'],
  // The bug this gate exists for: phase says working, but the body is still
  // walking to the desk, so the screen has to stay dark.
  ['working', false, 'off'],
  ['ready', false, 'off'],
  ['idle', false, 'off'],
  [undefined, false, 'off'],
];

let failed = 0;
for (const [phase, seated, want] of cases) {
  const got = monitorStateFor(phase, seated);
  const ok = got === want;
  if (!ok) failed++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'} phase=${String(phase).padEnd(10)} seated=${String(seated).padEnd(5)} want=${want.padEnd(6)} got=${got}`,
  );
}

// Source guard: World must gate on the seated character, not the seat occupant
// alone, so a future edit cannot quietly bring the early-on bug back.
const world = readFileSync(new URL('../src/office/World.ts', import.meta.url), 'utf8');
const gate = /const seated = [^;]*state === 'sit'[^;]*seat === seat;/;
const usesHelper = /monitorStateFor\(/.test(world);
for (const [label, ok] of [
  ['World.ts gates on Character.state === "sit" on the same seat', gate.test(world)],
  ['World.ts decides the screen through monitorStateFor()', usesHelper],
]) {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
}

if (failed) {
  console.error(`\n${failed} monitor check(s) failed.`);
  process.exit(1);
}
console.log('\nAll monitor checks passed: screen lights only after the agent is seated.');
