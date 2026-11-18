// Verifies the real OpenBot data source end-to-end.
// Run with: node scripts/verify-openbot-source.mjs
//
// Two modes, same assertions:
//   live    — the OpenBot DB on this machine exists, so it is read as-is. This is
//             the regression gate: a live DB that yields nothing but 'idle' fails.
//   fixture — no OpenBot install (CI, a fresh contributor clone). A throwaway
//             SQLite file is built in the temp dir with the same schema the
//             derivation reads, so the phase/activity/disk logic is still
//             exercised instead of the gate silently passing.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import {
  fetchAgentProfiles,
  closeOpenBotDb,
  resolveDbPath,
  STATUS_WINDOW_MS,
} from '../src/data/openbotSource.node.ts';

// ---------------------------------------------------------------------------
// Fixture mode: only used when the machine has no OpenBot database
// ---------------------------------------------------------------------------

/**
 * Builds the smallest DB the derivation understands and points the module at it.
 * Bump `statusMs` per row to place an agent on either side of the 90 s window.
 */
function buildFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'ovo-verify-'));
  const dbPath = join(dir, 'openbot.db');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE projection_agents (
      agent_id TEXT PRIMARY KEY, sort_order INTEGER, thread_id TEXT, agent_json TEXT
    );
    CREATE TABLE agent_usage_activity (agent_id TEXT, occurred_at TEXT);
    CREATE TABLE projection_provider_sessions (
      thread_id TEXT, state TEXT, updated_at TEXT, last_event_sequence INTEGER
    );
    CREATE TABLE projection_threads (
      thread_id TEXT, agent_id TEXT, active_turn_id TEXT
    );
    CREATE TABLE agent_waits (agent_id TEXT, woken_at TEXT);
    CREATE TABLE projection_thread_activities (
      thread_id TEXT, activity_type TEXT, created_at TEXT
    );
    CREATE TABLE projection_deliveries (
      recipient_agent_id TEXT, status TEXT, created_at TEXT
    );
    CREATE TABLE projection_thread_reads (
      thread_id TEXT, member_id TEXT, through_message_id TEXT
    );
    CREATE TABLE projection_thread_messages (
      thread_id TEXT, message_id TEXT, ordinal INTEGER
    );
  `);

  const now = Date.now();
  const iso = (msAgo) => new Date(now - msAgo).toISOString();
  const agent = (id, order, name, workspacePath) => ({
    id,
    order,
    name,
    json: JSON.stringify({
      name,
      title: 'fixture',
      provider: 'fixture',
      model: 'fixture',
      avatarHue: 200,
      workspacePath,
    }),
  });

  // One workspace folder per agent so the disk measurement has real bytes to walk.
  // The measurement only accepts paths under `~/OpenBot/Agents`, so the fixture
  // folders go there and are removed with the rest of the fixture afterwards.
  const workspaceRoot = join(homedir(), 'OpenBot', 'Agents', `ovo-verify-${process.pid}`);
  const workspaces = ['a', 'b', 'c', 'd'].map((tag) => {
    const p = join(workspaceRoot, `workspace-${tag}`);
    mkdirSync(p, { recursive: true });
    writeFileSync(join(p, 'note.txt'), 'x'.repeat(2048));
    return p;
  });

  const rows = [
    agent('a-working', 0, 'Fixture Working', workspaces[0]),
    agent('b-blocked', 1, 'Fixture Blocked', workspaces[1]),
    agent('c-ready', 2, 'Fixture Ready', workspaces[2]),
    agent('d-stopped', 3, 'Fixture Stopped', workspaces[3]),
  ];

  const insertAgent = db.prepare(
    `INSERT INTO projection_agents (agent_id, sort_order, thread_id, agent_json) VALUES (?, ?, ?, ?)`,
  );
  for (const r of rows) insertAgent.run(r.id, r.order, `thread-${r.id}`, r.json);

  // Sessions are joined through projection_threads, and a thread row is also what
  // makes `active_turn_id` readable, so every fixture agent needs one.
  const insertThread = db.prepare(
    `INSERT INTO projection_threads (thread_id, agent_id, active_turn_id) VALUES (?, ?, NULL)`,
  );
  for (const r of rows) insertThread.run(`thread-${r.id}`, r.id);

  // Fresh traffic inside the 90 s window → 'working'.
  db.prepare(`INSERT INTO agent_usage_activity (agent_id, occurred_at) VALUES (?, ?)`).run(
    'a-working',
    iso(1000),
  );
  db.prepare(
    `INSERT INTO projection_provider_sessions (thread_id, state, updated_at, last_event_sequence) VALUES (?, ?, ?, ?)`,
  ).run('thread-a-working', 'active', iso(1000), 5);

  // A live wait marker → 'blocked'.
  db.prepare(`INSERT INTO agent_waits (agent_id, woken_at) VALUES (?, NULL)`).run('b-blocked');
  db.prepare(
    `INSERT INTO projection_provider_sessions (thread_id, state, updated_at, last_event_sequence) VALUES (?, ?, ?, ?)`,
  ).run('thread-b-blocked', 'active', iso(1000), 2);

  // An alive session with no traffic yet → 'ready'.
  db.prepare(
    `INSERT INTO projection_provider_sessions (thread_id, state, updated_at, last_event_sequence) VALUES (?, ?, ?, ?)`,
  ).run('thread-c-ready', 'active', iso(2000), 1);

  db.close();
  return { dir, dbPath, workspaceRoot };
}

const livePath = resolveDbPath();
const hasLiveDb = (() => {
  try {
    // Any open error means "no usable live DB"; the fixture covers this run.
    new Database(livePath, { readonly: true, fileMustExist: true }).close();
    return true;
  } catch {
    return false;
  }
})();

const fixture = hasLiveDb ? null : buildFixture();
if (fixture) {
  process.env.OPENBOT_DB_PATH = fixture.dbPath;
  console.log(`No live OpenBot DB at ${livePath} — running against a fixture instead.\n`);
}

const profiles = fetchAgentProfiles();

console.log(`Found ${profiles.length} agents from the ${fixture ? 'fixture' : 'real'} DB.\n`);
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
if (fixture) {
  rmSync(fixture.dir, { recursive: true, force: true });
  rmSync(fixture.workspaceRoot, { recursive: true, force: true });
}

let failed = false;
if (profiles.length === 0) {
  console.error('\nFAIL: no agents returned');
  failed = true;
}
if (profiles.length > 0 && (byPhase.working ?? 0) === 0 && (byPhase.ready ?? 0) === 0) {
  console.error('\nFAIL: DB produced no working/ready agent — phase derivation is broken');
  failed = true;
}
const sized = profiles.filter((p) => typeof p.workspaceBytes === 'number' && p.workspaceBytes > 0).length;
console.log(`Agents with a measured workspace: ${sized}/${profiles.length}`);
if (profiles.length > 0 && sized === 0) {
  console.error('\nFAIL: no workspace folder could be measured');
  failed = true;
}

// The fixture pins the exact expected mix, so a regression in the priority order
// of derivePhase() cannot pass just because *some* phase still shows up.
if (fixture) {
  const expected = { working: 1, blocked: 1, ready: 1, stopped: 1 };
  const got = Object.fromEntries(Object.entries(byPhase).sort());
  const want = Object.fromEntries(Object.entries(expected).sort());
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    console.error(`\nFAIL: fixture phase mix ${JSON.stringify(got)} != ${JSON.stringify(want)}`);
    failed = true;
  } else {
    console.log(`PASS fixture phase mix matches ${JSON.stringify(want)}`);
  }
  const working = profiles.find((p) => p.name === 'Fixture Working');
  if (working?.activity?.kind !== 'responded') {
    console.error(`\nFAIL: fresh usage should surface 'responded', got ${working?.activity?.kind}`);
    failed = true;
  } else {
    console.log('PASS fresh usage surfaces the responded activity');
  }
  const blocked = profiles.find((p) => p.name === 'Fixture Blocked');
  if (blocked?.activity?.kind !== 'waiting') {
    console.error(`\nFAIL: open wait should surface 'waiting', got ${blocked?.activity?.kind}`);
    failed = true;
  } else {
    console.log('PASS open wait surfaces the waiting activity');
  }
  console.log(`\nWindow under test: STATUS_WINDOW_MS=${STATUS_WINDOW_MS}`);
}

if (!failed) console.log('\nPASS');
process.exit(failed ? 1 : 0);
