// Verifies the desk-monitor rule: a screen may only light once the agent is
// actually sitting in that chair, never while it is still walking over.
// `blocked` is the exception in kind, not in the gate: its screen turns grey
// while the agent is parked in front of the computer waiting for a human.
// Run with: node scripts/verify-monitor.mjs
import { readFileSync } from 'node:fs';
import { monitorStateFor } from '../src/office/Monitor.ts';

const cases = [
  // [phase, seated, expected]
  ['working', true, 'moving'],
  ['ready', true, 'still'],
  ['blocked', true, 'waiting'],
  ['idle', true, 'off'],
  ['restarting', true, 'off'],
  ['stopped', true, 'off'],
  ['starting', true, 'off'],
  [undefined, true, 'off'],
  // The bug this gate exists for: phase says working, but the body is still
  // walking to the desk, so the screen has to stay dark.
  ['working', false, 'off'],
  ['ready', false, 'off'],
  ['blocked', false, 'off'],
  ['idle', false, 'off'],
  [undefined, false, 'off'],
];

let failed = 0;
for (const [phase, seated, want] of cases) {
  const got = monitorStateFor(phase, seated);
  const ok = got === want;
  if (!ok) failed++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'} phase=${String(phase).padEnd(10)} seated=${String(seated).padEnd(5)} want=${want.padEnd(7)} got=${got}`,
  );
}

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const world = read('../src/office/World.ts');
const assets = read('../src/office/AssetGenerator.ts');

// Source guards: the rule must survive a future edit of any of the three files.
const guards = [
  [
    'World.ts gates on Character.state === "sit" on the same seat',
    /const seated = [^;]*state === 'sit'[^;]*seat === seat;/.test(world),
  ],
  ['World.ts decides the screen through monitorStateFor()', /monitorStateFor\(/.test(world)],
  [
    'World.ts draws the grey screen for the waiting state',
    /state === 'waiting'[\s\S]{0,80}assets\.monitorWaiting/.test(world),
  ],
  ['AssetGenerator.ts exposes a distinct waiting texture', /monitorWaiting: makeMonitor\('waiting'\)/.test(assets)],
  ['AssetGenerator.ts paints the waiting screen grey', /mode === 'waiting'[\s\S]{0,200}#6f7887/.test(assets)],
  [
    'World.ts keeps a blocked agent from typing at the desk',
    /ch\.typing = ch\.typing \|\| \(owesDesk && seat\?\.kind === 'desk' && emp\?\.phase !== 'blocked'\)/.test(world),
  ],
];
for (const [label, ok] of guards) {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
}

if (failed) {
  console.error(`\n${failed} monitor check(s) failed.`);
  process.exit(1);
}
console.log('\nAll monitor checks passed: screen lights only after the agent is seated.');
