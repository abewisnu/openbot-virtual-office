// Runs every gate in scripts/verify-*.mjs with the invocation each one needs and
// prints a summary. Stops at the first failure so a red gate cannot hide behind
// later green ones.
//
// Every script is launched with `--import ./scripts/register-ts.mjs`: four of them
// import `.ts` modules through extensionless specifiers and fail with
// ERR_MODULE_NOT_FOUND without the hook, and the rest tolerate the extra hook.
//
// Run with: npm run verify
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const scriptsDir = join(root, 'scripts');
const SELF = 'verify-all.mjs';

const gates = readdirSync(scriptsDir)
  .filter((name) => /^verify-.*\.mjs$/.test(name) && name !== SELF)
  .sort();

if (gates.length === 0) {
  console.error('verify: no scripts/verify-*.mjs found');
  process.exit(1);
}

const started = Date.now();
const results = [];
let failed = null;

for (const gate of gates) {
  const rel = relative(root, join(scriptsDir, gate));
  process.stdout.write(`\n=== ${rel} ===\n`);
  const run = spawnSync(
    process.execPath,
    ['--import', './scripts/register-ts.mjs', rel],
    { cwd: root, stdio: 'inherit' },
  );
  const status = run.status ?? 1;
  results.push({ gate, status });
  if (status !== 0) {
    failed = { gate, status };
    break;
  }
}

const seconds = ((Date.now() - started) / 1000).toFixed(1);
console.log('\n=== summary ===');
for (const { gate, status } of results) {
  console.log(`${status === 0 ? 'PASS' : 'FAIL'}  ${gate}`);
}
const skipped = gates.length - results.length;
if (skipped > 0) console.log(`SKIP  ${skipped} gate(s) not run after the first failure`);

if (failed) {
  console.error(
    `\nverify: FAILED at ${failed.gate} (exit ${failed.status}) after ${results.length}/${gates.length} gates, ${seconds}s`,
  );
  process.exit(failed.status || 1);
}

console.log(`\nverify: PASS ${results.length}/${gates.length} gates in ${seconds}s`);
