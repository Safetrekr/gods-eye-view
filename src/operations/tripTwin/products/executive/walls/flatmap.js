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
 * The Principal fallback: the person's paths and marks on a flat plane
 * fitted to them (no site twin at this venue).
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
  const lats = pts.map((p) => p[0]);
  const lons = pts.map((p) => p[1]);
  const pad = 0.12;
  let la0 = Math.min(...lats);
  let la1 = Math.max(...lats);
  let lo0 = Math.min(...lons);
  let lo1 = Math.max(...lons);
  const k = Math.cos(((la0 + la1) / 2) * (Math.PI / 180));
  const W = 1000;
  const H = 620;
  // Keep the ground's aspect: widen the shorter side.
  const spanX = (lo1 - lo0) * k || 0.01;
  const spanY = la1 - la0 || 0.01;
  if (spanX / spanY > W / H) {
    const need = (spanX * H) / W - spanY;
    la0 -= need / 2;
    la1 += need / 2;
  } else {
    const need = ((spanY * W) / H - spanX) / k;
    lo0 -= need / 2;
    lo1 += need / 2;
  }
  const X = (lon) => (pad + ((lon - lo0) / (lo1 - lo0)) * (1 - 2 * pad)) * W;
  const Y = (lat) => (pad + ((la1 - lat) / (la1 - la0)) * (1 - 2 * pad)) * H;
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
  for (const r of overlay.routes)
    svg.append(
      svgEl('polyline', {
        points: r.coords
          .map(([la, lo]) => `${X(lo).toFixed(1)},${Y(la).toFixed(1)}`)
          .join(' '),
        class: `route${r.planned ? ' planned' : ''}`,
      }),
    );
  for (const p of places) {
    svg.append(
      svgEl('rect', {
        x: X(p.lon) - 6,
        y: Y(p.lat) - 6,
        width: 12,
        height: 12,
        class: 'place',
      }),
    );
    const t = svgEl('text', {
      x: X(p.lon) + 12,
      y: Y(p.lat) + 5,
      class: 'label',
    });
    t.textContent = p.name;
    svg.append(t);
  }
  for (const m of overlay.marks) {
    svg.append(
      svgEl('circle', {
        cx: X(m.lon),
        cy: Y(m.lat),
        r: 7,
        class: `mark ${m.kind}`,
      }),
    );
    const t = svgEl('text', {
      x: X(m.lon) + 12,
      y: Y(m.lat) - 10,
      class: 'label cs',
    });
    t.textContent = m.label;
    svg.append(t);
  }
  wrap.append(svg);
  return wrap;
}

/**
 * MAIN's flat map when the top row's venue has no site twin (SWIFT at
 * IAD): the venue and the person on a plain field fitted to them, labels
 * kept inside the frame. No path, no tile, so nothing to attribute.
 */
export function venueField(
  { places = [], marks = [] },
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
  const pts = [...places, ...marks];
  if (!pts.length) return svg;
  let la0 = Math.min(...pts.map((p) => p.lat));
  let la1 = Math.max(...pts.map((p) => p.lat));
  let lo0 = Math.min(...pts.map((p) => p.lon));
  let lo1 = Math.max(...pts.map((p) => p.lon));
  const k = Math.cos(((la0 + la1) / 2) * (Math.PI / 180));
  const pad = 0.24;
  const spanX = Math.max((lo1 - lo0) * k, 0.004);
  const spanY = Math.max(la1 - la0, 0.004);
  if (spanX / spanY > w / h) {
    const need = (spanX * h) / w - spanY;
    la0 -= need / 2;
    la1 += need / 2;
  } else {
    const need = ((spanY * w) / h - spanX) / k;
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
  const X = (lon) => (pad + ((lon - lo0) / (lo1 - lo0)) * (1 - 2 * pad)) * w;
  const Y = (lat) => (pad + ((la1 - lat) / (la1 - la0)) * (1 - 2 * pad)) * h;
  const label = (x, y, text, cls) => {
    const left = x > w * 0.5;
    const t = svgEl('text', {
      x: x + (left ? -24 : 24),
      y: y + 10,
      'text-anchor': left ? 'end' : 'start',
      class: `label ${cls}`,
    });
    t.textContent = text;
    svg.append(t);
  };
  for (const p of places) {
    const x = X(p.lon);
    const y = Y(p.lat);
    svg.append(
      svgEl('rect', {
        x: x - 12,
        y: y - 12,
        width: 24,
        height: 24,
        class: 'place',
      }),
    );
    label(x, y, p.name, 'place-l');
  }
  for (const m of marks) {
    const x = X(m.lon);
    const y = Y(m.lat);
    svg.append(svgEl('circle', { cx: x, cy: y, r: 12, class: 'mark' }));
    label(x, y, m.label, 'cs');
  }
  return svg;
}

/** The map notice, wherever a path is drawn (privacy review 7 / item 12). */
export function osmNotice(text = '© OpenStreetMap contributors') {
  const n = el('div', 'ex-osm');
  n.textContent = `Paths: ${text} · openstreetmap.org/copyright`;
  return n;
}
