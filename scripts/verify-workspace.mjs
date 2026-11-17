// Verifies the workspace-footprint feature end to end:
//   - the measurement walker stays inside ~/OpenBot/Agents and never follows symlinks
//   - every live profile carries a byte count, and the raw path never leaves the server
//   - the browser formats the number and the canvas resolves a computer click to its agent
// Run with: node scripts/verify-workspace.mjs
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import {
  MAX_ENTRIES,
  WORKSPACE_ROOT,
  walkFolder,
  workspacePathInside,
} from '../src/data/workspaceSize.node.ts';
import { fetchAgentProfiles, closeOpenBotDb } from '../src/data/openbotSource.node.ts';
import { formatBytes } from '../src/constants.ts';

let fail = 0;
const check = (label, ok, extra = '') => {
  if (!ok) fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
};

// 1. Boundary: only absolute folders strictly inside the Agents root qualify.
check('Agents root is under $HOME/OpenBot', WORKSPACE_ROOT.endsWith('/OpenBot/Agents'), WORKSPACE_ROOT);
check('relative path is rejected', workspacePathInside('Agents/agent-x') === null);
check('empty path is rejected', workspacePathInside('') === null && workspacePathInside(null) === null);
check('the Agents root itself is rejected', workspacePathInside(WORKSPACE_ROOT) === null);
check('a path outside the root is rejected', workspacePathInside('/etc') === null);
check('traversal out of the root is rejected', workspacePathInside(`${WORKSPACE_ROOT}/../Secrets`) === null);
check('entry budget is bounded', MAX_ENTRIES > 0 && MAX_ENTRIES <= 100_000, `${MAX_ENTRIES}`);

// 2. The walker skips symlinks and counts only regular files. A temp folder is
//    used, then removed; nothing is written inside the repo.
const tmp = mkdtempSync(join(tmpdir(), 'ovo-workspace-'));
try {
  writeFileSync(join(tmp, 'payload.bin'), Buffer.alloc(1024));
  writeFileSync(join(tmp, 'notes.txt'), Buffer.alloc(256));
  symlinkSync('/etc/hosts', join(tmp, 'escape-link'));
  const walked = walkFolder(tmp);
  check('walker sums regular files only', walked.bytes === 1280, `${walked.bytes} bytes`);
  check('walker does not follow a symlink', walked.bytes < 2000, `${walked.bytes} bytes`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// 3. Live DB: every profile reports a number or an explicit null, never a path.
const profiles = fetchAgentProfiles();
const measured = profiles.filter((p) => typeof p.workspaceBytes === 'number');
check('live profiles return a byte count', measured.length > 0, `${measured.length}/${profiles.length}`);
check(
  'byte counts are non-negative integers',
  measured.every((p) => Number.isInteger(p.workspaceBytes) && p.workspaceBytes >= 0),
);
check(
  'no profile reports zero for a real folder',
  measured.every((p) => p.workspaceBytes > 0),
  `min ${Math.min(...measured.map((p) => p.workspaceBytes))} bytes`,
);
check(
  'every profile has the key (number or null)',
  profiles.every((p) => p.workspaceBytes === null || typeof p.workspaceBytes === 'number'),
);

const serialised = JSON.stringify(profiles);
check('the payload never carries workspacePath', !/workspacePath|workspace_path/.test(serialised));
check('the payload never carries an absolute Agents path', !serialised.includes(WORKSPACE_ROOT));
console.log(
  '  sizes: ' + profiles.map((p) => `${p.name}=${formatBytes(p.workspaceBytes)}`).join(', '),
);
closeOpenBotDb();

// 4. Source guards across the hops.
const plugin = readFileSync(new URL('../vite-plugin-openbot.ts', import.meta.url), 'utf8');
check('/api/agents forwards workspaceBytes explicitly', /workspaceBytes:\s*p\.workspaceBytes/.test(plugin));
check('/api/agents still never names the raw path field', !/workspacePath/.test(plugin));

const nodeSource = readFileSync(new URL('../src/data/openbotSource.node.ts', import.meta.url), 'utf8');
check('DB schema parses workspacePath for measurement', /workspacePath:\s*z\.string\(\)\.max\(1024\)\.nullish\(\)/.test(nodeSource));
check('DB layer measures the workspace, not the browser', /workspaceBytes:\s*measureWorkspaceFootprint\(/.test(nodeSource));

const clientSource = readFileSync(new URL('../src/data/openbotSource.ts', import.meta.url), 'utf8');
check('client boundary validates workspaceBytes', /workspaceBytes:\s*z\.number\(\)\.int\(\)\.nonnegative\(\)\.nullable\(\)/.test(clientSource));
check('client keeps no path field', !/workspacePath/.test(clientSource));

const panel = readFileSync(new URL('../src/components/CharacterInfo.tsx', import.meta.url), 'utf8');
check('info panel renders the disk fact', /<dt>Disk<\/dt>/.test(panel) && /formatBytes\(emp\.workspaceBytes\)/.test(panel));

const world = readFileSync(new URL('../src/office/World.ts', import.meta.url), 'utf8');
check('canvas resolves a computer click to its seat', /pickDesk\(/.test(world) && /currentWorkstation === seat\.id/.test(world));
check('pointer handlers use the combined pick', /select\(this\.pickEmployeeId\(e\)\)/.test(world));

// 5. Number formatting: short, honest, never a guess for a missing value.
const cases = [
  [null, '—'],
  [undefined, '—'],
  [0, '0 B'],
  [512, '512 B'],
  [1024, '1 KB'],
  [4.3 * 1024 * 1024, '4.3 MB'],
  [33 * 1024 * 1024 + 0.2 * 1024 * 1024, '33 MB'],
  [1024 * 1024 * 1024, '1 GB'],
];
for (const [input, want] of cases) {
  const got = formatBytes(input);
  check(`formatBytes(${String(input)}) = ${want}`, got === want, got);
}
check('negative bytes are not shown as a size', formatBytes(-1) === '—');

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
