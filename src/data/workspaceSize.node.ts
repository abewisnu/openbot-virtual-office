// Node-only: measures how much disk an agent's workspace folder uses.
//
// `projection_agents.agent_json.workspacePath` names a folder under
// `~/OpenBot/Agents/agent-<uuid>`. That path never leaves this process: the API
// forwards only the byte count (see `workspaceBytes` in openbotSource.node.ts),
// because a machine path is not something the browser needs.
//
// The walk is read-only and bounded: no symlinks are followed, at most
// MAX_ENTRIES directory entries are visited per folder, and results are cached
// for CACHE_TTL_MS so the 3 s roster poll does not re-walk 16 folders.

import { lstatSync, readdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve, sep } from 'node:path';

/** Only folders inside this root are measurable. */
export const WORKSPACE_ROOT = resolve(homedir(), 'OpenBot', 'Agents');

const CACHE_TTL_MS = 60_000;
/** Entry budget per folder: a runaway workspace cannot stall the API. */
export const MAX_ENTRIES = 20_000;
const MAX_DEPTH = 24;
const CACHE_MAX = 64;

const cache = new Map<string, { at: number; bytes: number | null }>();

function realRoot(): string {
  try {
    return realpathSync(WORKSPACE_ROOT);
  } catch {
    return WORKSPACE_ROOT;
  }
}

/**
 * Accepts a raw `agent_json.workspacePath` and returns the absolute folder to
 * measure, or `null` when it is relative, outside the Agents root, a symlink
 * that escapes the root, or not a directory. Boundary check, not a duck-check.
 */
export function workspacePathInside(candidate: string | null | undefined): string | null {
  if (!candidate || typeof candidate !== 'string' || !isAbsolute(candidate)) return null;
  const abs = resolve(candidate);
  if (abs === WORKSPACE_ROOT || !abs.startsWith(WORKSPACE_ROOT + sep)) return null;
  try {
    if (!lstatSync(abs).isDirectory()) return null;
    const real = realpathSync(abs);
    if (!real.startsWith(realRoot() + sep)) return null;
    return abs;
  } catch {
    return null;
  }
}

export interface WalkResult {
  bytes: number;
  entries: number;
}

/**
 * Sums regular-file sizes below `root` without following symlinks. Exported for
 * the gate script; callers in the app must go through `measureWorkspaceFootprint`
 * so the Agents-root boundary always applies.
 */
export function walkFolder(root: string): WalkResult {
  let bytes = 0;
  let entries = 0;
  const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];

  while (stack.length) {
    const next = stack.pop();
    if (!next) break;
    let dirents;
    try {
      dirents = readdirSync(next.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const dirent of dirents) {
      entries += 1;
      if (entries > MAX_ENTRIES) return { bytes, entries };
      const path = join(next.dir, dirent.name);
      if (dirent.isSymbolicLink()) continue;
      if (dirent.isDirectory()) {
        if (next.depth < MAX_DEPTH) stack.push({ dir: path, depth: next.depth + 1 });
        continue;
      }
      if (!dirent.isFile()) continue;
      try {
        bytes += lstatSync(path).size;
      } catch {
        /* a file that vanished mid-walk contributes nothing */
      }
    }
  }

  return { bytes, entries };
}

/**
 * Disk footprint of one agent workspace in bytes, or `null` when the path is
 * missing, outside the Agents root, or unreadable. Cached for CACHE_TTL_MS.
 */
export function measureWorkspaceFootprint(candidate: string | null | undefined): number | null {
  const root = workspacePathInside(candidate);
  if (!root) return null;

  const hit = cache.get(root);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.bytes;

  let bytes: number | null = null;
  try {
    bytes = walkFolder(root).bytes;
  } catch {
    bytes = null;
  }

  if (cache.size >= CACHE_MAX) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) cache.delete(oldest[0]);
  }
  cache.set(root, { at: Date.now(), bytes });
  return bytes;
}

/** Test hook: clears the measurement cache. */
export function clearWorkspaceFootprintCache(): void {
  cache.clear();
}
