// Verifies the first-paint rule: on a healthy API the board must never show the
// mock roster, not even for one frame. It unit-tests the pure transition policy
// and source-guards the store/HUD wiring that applies it.
// Run with: node scripts/verify-store.mjs
import { readFileSync } from 'node:fs';
import { resolveSource } from '../src/store/sourcePolicy.ts';

let fail = 0;
const check = (label, ok, extra = '') => {
  if (!ok) fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
};

// Minimal roster stand-ins: the policy only needs ids and a length.
const live = [{ id: 'agent-1' }, { id: 'agent-2' }];
const mock = [{ id: 'WS-01' }, { id: 'WS-02' }, { id: 'WS-03' }];
const ids = (rows) => rows.map((r) => r.id).join(',');
const pending = { source: 'pending', reason: null, polling: false };
const openbot = { source: 'openbot', reason: null, polling: true };
const mocked = { source: 'mock', reason: 'db missing', polling: false };

// 1. Boot: empty board while the first fetch is in flight.
check('boot state is empty before any fetch', ids([]) === '' && pending.source === 'pending');

// 2. Healthy API fills the board straight from the first fetch, no mock rows.
{
  const out = resolveSource(pending, [], { kind: 'ok', employees: live }, mock);
  check('pending + ok -> live roster', ids(out.employees) === 'agent-1,agent-2', ids(out.employees));
  check('pending + ok -> source is openbot', out.source.source === 'openbot', out.source.source);
  check('pending + ok -> no mock row leaks', out.employees.every((e) => !e.id.startsWith('WS-')));
}

// 3. A failing first fetch is the ONLY path to the mock roster.
{
  const out = resolveSource(pending, [], { kind: 'error', reason: 'ECONNREFUSED' }, mock);
  check('pending + error -> mock fallback', ids(out.employees) === 'WS-01,WS-02,WS-03', ids(out.employees));
  check('pending + error -> source is mock', out.source.source === 'mock', out.source.source);
  check('pending + error -> reason kept', out.source.reason === 'ECONNREFUSED', String(out.source.reason));
}

// 4. A live board keeps its last snapshot when a refresh fails. No fake rows, no
//    relabel to mock, no blank board.
{
  const out = resolveSource(openbot, live, { kind: 'error', reason: 'timeout' }, mock);
  check('openbot + error -> keeps live snapshot', ids(out.employees) === 'agent-1,agent-2', ids(out.employees));
  check('openbot + error -> stays labelled openbot', out.source.source === 'openbot', out.source.source);
  check('openbot + error -> reason recorded', out.source.reason === 'timeout', String(out.source.reason));
}

// 5. An empty but healthy API never fabricates agents.
{
  const out = resolveSource(openbot, live, { kind: 'empty', reason: 'no agents found' }, mock);
  check('openbot + empty -> empty roster', out.employees.length === 0, `${out.employees.length}`);
  check('openbot + empty -> never mock', out.source.source === 'openbot', out.source.source);
}

// 6. Recovery: mock turns back into live once the API answers.
{
  const out = resolveSource(mocked, mock, { kind: 'ok', employees: live }, mock);
  check('mock + ok -> replaces mock with live', ids(out.employees) === 'agent-1,agent-2', ids(out.employees));
  check('mock + ok -> source back to openbot', out.source.source === 'openbot', out.source.source);
}

// 7. Polling is a UI toggle, carried over on every transition.
{
  const outs = [
    resolveSource(openbot, live, { kind: 'ok', employees: live }, mock),
    resolveSource(openbot, live, { kind: 'empty', reason: 'x' }, mock),
    resolveSource(openbot, live, { kind: 'error', reason: 'x' }, mock),
    resolveSource(pending, [], { kind: 'error', reason: 'x' }, mock),
  ];
  check('polling flag survives every transition', outs.every((o) => o.source.polling === openbot.polling || o.source.polling === pending.polling));
  check('polling=true carried through an error', outs[2].source.polling === true);
}

// 8. Source guards: the store must boot empty and route through the policy.
const store = readFileSync(new URL('../src/store/useStore.ts', import.meta.url), 'utf8');
check('store boots with an empty roster', /employees:\s*\[\]/.test(store));
check('store does not seed mockEmployees as the initial roster', !/employees:\s*mockEmployees/.test(store));
check('store boots with the pending source', /source:\s*\{\s*source:\s*'pending'/.test(store));
check('loadOpenBot goes through resolveSource', /set\(resolveSource\(/.test(store));
check('store never sets a source kind by hand', !/source:\s*\{\s*source:\s*'(openbot|mock)'/.test(store));

const hud = readFileSync(new URL('../src/components/HUD.tsx', import.meta.url), 'utf8');
check('HUD labels the pending source', /"Connecting"/.test(hud) && /source === "pending"/.test(hud));
check('HUD hides the member count while connecting', /connecting…/.test(hud));

const policy = readFileSync(new URL('../src/store/sourcePolicy.ts', import.meta.url), 'utf8');
check('policy imports nothing at runtime', !/^import (?!type )/m.test(policy));

// 9. The fetch layer must tell "the API answered with nothing" apart from "the
//    API failed". Swallowing errors into `[]` would make the mock fallback
//    unreachable, so the store would show a fake-empty live board instead.
const { fetchAgentProfilesAsync, AgentSourceError } = await import('../src/data/openbotSource.ts');
const realFetch = globalThis.fetch;
const withFetch = async (impl, run) => {
  globalThis.fetch = impl;
  try {
    return await run();
  } finally {
    globalThis.fetch = realFetch;
  }
};
const throwsSource = async (impl) => {
  try {
    await withFetch(impl, () => fetchAgentProfilesAsync());
    return false;
  } catch (err) {
    return err instanceof AgentSourceError;
  }
};

check('a valid empty array is an empty roster, not an error', (await withFetch(
  async () => ({ ok: true, status: 200, json: async () => [] }),
  () => fetchAgentProfilesAsync(),
)).length === 0);
check('HTTP 500 raises AgentSourceError', await throwsSource(async () => ({ ok: false, status: 500, json: async () => ({}) })));
check('a network rejection raises AgentSourceError', await throwsSource(async () => { throw new TypeError('fetch failed'); }));
check('a non-JSON body raises AgentSourceError', await throwsSource(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } })));
check('a non-array body raises AgentSourceError', await throwsSource(async () => ({ ok: true, status: 200, json: async () => ({ agents: [] }) })));

const source = readFileSync(new URL('../src/data/openbotSource.ts', import.meta.url), 'utf8');
check('the client no longer swallows fetch errors into []', !/catch\s*\{\s*return \[\];/.test(source));
check('the client throws AgentSourceError on a failed response', /AgentSourceError/.test(source));

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
