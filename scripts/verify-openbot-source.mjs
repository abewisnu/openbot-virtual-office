// Verifies the real OpenBot data source end-to-end against the live DB.
// Run with: node scripts/verify-openbot-source.mjs
// Exits non-zero when the source cannot produce agents, or when a live DB
// still yields nothing but 'idle' (the regression this gate exists for).
import { fetchAgentProfiles, closeOpenBotDb } from '../src/data/openbotSource.node.ts';

const profiles = fetchAgentProfiles();

console.log(`Found ${profiles.length} agents from the real DB.\n`);
console.log(
  ['name', 'phase', 'activity', 'shirt', 'unread', 'disk'].map((h) => h.padEnd(20)).join(''),
);
console.log('-'.repeat(90));

const phaseOrder = {
  working: 0,
  blocked: 1,
  restarting: 2,
  ready: 3,
  starting: 4,
  idle: 5,
  stopped: 6,
};
const sorted = [...profiles].sort(
  (a, b) => phaseOrder[a.phase] - phaseOrder[b.phase] || a.name.localeCompare(b.name),
);
for (const p of sorted) {
  const act = p.activity ? `${p.activity.kind}(${p.activity.variant ?? '-'})` : '-';
  console.log(
    [
      p.name.slice(0, 18).padEnd(20),
      p.phase.padEnd(20),
      act.padEnd(20),
      (p.avatarColor ?? `hue ${p.avatarHue}`).padEnd(20),
      String(p.unreadCount).padEnd(20),
      (p.workspaceBytes === null ? '—' : `${(p.workspaceBytes / 1024 / 1024).toFixed(1)} MB`).padEnd(20),
    ].join(''),
  );
}

const byPhase = {};
for (const p of profiles) byPhase[p.phase] = (byPhase[p.phase] ?? 0) + 1;
console.log('\nPhase distribution:', byPhase);
const withActivity = profiles.filter((p) => p.activity).length;
console.log(`Agents with a visible activity: ${withActivity}/${profiles.length}`);

closeOpenBotDb();

let failed = false;
if (profiles.length === 0) {
  console.error('\nFAIL: no agents returned');
  failed = true;
}
if (profiles.length > 0 && (byPhase.working ?? 0) === 0 && (byPhase.ready ?? 0) === 0) {
  console.error('\nFAIL: live DB produced no working/ready agent — phase derivation is broken');
  failed = true;
}
const sized = profiles.filter((p) => typeof p.workspaceBytes === 'number' && p.workspaceBytes > 0).length;
console.log(`Agents with a measured workspace: ${sized}/${profiles.length}`);
if (profiles.length > 0 && sized === 0) {
  console.error('\nFAIL: no workspace folder could be measured');
  failed = true;
}
if (!failed) console.log('\nPASS');
process.exit(failed ? 1 : 0);
