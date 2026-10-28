// SafeTrekr Executive B3: the six walls' content, as data, over the
// scripted day (views.js, wallData.js). No DOM, no relay: the loop host
// cut to each beat's showcase moment. Walls show callsigns, never names
// (EP-38 #3); MAIN shows only what selectMain sent (I3); the Principal
// view follows the raised person's venue twin, SWIFT falls back to flat.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createLoopHost } from '../host/loopHost.js';
import {
  beatOf,
  CITIES,
  focusOf,
  geoOf,
  mainScene,
  SITE_OF_PLACE,
  timeStrip,
} from '../loop/wallData.js';
import {
  intelView,
  mainView,
  principalOverlay,
  principalView,
  rosterView,
  scrub,
  tripsView,
  verifyView,
} from './views.js';
import { plainBreach } from '../words.js';
import { landPath, projection, ROSTER_BOX, rosterLayout } from './geo.js';

const day = JSON.parse(
  fs.readFileSync(new URL('../data/day.json', import.meta.url), 'utf8'),
);
const geo = geoOf(day);
const SHOWCASE = {
  0: '2026-10-27T14:30:00Z',
  1: '2026-10-27T16:12:00Z',
  2: '2026-10-27T18:25:00Z',
  3: '2026-10-27T22:24:00Z',
  4: '2026-10-28T00:36:00Z',
  5: '2026-10-28T01:00:00Z',
};
const NAMES = [
  ...Object.values(day.people).map((p) => p.name),
  ...day.watch.staff.map((s) => s.name),
];

function at(t) {
  const lh = createLoopHost({ day, now: () => 1e6 });
  assert.ok(
    lh.presenter({ type: 'clock.jump', to: t }, { by: 'x', real: 1e6 }).ok,
  );
  return { lh, loop: JSON.parse(JSON.stringify(lh.loopView())) };
}
const beats = Object.fromEntries(
  Object.entries(SHOWCASE).map(([b, t]) => [b, at(t)]),
);
const views = (loop, lh) => {
  const pv = principalView(loop, geo);
  return {
    verify: verifyView(loop),
    intel: intelView(loop),
    roster: rosterView(loop, CITIES),
    trips: tripsView(loop, geo.trips),
    principal: { ...pv, sit: undefined },
    overlay: principalOverlay(loop, geo, pv),
    main: mainView(lh.mainView(), {
      at: loop.clock.simNow,
      beat: beatOf(loop),
    }),
  };
};

test('B3 walls: no roster or watch name on any wall at any beat (callsigns only)', () => {
  for (const [b, { lh, loop }] of Object.entries(beats)) {
    const text = JSON.stringify(views(loop, lh));
    for (const n of NAMES)
      assert.ok(!text.includes(n), `beat ${b} shows the name "${n}"`);
  }
  // The scrubber puts the callsign where a name stands in free text.
  const { loop } = beats[0];
  const p = Object.values(loop.people)[0];
  assert.equal(scrub(loop, `post about ${p.name}`), `post about ${p.callsign}`);
});

test('B3 MAIN: the brief at beat 0, then the beat’s decision row; nothing but selectMain’s fields', () => {
  const m0 = views(beats[0].loop, beats[0].lh).main;
  assert.equal(m0.rows.length, 0);
  assert.equal(m0.empty, 'No active situations');
  assert.match(m0.brief.header, /^DAILY BRIEF 1200Z · 7 LEGS TODAY$/);
  assert.equal(
    m0.watch,
    'Watch: SafeTrekr Watch Floor · VALE · Your lead: viewing',
  );
  const want = {
    1: /^KESTREL · Lunch 1230L · .* · ACCEPTED · next update 1215L$/,
    2: /^ATLAS · Keynote 1930L · DL: NON-CONCUR · original plan, \+1 post north door/,
    3: /^WREN · Kennedy Center 1930L · .*NO READ 10 MIN · CALLING/,
    4: /^SWIFT 1–2 · Hotel → IAD 2030L · No change · READ/,
  };
  for (const [b, re] of Object.entries(want)) {
    const m = views(beats[b].loop, beats[b].lh).main;
    assert.equal(m.rows.length, 1, `beat ${b}: one row`);
    assert.match(m.rows[0].text, re);
  }
  const m5 = views(beats[5].loop, beats[5].lh).main;
  assert.equal(m5.closed.length, 6);
  assert.deepEqual(
    [
      m5.counter.in,
      m5.counter.matched,
      m5.counter.raised,
      m5.counter.pushed,
      m5.counter.closed,
    ],
    [214, 11, 6, 4, 6],
  );
  assert.match(m5.verified, /^Last verified by a human 0058Z · VALE$/);
  assert.equal(
    timeStrip(SHOWCASE[0]),
    'AUSTIN 0930L · DC 1030L · LONDON 1430L · 1430Z',
  );
});

test('B3 Principal: the raised person’s site twin (KESTREL Long Center, ATLAS Festival Hall, WREN Kennedy Center); SWIFT flat', () => {
  const site = (b) => principalView(beats[b].loop, geo);
  assert.equal(site(0).callsign, 'KESTREL');
  assert.equal(site(0).site, 'austin');
  assert.equal(site(1).site, 'austin-long-center');
  assert.equal(site(2).site, 'london-festival-hall');
  assert.equal(site(3).site, 'dc-kennedy-center');
  assert.equal(site(4).callsign, 'SWIFT 1');
  assert.equal(site(4).flat, true);
  assert.equal(site(5).callsign, 'ATLAS');
  assert.equal(site(5).site, 'london');
  for (const k of Object.values(SITE_OF_PLACE))
    assert.match(k, /^(austin|london|dc)/);
  // Beat 2: the SALUTE's advance post and both named entrances on the map.
  const o = principalOverlay(beats[2].loop, geo, site(2));
  assert.deepEqual(
    o.entrances.map((e) => e.name),
    ['Belvedere Rd entrance', 'north door'],
  );
  assert.equal(o.posts[0].label, 'ATLAS 3 · advance');
  // Beat 1: the planned route (superseded) and the closure area.
  const k = principalOverlay(beats[1].loop, geo, site(1));
  assert.ok(k.routes.some((r) => r.planned));
  assert.ok(k.areas.some((a) => /Road closure/.test(a.label)));
  assert.equal(focusOf(beats[3].loop).person_id, 'p-wren');
  assert.equal(mainScene(beats[3].loop).site, 'dc-kennedy-center');
});

test('B3 Verify, Intel, Roster, Trips: the beat’s card, the feed’s reasons, LIVE vs SAMPLE, the re-tier', () => {
  const v2 = verifyView(beats[2].loop);
  assert.equal(v2.card.sit_id, 's-atlas-01');
  assert.match(
    v2.card.countersign,
    /^raised 1803Z → countersigned ORTEGA 1806Z · \+3 min$/,
  );
  assert.equal(v2.card.salute.length, 6);
  assert.equal(v2.card.checklist.length, 7);
  const v1 = verifyView(beats[1].loop);
  assert.equal(v1.card.gradeStep, 'C3 → C2 · corroborated');
  const f = intelView(beats[0].loop);
  assert.ok(f.items.some((i) => /^not raised: .* · VALE$/.test(i.line)));
  for (const i of f.items)
    assert.match(i.tag, /^(SAMPLE|PARTNER FEED|HUMAN|LIVE)/);
  assert.ok(f.items.every((i) => !i.live || /^LIVE · /.test(i.tag)));
  const r3 = rosterView(beats[3].loop, CITIES);
  assert.equal(r3.cities.length, 7);
  assert.equal(r3.total, 40);
  assert.ok(
    r3.retiers.some((t) => /^WREN MONITORED → REMOTE · ORTEGA/.test(t)),
  );
  const wren = r3.cities
    .find((c) => c.name === 'Washington DC')
    .people.find((p) => p.callsign === 'WREN');
  assert.equal(wren.protection, 'REMOTE');
  assert.equal(wren.raised, true);
  const t = tripsView(beats[1].loop, geo.trips);
  assert.equal(t.cards.length, geo.trips.length);
  assert.ok(t.cards.every((c) => c.legs.length > 0));
});

test('B3 walls: every fixed wall string is plain (EP-36 §5)', () => {
  for (const [b, { lh, loop }] of Object.entries(beats)) {
    const v = views(loop, lh);
    const fixed = [
      v.main.watch,
      v.main.verified,
      v.main.queue,
      v.main.counterLine,
      v.verify.head,
      v.intel.last10,
      v.trips.head,
      ...v.principal.slots.map(([, x]) => x),
    ];
    for (const s of fixed)
      assert.equal(plainBreach(s), null, `beat ${b}: "${s}"`);
  }
});

test('B4a MAIN (EP-52): rows as the storyboard, one counter, the map follows the top row or leaves no site behind', () => {
  const m = (b) => views(beats[b].loop, beats[b].lh).main;
  const r2 = m(2).rows[0];
  assert.equal(r2.detail, true);
  assert.equal(r2.ladder, 'DL: NON-CONCUR');
  assert.equal(r2.line, 'original plan, +1 post north door');
  assert.equal(r2.z, '(1930Z)');
  const r1 = m(1).rows[0];
  assert.equal(r1.detail, false);
  assert.equal(r1.ladder, 'ACCEPTED');
  assert.match(r1.line, /^Arrive 1215L by the Barton Springs Rd side/);
  assert.match(m(3).rows[0].ladder, /^NO READ 10 MIN · CALLING/);
  assert.equal(m(4).rows[0].ladder, 'READ');
  // One counter: the figures; the line exists only as its accessible label.
  for (const b of [0, 5]) assert.ok(m(b).counter && m(b).counterLine);
  // The map: the site twin while a row has one; flat for SWIFT at IAD (no
  // twin), never the previous site; the neutral field with no row.
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5].map((b) => m(b).map.mode),
    ['field', '3d', '3d', '3d', 'flat', 'field'],
  );
  assert.equal(m(2).map.site, 'london-festival-hall');
  assert.equal(m(4).map.site, undefined);
  assert.equal(m(4).map.title, 'IAD general aviation ramp');
  assert.match(m(4).map.note, /no 3D site twin/);
});

test('B4a MAIN carries no roster name, intel title, post or DL reason at any beat', () => {
  const bad = new Set(NAMES);
  for (const b of Object.values(day.bundles)) {
    if (b.title?.length >= 12) bad.add(b.title);
    for (const p of b.posts || []) if (p.text?.length >= 12) bad.add(p.text);
  }
  for (const e of day.events)
    if (e.type === 'dl.respond' && e.reason) bad.add(e.reason);
  for (const [b, { lh, loop }] of Object.entries(beats)) {
    const text = JSON.stringify(
      mainView(lh.mainView(), { at: loop.clock.simNow, beat: beatOf(loop) }),
    );
    for (const s of bad)
      assert.ok(!text.includes(s), `beat ${b}: MAIN shows "${s.slice(0, 50)}"`);
  }
});

test('B4a roster map: each city dot at its true projected place; every leader ends on its panel’s facing edge; panels apart', () => {
  const proj = projection(ROSTER_BOX);
  const layout = rosterLayout(CITIES);
  assert.equal(layout.length, 7);
  for (const l of layout) {
    const c = CITIES.find((x) => x.name === l.name);
    const [x, y] = proj.at(c.lat, c.lon);
    assert.ok(Math.abs(l.dot.x - x / ROSTER_BOX.w) < 1e-9, l.name);
    assert.ok(Math.abs(l.dot.y - y / ROSTER_BOX.h) < 1e-9, l.name);
    assert.ok(l.dot.x > 0 && l.dot.x < 1 && l.dot.y > 0 && l.dot.y < 1);
    // The leader starts at the dot and ends on the panel's facing edge.
    assert.equal(l.lead.x1, l.dot.x);
    assert.equal(l.lead.y2, l.panel.y);
    assert.ok(l.lead.x2 >= l.panel.x && l.lead.x2 <= l.panel.x + l.panel.w);
    // The panel sits on the dot's side of its edge.
    if (l.panel.edge === 'top') assert.ok(l.panel.y > l.dot.y, l.name);
    else assert.ok(l.panel.y < l.dot.y, l.name);
  }
  // Panels' columns do not overlap within the same band (above / below).
  for (const a of layout)
    for (const b of layout) {
      if (a === b || a.panel.edge !== b.panel.edge) continue;
      const apart =
        a.panel.x + a.panel.w <= b.panel.x ||
        b.panel.x + b.panel.w <= a.panel.x ||
        Math.abs(a.panel.y - b.panel.y) > 0.15;
      assert.ok(apart, `${a.name} and ${b.name} panels meet`);
    }
  // The land outline is real geography: a path with many rings.
  const d = landPath(proj);
  assert.ok((d.match(/M/g) || []).length > 50);
});
