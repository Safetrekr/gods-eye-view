// Contours for the storm shells (phase 12 revision): the outline of every
// area at or above a reflectivity threshold, smoothed into an organic shape.
// Boundary tracing on the cell grid (each lit cell's outside edges, linked
// into loops), the outer loop kept (holes are filled: a shell is a solid),
// then Chaikin corner cutting and a light simplification. Pure.

/**
 * Outer loops of the areas where value ≥ threshold (8-connected corners are
 * resolved consistently). Loops are in cell-corner coordinates (x right,
 * y down), counter-clockwise on screen, and closed implicitly.
 * Returns [{loop: [[x, y], ...], cells, max, top}] largest first; `top` is
 * the highest value of `tops` (if given) inside the area.
 */
export function traceAreas(
  data,
  w,
  h,
  threshold,
  { tops = null, minCells = 4 } = {},
) {
  const lit = (x, y) =>
    x >= 0 && y >= 0 && x < w && y < h && data[y * w + x] >= threshold;
  // Label the areas first (4-connected), so each loop knows its cells.
  const label = new Int32Array(w * h).fill(-1);
  const areas = [];
  const stack = [];
  for (let i = 0; i < w * h; i++) {
    if (label[i] !== -1 || data[i] < threshold) continue;
    const id = areas.length;
    const a = { cells: 0, max: 0, top: 0, edges: new Map() };
    areas.push(a);
    label[i] = id;
    stack.push(i);
    while (stack.length) {
      const j = stack.pop();
      const x = j % w;
      const y = (j - x) / w;
      a.cells++;
      if (data[j] > a.max) a.max = data[j];
      if (tops && tops[j] > a.top) a.top = tops[j];
      for (const [nx, ny] of [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ]) {
        if (!lit(nx, ny)) continue;
        const k = ny * w + nx;
        if (label[k] === -1) {
          label[k] = id;
          stack.push(k);
        }
      }
    }
  }
  // Directed boundary edges, outside on the right: top, right, bottom, left.
  const key = (x, y) => y * (w + 1) + x;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const id = label[y * w + x];
      if (id < 0) continue;
      const e = areas[id].edges;
      if (!lit(x, y - 1)) e.set(key(x + 1, y), [x + 1, y, x, y]); // top: → left
      if (!lit(x + 1, y)) e.set(key(x + 1, y + 1), [x + 1, y + 1, x + 1, y]);
      if (!lit(x, y + 1)) e.set(key(x, y + 1), [x, y + 1, x + 1, y + 1]);
      if (!lit(x - 1, y)) e.set(key(x, y), [x, y, x, y + 1]);
    }
  // A start corner can carry two edges (diagonal contact); keep a list.
  const out = [];
  for (const a of areas) {
    if (a.cells < minCells) continue;
    const byStart = new Map();
    for (const [, [sx, sy, ex, ey]] of a.edges) {
      const k = key(sx, sy);
      if (!byStart.has(k)) byStart.set(k, []);
      byStart.get(k).push([ex, ey]);
    }
    const loops = [];
    while (byStart.size) {
      const [startK, list] = byStart.entries().next().value;
      let cx = startK % (w + 1);
      let cy = Math.floor(startK / (w + 1));
      const loop = [[cx, cy]];
      let next = list.pop();
      if (!list.length) byStart.delete(startK);
      let guard = 0;
      while (next && guard++ < 1e6) {
        [cx, cy] = next;
        const k = key(cx, cy);
        if (k === startK) break;
        loop.push([cx, cy]);
        const l = byStart.get(k);
        if (!l) break;
        next = l.pop();
        if (!l.length) byStart.delete(k);
      }
      if (loop.length >= 4) loops.push(loop);
    }
    // The outer loop has the largest absolute area.
    loops.sort((p, q) => Math.abs(signedArea(q)) - Math.abs(signedArea(p)));
    if (loops.length)
      out.push({ loop: loops[0], cells: a.cells, max: a.max, top: a.top });
  }
  return out.sort((p, q) => q.cells - p.cells);
}

export function signedArea(loop) {
  let s = 0;
  for (let i = 0; i < loop.length; i++) {
    const [x1, y1] = loop[i];
    const [x2, y2] = loop[(i + 1) % loop.length];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

/** Chaikin corner cutting on a closed loop (n iterations). */
export function chaikin(loop, n = 2) {
  let pts = loop;
  for (let k = 0; k < n; k++) {
    const next = [];
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[(i + 1) % pts.length];
      next.push([0.75 * x1 + 0.25 * x2, 0.75 * y1 + 0.25 * y2]);
      next.push([0.25 * x1 + 0.75 * x2, 0.25 * y1 + 0.75 * y2]);
    }
    pts = next;
  }
  return pts;
}

/** Drop points closer than minStep to the last kept one (cells). */
export function thinLoop(loop, minStep = 0.6, max = 400) {
  const out = [];
  for (const p of loop) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) >= minStep) out.push(p);
  }
  if (out.length <= max) return out;
  const step = Math.ceil(out.length / max);
  return out.filter((_, i) => i % step === 0);
}

/** Smooth outline of an area: trace → Chaikin → thin. */
export const smoothLoop = (loop) => thinLoop(chaikin(loop, 3));
