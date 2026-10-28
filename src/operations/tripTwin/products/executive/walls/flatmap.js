// SafeTrekr Executive B3/B4a: the flat maps (no Cesium). The roster map
// (seven cities on a quiet land outline, every person a mark), MAIN's
// neutral field, and the fallback when the person's venue has no site twin
// (SWIFT at IAD). SVG built with the DOM; no basemap tiles. The land is
// Natural Earth (public domain, credited); paths carry the OSM notice.
import { div, el, span } from './dom.js';
import { landPath, projection, rosterLayout, ROSTER_BOX } from './geo.js';

const NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};

/** One person's mark: protection by shape, freshness by ring, posture by bars. */
export function mark(p, { label = true } = {}) {
  const m = div(
    `tt-mark prot-${p.protection.toLowerCase()} fresh-${p.fresh}${p.raised ? ' raised' : ''}${p.detailAgent ? ' agent' : ''}`,
  );
  const glyph = span('glyph');
  glyph.append(span('dot'));
  m.append(glyph);
  if (label) {
    m.append(span('cs', p.callsign));
    const b = span(`tt-bars p-${p.posture.toLowerCase()}`);
    for (let i = 1; i <= 4; i++) b.append(span(i <= p.bars ? 'on' : 'off'));
    m.append(b);
  }
  return m;
}

/**
 * The roster map: a quiet land outline (Natural Earth, from the repo),
 * each city's dot at its true projected place, a panel of marks per city
 * beside it, and a hairline from the dot to the panel's facing edge.
 */
export function rosterMap(view) {
  const box = ROSTER_BOX;
  const proj = projection(box);
  const layout = new Map(rosterLayout(view.cities).map((l) => [l.name, l]));
  const wrap = div('ex-rmap');
  const svg = svgEl('svg', {
    viewBox: `0 0 ${box.w} ${box.h}`,
    preserveAspectRatio: 'none',
    class: 'ex-rmap-geo',
    'aria-hidden': 'true',
  });
  // A faint 30° graticule, then the land.
  for (let lon = -90; lon <= 60; lon += 30)
    svg.append(
      svgEl('line', {
        x1: proj.x(lon),
        x2: proj.x(lon),
        y1: 0,
        y2: box.h,
        class: 'g',
      }),
    );
  for (let lat = 0; lat <= 60; lat += 30)
    svg.append(
      svgEl('line', {
        x1: 0,
        x2: box.w,
        y1: proj.y(lat),
        y2: proj.y(lat),
        class: 'g',
      }),
    );
  svg.append(svgEl('path', { d: landPath(proj), class: 'land' }));
  for (const c of view.cities) {
    const l = layout.get(c.name);
    if (!l) continue;
    const raised = c.people.some((p) => p.raised);
    svg.append(
      svgEl('line', {
        x1: l.lead.x1 * box.w,
        y1: l.lead.y1 * box.h,
        x2: l.lead.x2 * box.w,
        y2: l.lead.y2 * box.h,
        class: `lead${raised ? ' raised' : ''}`,
      }),
    );
    svg.append(
      svgEl('circle', {
        cx: l.dot.x * box.w,
        cy: l.dot.y * box.h,
        r: 6,
        class: `city${raised ? ' raised' : ''}`,
      }),
    );
  }
  wrap.append(svg);
  for (const c of view.cities) {
    const l = layout.get(c.name);
    if (!l) continue;
    const s = l.panel;
    const panel = div(
      `ex-city edge-${s.edge}${c.people.some((p) => p.raised) ? ' raised' : ''}`,
    );
    panel.style.left = `${s.x * 100}%`;
    panel.style.width = `${s.w * 100}%`;
    if (s.edge === 'top') panel.style.top = `${s.y * 100}%`;
    else panel.style.bottom = `${(1 - s.y) * 100}%`;
    if (c.people.length > 6) panel.classList.add('two');
    const head = div('ex-city-head');
    head.append(
      span('name', c.short),
      span('n', String(c.people.length)),
      span('local', c.local),
    );
    panel.append(head);
    const grid = div('ex-city-marks');
    for (const p of c.people) grid.append(mark(p));
    panel.append(grid);
    wrap.append(panel);
  }
  wrap.append(div('ex-rmap-credit', 'Land: Natural Earth'));
  return wrap;
}

/**
 * MAIN's neutral field when no situation is active (or before the first):
 * the land, and the cities with a leg today, each with its local time. No
 * person, no path, nothing but places and clocks.
 */
export function worldField(cities, { w = 940, h = 1000 } = {}) {
  const proj = projection({
    w,
    h,
    lon0: -108,
    lon1: 12,
    top: 66,
    parallel: 45,
  });
  const svg = svgEl('svg', {
    viewBox: `0 0 ${w} ${h}`,
    preserveAspectRatio: 'xMidYMid slice',
    class: 'exm-world',
    'aria-hidden': 'true',
  });
  svg.append(svgEl('path', { d: landPath(proj), class: 'land' }));
  for (const c of cities) {
    const [x, y] = proj.at(c.lat, c.lon);
    svg.append(svgEl('circle', { cx: x, cy: y, r: 9, class: 'city' }));
    const t = svgEl('text', {
      x: x + (c.anchor === 'end' ? -18 : 18),
      y: y + 8,
      class: 'label',
      'text-anchor': c.anchor === 'end' ? 'end' : 'start',
    });
    t.textContent = c.label;
    svg.append(t);
  }
  return svg;
}

/** The legend under the roster map: shapes, rings, bars (no colour key). */
export function rosterLegend() {
  const box = div('ex-legend');
  const sample = (protection, fresh, text) => {
    const r = div('item');
    r.append(
      mark(
        { protection, fresh, posture: 'ROUTINE', bars: 1, callsign: '' },
        { label: false },
      ),
      span('t', text),
    );
    return r;
  };
  box.append(
    sample('DETAIL', 'fresh', 'DETAIL'),
    sample('REMOTE', 'fresh', 'REMOTE'),
    sample('MONITORED', 'fresh', 'MONITORED'),
    sample('MONITORED', 'aging', 'aging'),
    sample('MONITORED', 'stale', 'stale'),
    sample('MONITORED', 'schedule', 'schedule only'),
    sample('MONITORED', 'paused', 'sharing paused'),
  );
  return box;
}

/**
 * The point of a polygon's outline nearest to `c` ([lat, lon]), in the
 * local flat metric: a hazard area far off (the storm line 30 km W of IAD)
 * puts only its near edge in the frame, and runs off it as a band.
 */
export function nearestEdge(polygon, c) {
  const k = Math.cos((c[0] * Math.PI) / 180);
  let best = null;
  let bd = Infinity;
  for (let i = 0; i < polygon.length - 1; i++) {
    const [a0, a1] = polygon[i];
    const [b0, b1] = polygon[i + 1];
    const ax = a1 * k;
    const bx = b1 * k;
    const cx = c[1] * k;
    const dx = bx - ax;
    const dy = b0 - a0;
    const len = dx * dx + dy * dy || 1e-12;
    const t = Math.max(
      0,
      Math.min(1, ((cx - ax) * dx + (c[0] - a0) * dy) / len),
    );
    const px = ax + t * dx;
    const py = a0 + t * dy;
    const d = (px - cx) ** 2 + (py - c[0]) ** 2;
    if (d < bd) {
      bd = d;
      best = [py, px / k];
    }
  }
  return best;
}

/** Where an area lies from `c` and how far its near edge is (km). */
export function areaBearing(polygon, c) {
  const e = nearestEdge(polygon, c);
  if (!e) return { side: 'W', km: null };
  const k = Math.cos((c[0] * Math.PI) / 180);
  const dx = (e[1] - c[1]) * k * 111.32;
  const dy = (e[0] - c[0]) * 110.57;
  const side =
    Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 'W' : 'E') : dy < 0 ? 'S' : 'N';
  return {
    side: side === 'N' || side === 'S' ? 'W' : side,
    km: Math.round(Math.hypot(dx, dy)),
  };
}

/** A plane fitted to `pts` ([lat, lon]) at W × H, the ground's aspect kept. */
export function fitPlane(pts, W, H, pad) {
  let la0 = Math.min(...pts.map((p) => p[0]));
  let la1 = Math.max(...pts.map((p) => p[0]));
  let lo0 = Math.min(...pts.map((p) => p[1]));
  let lo1 = Math.max(...pts.map((p) => p[1]));
  const k = Math.cos(((la0 + la1) / 2) * (Math.PI / 180));
  const spanX = Math.max((lo1 - lo0) * k, 0.004);
  const spanY = Math.max(la1 - la0, 0.004);
  if (spanX / spanY > W / H) {
    const need = (spanX * H) / W - spanY;
    la0 -= need / 2;
    la1 += need / 2;
  } else {
    const need = ((spanY * W) / H - spanX) / k;
    lo0 -= need / 2;
    lo1 += need / 2;
  }
  if (lo1 - lo0 < 1e-6) {
    lo0 -= 0.002;
    lo1 += 0.002;
  }
  if (la1 - la0 < 1e-6) {
    la0 -= 0.002;
    la1 += 0.002;
  }
  const X = (lon) => (pad + ((lon - lo0) / (lo1 - lo0)) * (1 - 2 * pad)) * W;
  const Y = (lat) => (pad + ((la1 - lat) / (la1 - la0)) * (1 - 2 * pad)) * H;
  return { X, Y };
}

/** A 45° hatch pattern (EP-32 §2.5), once per SVG. */
function hatchDefs(svg, id) {
  const defs = svgEl('defs');
  const pat = svgEl('pattern', {
    id,
    width: 14,
    height: 14,
    patternUnits: 'userSpaceOnUse',
    patternTransform: 'rotate(45)',
  });
  pat.append(svgEl('line', { x1: 0, y1: 0, x2: 0, y2: 14, class: 'hatch' }));
  defs.append(pat);
  svg.append(defs);
}

/**
 * Draw areas, routes, places and marks on a fitted plane, every label
 * kept inside the frame: a point in the right half labels to its left.
 */
function drawPlane(
  svg,
  { areas = [], routes = [], places = [], marks = [] },
  P,
  W,
  H,
  sizes,
) {
  const { X, Y } = P;
  const hid = `hatch-${Math.random().toString(36).slice(2, 8)}`;
  if (areas.some((a) => a.polygon)) hatchDefs(svg, hid);
  const label = (x, y, text, cls, dy) => {
    const left = x > W * 0.55;
    const t = svgEl('text', {
      x: x + (left ? -sizes.gap : sizes.gap),
      y: Math.max(sizes.font, Math.min(H - 6, y + dy)),
      'text-anchor': left ? 'end' : 'start',
      class: `label ${cls}`,
    });
    t.textContent = text;
    svg.append(t);
  };
  for (const a of areas) {
    if (!a.polygon) continue;
    const xs = a.polygon.map(([, lo]) => X(lo));
    const ys = a.polygon.map(([la]) => Y(la));
    const inFrame =
      Math.max(...xs) > 0 &&
      Math.min(...xs) < W &&
      Math.max(...ys) > 0 &&
      Math.min(...ys) < H;
    if (inFrame) {
      const pts = a.polygon
        .map(([la, lo]) => `${X(lo).toFixed(1)},${Y(la).toFixed(1)}`)
        .join(' ');
      svg.append(
        svgEl('polygon', { points: pts, class: 'area', fill: `url(#${hid})` }),
      );
    }
    // Off the frame (the storm line 30 km W of a 3 km move): a hatched
    // band on the side it lies, its distance in words, never a false
    // scale (B7 #12).
    const side = a.side || 'W';
    const bw = W * 0.07;
    if (!inFrame) {
      const x = side === 'E' ? W - bw : 0;
      svg.append(
        svgEl('rect', {
          x,
          y: 0,
          width: bw,
          height: H,
          class: 'area',
          fill: `url(#${hid})`,
        }),
      );
    }
    const right = side === 'E';
    const t = svgEl('text', {
      x: right
        ? W - bw - 10
        : (inFrame ? Math.max(10, Math.min(W - 10, Math.max(...xs))) : bw) + 10,
      y: inFrame
        ? Math.max(sizes.font * 2, Math.min(...ys) + sizes.font * 1.5)
        : sizes.font * 3,
      'text-anchor': right ? 'end' : 'start',
      class: 'label area-l',
    });
    t.textContent = inFrame
      ? a.label
      : `${right ? '' : '← '}${a.label}${a.km ? ` · ${a.km} km` : ''}${right ? ' →' : ''}`;
    svg.append(t);
  }
  for (const r of routes)
    svg.append(
      svgEl('polyline', {
        points: r.coords
          .map(([la, lo]) => `${X(lo).toFixed(1)},${Y(la).toFixed(1)}`)
          .join(' '),
        class: `route${r.planned ? ' planned' : ''}`,
      }),
    );
  for (const p of places) {
    const x = X(p.lon);
    const y = Y(p.lat);
    const r = sizes.box / 2;
    svg.append(
      svgEl('rect', {
        x: x - r,
        y: y - r,
        width: 2 * r,
        height: 2 * r,
        class: 'place',
      }),
    );
    label(x, y, p.name, 'place-l', sizes.font * 0.35);
  }
  for (const m of marks) {
    const x = X(m.lon);
    const y = Y(m.lat);
    svg.append(
      svgEl('circle', {
        cx: x,
        cy: y,
        r: sizes.mark,
        class: `mark ${m.kind || ''}`.trim(),
      }),
    );
    label(x, y, m.label, 'cs', -sizes.mark - 6);
  }
}

/**
 * The Principal fallback: the person's paths and marks on a flat plane
 * fitted to them (no site twin at this venue), with any hazard area's near
 * edge brought into the frame (B7 #12).
 */
export function flatPrincipal(overlay, places = []) {
  const wrap = div('ex-flat');
  const pts = [];
  for (const r of overlay.routes) pts.push(...r.coords);
  for (const m of overlay.marks) pts.push([m.lat, m.lon]);
  for (const p of places) pts.push([p.lat, p.lon]);
  if (!pts.length) {
    wrap.append(div('ex-flat-empty', 'No position on file'));
    return wrap;
  }
  const c = [
    pts.reduce((a, p) => a + p[0], 0) / pts.length,
    pts.reduce((a, p) => a + p[1], 0) / pts.length,
  ];
  const areas = (overlay.areas || [])
    .filter((a) => a.polygon)
    .map((a) => ({ ...a, ...areaBearing(a.polygon, c) }));
  const W = 1000;
  const H = 620;
  const P = fitPlane(pts, W, H, 0.1);
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'ex-flat-svg' });
  for (let i = 1; i < 10; i++) {
    svg.append(
      svgEl('line', {
        x1: (W * i) / 10,
        x2: (W * i) / 10,
        y1: 0,
        y2: H,
        class: 'g',
      }),
    );
    svg.append(
      svgEl('line', {
        x1: 0,
        x2: W,
        y1: (H * i) / 10,
        y2: (H * i) / 10,
        class: 'g',
      }),
    );
  }
  drawPlane(
    svg,
    { areas, routes: overlay.routes, places, marks: overlay.marks },
    P,
    W,
    H,
    { font: 16, gap: 12, box: 12, mark: 7 },
  );
  wrap.append(svg);
  return wrap;
}

/**
 * MAIN's flat map when the top row's venue has no site twin (SWIFT at
 * IAD): the venue, the leg's origin and route, any hazard area's near edge
 * and the person, on a plain field fitted to them, labels kept inside the
 * frame. `route`, `origin` and `areas` come from mainScene when the host
 * sends them (F2-NOTES ask 1); without them, the venue and the person.
 */
export function venueField(
  { places = [], marks = [], route = null, areas = [] },
  { w = 920, h = 1000 } = {},
) {
  const svg = svgEl('svg', {
    viewBox: `0 0 ${w} ${h}`,
    preserveAspectRatio: 'xMidYMid meet',
    class: 'exm-venue',
    'aria-hidden': 'true',
  });
  for (let i = 1; i < 8; i++) {
    svg.append(
      svgEl('line', {
        x1: (w * i) / 8,
        x2: (w * i) / 8,
        y1: 0,
        y2: h,
        class: 'g',
      }),
    );
    svg.append(
      svgEl('line', {
        x1: 0,
        x2: w,
        y1: (h * i) / 8,
        y2: (h * i) / 8,
        class: 'g',
      }),
    );
  }
  const pts = [...places, ...marks].map((p) => [p.lat, p.lon]);
  if (route?.length) pts.push(...route);
  if (!pts.length) return svg;
  const c = [
    pts.reduce((a, p) => a + p[0], 0) / pts.length,
    pts.reduce((a, p) => a + p[1], 0) / pts.length,
  ];
  const polys = (areas || [])
    .filter((a) => a.polygon?.length > 2)
    .map((a) => ({ ...a, ...areaBearing(a.polygon, c) }));
  const P = fitPlane(pts, w, h, polys.length || route ? 0.14 : 0.24);
  drawPlane(
    svg,
    {
      areas: polys,
      routes: route?.length ? [{ coords: route }] : [],
      places,
      marks,
    },
    P,
    w,
    h,
    { font: 30, gap: 24, box: 24, mark: 12 },
  );
  return svg;
}

/** The map notice, wherever a path is drawn (privacy review 7 / item 12). */
export function osmNotice(text = '© OpenStreetMap contributors') {
  const n = el('div', 'ex-osm');
  n.textContent = `Paths: ${text} · openstreetmap.org/copyright`;
  return n;
}
