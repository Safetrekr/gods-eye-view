// SafeTrekr Executive B3: the flat maps (no Cesium). The roster map (seven
// cities, every person a mark) and the Principal view's fallback when the
// person's venue has no site twin (SWIFT at IAD). SVG built with the DOM;
// no basemap tiles, so nothing to attribute except the paths' own notice.
import { div, el, span } from './dom.js';

const NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};

/** Equirectangular box over the seven cities (Americas to the Gulf). */
const BOX = { w: 1600, h: 640, lon0: -112, lon1: 66, lat0: 14, lat1: 62 };
const px = (lon) => ((lon - BOX.lon0) / (BOX.lon1 - BOX.lon0)) * BOX.w;
const py = (lat) => ((BOX.lat1 - lat) / (BOX.lat1 - BOX.lat0)) * BOX.h;

/**
 * Where each city's panel sits (fractions of the map box): near its dot,
 * never on another panel. The hairline joins panel and dot.
 */
const SLOTS = {
  Austin: { x: 0.0, y: 0.5, w: 0.3 },
  'Washington DC': { x: 0.2, y: 0.02, w: 0.18 },
  'New York': { x: 0.395, y: 0.02, w: 0.16 },
  Miami: { x: 0.31, y: 0.62, w: 0.17 },
  London: { x: 0.575, y: 0.02, w: 0.22 },
  Zurich: { x: 0.68, y: 0.5, w: 0.15 },
  Dubai: { x: 0.85, y: 0.36, w: 0.15 },
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

/** The roster map: graticule, city dots, a panel of marks per city. */
export function rosterMap(view) {
  const wrap = div('ex-rmap');
  const svg = svgEl('svg', {
    viewBox: `0 0 ${BOX.w} ${BOX.h}`,
    preserveAspectRatio: 'none',
    class: 'ex-rmap-grid',
  });
  for (let lon = -110; lon <= 60; lon += 10)
    svg.append(
      svgEl('line', {
        x1: px(lon),
        x2: px(lon),
        y1: 0,
        y2: BOX.h,
        class: lon % 30 ? 'g' : 'g major',
      }),
    );
  for (let lat = 20; lat <= 60; lat += 10)
    svg.append(
      svgEl('line', {
        x1: 0,
        x2: BOX.w,
        y1: py(lat),
        y2: py(lat),
        class: lat % 30 ? 'g' : 'g major',
      }),
    );
  for (const c of view.cities) {
    const s = SLOTS[c.name];
    if (!s) continue;
    const x = px(c.lon);
    const y = py(c.lat);
    const sx = (s.x + s.w / 2) * BOX.w;
    const sy = s.y < 0.3 ? s.y * BOX.h + 40 : s.y * BOX.h;
    svg.append(svgEl('line', { x1: x, y1: y, x2: sx, y2: sy, class: 'lead' }));
    svg.append(
      svgEl('circle', {
        cx: x,
        cy: y,
        r: 5,
        class: `city${c.people.some((p) => p.raised) ? ' raised' : ''}`,
      }),
    );
  }
  wrap.append(svg);
  for (const c of view.cities) {
    const s = SLOTS[c.name];
    if (!s) continue;
    const panel = div(
      `ex-city${c.people.some((p) => p.raised) ? ' raised' : ''}`,
    );
    panel.style.left = `${s.x * 100}%`;
    panel.style.top = `${s.y * 100}%`;
    panel.style.width = `${s.w * 100}%`;
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
  return wrap;
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

/** The map notice, wherever a path is drawn (privacy review 7 / item 12). */
export function osmNotice(text = '© OpenStreetMap contributors') {
  const n = el('div', 'ex-osm');
  n.textContent = `Paths: ${text} · openstreetmap.org/copyright`;
  return n;
}
