export interface Tile { tx: number; ty: number }
/** BFS 4-arah pada grid collision. */
export function findPath(blocked: boolean[][], s: Tile, g: Tile): Tile[] | null {
  const rows = blocked.length, cols = blocked[0].length;
  if (blocked[g.ty]?.[g.tx]) return null;
  const prev = new Int32Array(rows * cols).fill(-2);
  const si = s.ty * cols + s.tx, gi = g.ty * cols + g.tx;
  prev[si] = -1;
  const q = [si];
  for (let h = 0; h < q.length; h++) {
    const cur = q[h];
    if (cur === gi) break;
    const cx = cur % cols, cy = (cur / cols) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || blocked[ny][nx]) continue;
      const ni = ny * cols + nx;
      if (prev[ni] !== -2) continue;
      prev[ni] = cur; q.push(ni);
    }
  }
  if (prev[gi] === -2) return null;
  const out: Tile[] = [];
  for (let c = gi; c !== -1; c = prev[c]) out.push({ tx: c % cols, ty: (c / cols) | 0 });
  return out.reverse();
}
