import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { defineTool } from '../../../tools/catalog.js';
import { validateValue } from '../../../tools/schema.js';
import { applyCommand, createSession, needsConfirm } from '../twinSession.js';
import { FITZROY_POLICY, defineCommand } from './fitzroyCommand.js';
import {
  FITZROY_COMMANDS,
  FITZROY_NAMES,
  LAYERS,
  SCREENS_ALL,
} from './fitzroyCommands.js';
import { createFitzroyCatalog } from './fitzroyCatalog.js';
import { lowersProtection, undoLowers } from './fitzroyPolicy.js';
import { ACTOR_FIELDS } from '../twinProtocol.js';
import { fitzroyGuard } from './fitzroyCatalog.js';
import { V0_CARDS } from './fitzroyCards.js';
import { YES_WORDS, speakable } from './fitzroySpeech.js';
import { toLlamaSchema } from './fitzroyExport.js';

const NOW = Date.parse('2026-10-22T15:00:00Z');
const fresh = () =>
  createSession({ count: 6, tripId: 'trip-choir-austin', epochMs: NOW });
function catalogOn(state, extra = {}) {
  let st = state;
  return {
    set: (s) => {
      st = s;
    },
    cat: createFitzroyCatalog({
      twin: {
        state: () => st,
        now: () => NOW,
        lastUndo: () => ({ undoId: 'u1', before: st }),
        incidentOpen: () => Boolean(st?.session?.report),
        tripDays: () => 3,
        reportedFloor: () => st?.session?.report?.floor ?? null,
        names: {
          person: (id) =>
            ({ 'twin-NF': 'Noah Fox', 'twin-JP': 'Jay Patel' })[id] || null,
          place: (id) => (/^sp-austin-/.test(id) ? 'A place' : null),
        },
        ...extra,
      },
    }),
  };
}
const apply = (state, cmd) => applyCommand(state, cmd, { at: NOW }).state;

/** Argument sets for an entry: its examples, plus a sweep of screens. */
function samples({ tool, policy }) {
  const out = policy.examples.map(([, a]) => a);
  const props = tool.inputSchema.properties || {};
  if (props.screen && props.layer)
    for (const s of SCREENS_ALL)
      for (const l of LAYERS) out.push({ screen: s, layer: l, on: true });
  else if (props.screen)
    for (const s of props.screen.enum)
      out.push({ ...(policy.examples[0]?.[1] || {}), screen: s });
  return out.length ? out : [{}];
}

test('every entry is a real upstream tool; names unique and snake case', () => {
  assert.equal(new Set(FITZROY_NAMES).size, FITZROY_NAMES.length);
  for (const { tool } of FITZROY_COMMANDS) {
    assert.equal(tool.kind, 'action');
    assert.match(tool.name, /^[a-z][a-z0-9_]{0,63}$/);
    // The same definition passes upstream defineTool as is.
    defineTool({ ...tool });
  }
  assert.equal(FITZROY_POLICY.size, FITZROY_COMMANDS.length);
});

test('upstream schema subset holds: anyOf or a mixed enum throws at define time', () => {
  assert.throws(() =>
    defineCommand({
      name: 'bad_entry',
      group: 'x',
      title: 'x',
      description: 'x',
      tier: 'act',
      inputSchema: {
        type: 'object',
        properties: { a: { anyOf: [{ type: 'string' }] } },
      },
      build: () => ({}),
    }),
  );
});

test('every sampled proposal applies cleanly, never carries an actor field, and never lowers protection', async () => {
  const { cat } = catalogOn(fresh());
  for (const entry of FITZROY_COMMANDS) {
    for (const args of samples(entry)) {
      assert.deepEqual(
        validateValue(entry.tool.inputSchema, args),
        [],
        `${entry.tool.name} ${JSON.stringify(args)}`,
      );
      const p = await cat.propose(entry.tool.name, args);
      if (!p.message || p.message.t !== 'cmd') continue;
      const r = applyCommand(fresh(), p.message.cmd, { at: NOW });
      assert.equal(r.error, undefined, `${entry.tool.name}: ${r.error}`);
      for (const k of ACTOR_FIELDS) assert.equal(k in p.message.cmd, false);
      assert.equal(lowersProtection(p.message, fresh()), null, entry.tool.name);
      // Voice never asks less than touch.
      if (needsConfirm(p.message.cmd))
        assert.equal(p.tier, 'ask', entry.tool.name);
    }
  }
});

test('touch entries never build a message; the protective set is exact and always acts', async () => {
  const { cat } = catalogOn(fresh());
  for (const { tool, policy } of FITZROY_COMMANDS) {
    if (policy.tier.one !== 'touch') continue;
    const p = await cat.propose(tool.name, policy.examples[0]?.[1] || {});
    assert.equal(p.message, null);
    assert.match(p.say, /^Touch only: .+ on the remote(, in [A-Za-z ]+)?\.$/);
  }
  const prot = FITZROY_COMMANDS.filter(
    ({ policy }) => policy.protective === true,
  ).map(({ tool }) => tool.name);
  assert.deepEqual(prot.sort(), [
    'mute_voice',
    'stop_demo',
    'stop_speaking',
    'visitor_on',
  ]);
  const st = apply(fresh(), {
    type: 'session',
    patch: { report: { id: 'r1', floor: 11, kind: 'medical' }, simStorm: NOW },
  });
  const { cat: c2 } = catalogOn(st);
  assert.equal((await c2.propose('visitor_on')).tier, 'act');
  assert.equal(
    (await c2.propose('stop_demo', { hazard: 'storm' })).tier,
    'act',
  );
  assert.equal(
    (await c2.propose('set_screen_motion', { screen: '1', on: false })).tier,
    'act',
  );
});

test('never less safe: lowering commands are refused, whatever builds them', () => {
  const st = apply(fresh(), {
    type: 'session',
    patch: { report: { id: 'r1', floor: 11, kind: 'medical' }, visitor: true },
  });
  const bad = [
    { type: 'session', patch: { visitor: false } },
    { type: 'session', patch: { report: null } },
    { type: 'session', patch: { incidentAck: 'r1' } },
    { type: 'session', patch: { simStorm: NOW } },
    { type: 'screens', target: 3, patch: { pinned: false } },
    { type: 'screens', target: 1, patch: { layers: { fires: false } } },
    { type: 'count', n: 3 },
  ];
  for (const cmd of bad)
    assert.ok(lowersProtection({ t: 'cmd', cmd }, st), JSON.stringify(cmd));
  // A trip switch writes nulls that are already null: not lowering.
  assert.equal(
    lowersProtection(
      {
        t: 'cmd',
        cmd: {
          type: 'session',
          patch: { tripId: 'trip-band-dc', report: null },
        },
      },
      fresh(),
    ),
    null,
  );
});

test('tiers: pin acts on one screen, all-screen scale asks, a pinned target raises, a report blocks a trip switch', async () => {
  const { cat, set } = catalogOn(fresh());
  assert.equal((await cat.propose('pin_screen', { screen: '6' })).tier, 'act');
  const all = await cat.propose('set_screen_scale', {
    screen: 'all',
    scale: 'city',
  });
  assert.equal(all.tier, 'ask');
  assert.match(all.question, /^Every screen: city scale\. Apply now\?$/);
  for (const w of YES_WORDS)
    assert.doesNotMatch(all.question.toLowerCase(), new RegExp(`\\b${w}\\b`));
  set(apply(fresh(), { type: 'screens', target: 4, patch: { pinned: true } }));
  assert.equal(
    (
      await cat.propose('set_screen_layer', {
        screen: '4',
        layer: 'radar3d',
        on: true,
      })
    ).tier,
    'ask',
  );
  set(
    apply(fresh(), {
      type: 'session',
      patch: { report: { id: 'r1', floor: 11, kind: 'medical' } },
    }),
  );
  const sw = await cat.propose('switch_trip', { trip: 'trip-band-dc' });
  assert.equal(sw.message, null);
  assert.equal(sw.refusal.code, 'report_open');
  const off = await cat.propose('set_screen_layer', {
    screen: '1',
    layer: 'fires',
    on: false,
  });
  assert.equal(off.message, null);
  assert.equal(off.say, 'That layer stays on while an incident is open.');
});

test('words: read-backs from the describer, speakable, Visitor initials, no clock, the demo prefix', async () => {
  const { cat, set } = catalogOn(fresh());
  assert.equal(
    (
      await cat.propose('set_screen_layer', {
        screen: '4',
        layer: 'radar3d',
        on: true,
      })
    ).say,
    'Screen 4, Weather: storm shells on.',
  );
  assert.equal(
    (await cat.propose('step_screen_text', { screen: '2', direction: 'up' }))
      .say,
    'Screen 2, People: text larger.',
  );
  assert.equal(
    (await cat.propose('spotlight_person', { person: 'twin-NF' })).say,
    'Every screen: spotlight Noah F.',
  );
  set(apply(fresh(), { type: 'session', patch: { visitor: true } }));
  assert.equal(
    (await cat.propose('spotlight_person', { person: 'twin-NF' })).say,
    'Every screen: spotlight N. F.',
  );
  set(fresh());
  const lens = (await cat.propose('set_weather_time', { minutes: 30 })).say;
  assert.equal(lens, 'Every screen: weather 30 minutes ahead.');
  assert.doesNotMatch(lens, /\d{1,2}:\d{2}/);
  set(apply(fresh(), { type: 'session', patch: { simStorm: NOW } }));
  assert.match(
    (
      await cat.propose('set_screen_layer', {
        screen: '4',
        layer: 'lightning',
        on: true,
      })
    ).say,
    /^Simulated storm\. /,
  );
  assert.equal(
    speakable('S4: text ×2 · storm shells (3D) & more'),
    'S4: text times 2, storm shells and more.',
  );
  assert.equal((await cat.propose('clear_spotlight')).tier, 'touch');
  assert.equal(
    (await cat.propose('step_screen_text', { screen: '2', direction: 'up' }))
      .message.cmd.patch.textScale,
    2,
  );
});

test('refusals: no screen above the count, another trip’s site, text at its limit', async () => {
  const st = createSession({
    count: 4,
    tripId: 'trip-choir-austin',
    epochMs: NOW,
  });
  const { cat, set } = catalogOn(st);
  assert.equal(
    (await cat.propose('pin_screen', { screen: '6' })).say,
    'There is no screen 6.',
  );
  const abbey = await cat.propose('go_to_site', { site: 'london-abbey' });
  assert.equal(abbey.refusal.code, 'other_trip');
  assert.equal(abbey.refusal.offer.name, 'switch_trip');
  set(apply(st, { type: 'screens', target: 2, patch: { textScale: 2.25 } }));
  assert.equal(
    (await cat.propose('step_screen_text', { screen: '2', direction: 'up' }))
      .refusal.code,
    'at_limit',
  );
});

test('every V0 card maps to an entry, a control or no command, with valid args', () => {
  assert.deepEqual(
    V0_CARDS.map((k) => k.card),
    Array.from({ length: 60 }, (_, i) => i + 1),
  );
  for (const k of V0_CARDS) {
    if (k.kind === 'none') {
      assert.ok(['route', 'question', 'not_for_system'].includes(k.intent));
      continue;
    }
    const entry = FITZROY_COMMANDS.find(({ tool }) => tool.name === k.command);
    assert.ok(entry, `card ${k.card}: ${k.command}`);
    if (k.kind === 'command')
      assert.deepEqual(
        validateValue(entry.tool.inputSchema, k.args),
        [],
        `card ${k.card}`,
      );
  }
});

test('control words match whole utterances; no command is spoken with a yes word', () => {
  const words = FITZROY_COMMANDS.flatMap(({ policy }) => policy.words || []);
  assert.equal(
    new Set(words).size,
    words.length,
    'a word belongs to one control',
  );
  assert.deepEqual(FITZROY_POLICY.get('reply_yes').words, [
    'yes',
    'confirm',
    'do it',
  ]);
});

test('the lab grammar: heard slots are free words, closed lists stay enums', () => {
  const s = toLlamaSchema();
  const layer = s.anyOf.find(
    (b) => b.properties.intent.const === 'set_screen_layer',
  );
  assert.deepEqual(layer.properties.screen, { type: 'string', maxLength: 60 });
  assert.ok(layer.properties.layer.enum.includes('radar3d'));
  assert.ok(s.anyOf.some((b) => b.properties.intent.const === 'question'));
});

test('generated files are up to date (run: node scripts/fitzroy-catalog.mjs)', async () => {
  const root = new URL('../../../../', import.meta.url).pathname;
  const { buildFitzroyOutputs } = await import(
    new URL('../../../../scripts/fitzroy-catalog-lib.mjs', import.meta.url)
  );
  const out = await buildFitzroyOutputs(root);
  for (const [rel, text] of Object.entries(out))
    assert.equal(
      readFileSync(root + rel, 'utf8'),
      text,
      `${rel} is out of date`,
    );
});

test('the fitzroy graph stays pure: no upstream tool index, no Cesium, no node:', () => {
  const dir = new URL('./', import.meta.url);
  for (const f of [
    'fitzroyCommand.js',
    'fitzroyCommands.js',
    'fitzroyPolicy.js',
    'fitzroyCatalog.js',
    'fitzroySpeech.js',
    'fitzroyExport.js',
    'fitzroyCards.js',
  ]) {
    const src = readFileSync(new URL(f, dir), 'utf8');
    assert.doesNotMatch(src, /from ['"](?:cesium|node:)/, f);
    assert.doesNotMatch(src, /tools\/index\.js/, f);
  }
});

// ---------------------------------------------------------------- round 1

const REPORT = { id: 'r1', floor: 11, kind: 'medical' };

test('undo by voice never takes back a protective change; nothing to undo is said', async () => {
  const before = fresh();
  const visitorOn = {
    t: 'cmd',
    cmd: { type: 'session', patch: { visitor: true } },
  };
  const after = apply(before, visitorOn.cmd);
  const { cat } = catalogOn(after, {
    lastUndo: () => ({ undoId: 'u9', message: visitorOn, before }),
  });
  const u = await cat.propose('undo_last');
  assert.equal(u.message, null);
  assert.equal(u.refusal.code, 'undo_protective');
  const layer = {
    t: 'cmd',
    cmd: { type: 'screens', target: 4, patch: { layers: { radar3d: true } } },
  };
  const { cat: c2 } = catalogOn(apply(before, layer.cmd), {
    lastUndo: () => ({ undoId: 'u10', message: layer, before }),
  });
  assert.deepEqual((await c2.propose('undo_last')).message, {
    t: 'undo',
    undoId: 'u10',
  });
  const { cat: c3 } = catalogOn(before, { lastUndo: () => null });
  assert.equal((await c3.propose('undo_last')).say, 'Nothing to undo.');
});

test('an incident in the trip data counts as open (London): Advance asks with why, safety layers stay', async () => {
  const { cat } = catalogOn(fresh(), { incidentOpen: () => true });
  const adv = await cat.propose('set_screen_advance', { screen: '1' });
  assert.equal(adv.tier, 'ask');
  assert.match(
    adv.question,
    /^An incident is open: Advance hides traveller positions\. .+ Apply now\?$/,
  );
  const off = await cat.propose('set_screen_layer', {
    screen: '1',
    layer: 'safety',
    on: false,
  });
  assert.equal(off.message, null);
  assert.equal(off.say, 'That layer stays on while an incident is open.');
});

test('voice does only what touch can: role, text and frame on one screen; frames on their own board', async () => {
  const { cat } = catalogOn(fresh());
  for (const [name, args] of [
    ['set_screen_role', { screen: 'all', role: 'trips' }],
    ['step_screen_text', { screen: 'all', direction: 'up' }],
    ['frame_screen', { screen: 'all', subject: 'storm' }],
  ])
    assert.equal((await cat.propose(name, args)).refusal.code, 'invalid', name);
  assert.equal(
    (await cat.propose('pin_screen', { screen: 'all' })).say,
    'Pin one screen at a time.',
  );
  assert.equal(
    (await cat.propose('frame_screen', { screen: '1', subject: 'storm' })).say,
    'That frames on the Weather screen.',
  );
  // One screen + a day = the day plan for that day, as the remote does.
  assert.deepEqual(
    (await cat.propose('set_screen_advance', { screen: '1', day: 2 })).message
      .cmd.patch,
    { role: 'day', day: 2 },
  );
});

test('words in a demo: Simulated first for the storm frame; demos named when Return all ends them', async () => {
  const st = apply(fresh(), {
    type: 'session',
    patch: { simStorm: NOW, simFire: NOW },
  });
  const { cat } = catalogOn(st);
  assert.match(
    (await cat.propose('frame_screen', { screen: '4', subject: 'storm' })).say,
    /^Simulated storm and fire boundary\. Screen 4, Weather: frames the storm\.$/,
  );
  assert.match(
    (await cat.propose('return_all_live')).question,
    /The simulated storm and fire boundary end\. Return now\?$/,
  );
  assert.equal(
    (await cat.propose('stop_demo')).say,
    'Every screen: simulated storm ended, simulated fire boundary ended.',
  );
  const { cat: c2 } = catalogOn(fresh());
  assert.equal((await c2.propose('stop_demo')).say, 'No demo is running.');
});

test('refusals that are honest: places the site lacks, people not on the trip, every screen pinned, a merged incident board, a demo layer', async () => {
  const { cat } = catalogOn(fresh(), {
    names: { person: () => null, place: () => null },
  });
  assert.equal(
    (await cat.propose('spotlight_place', { place: 'relocation' })).say,
    'This site has no relocation site.',
  );
  assert.equal(
    (await cat.propose('spotlight_person', { person: 'twin-ZZ' })).say,
    'No one by that name on this trip.',
  );
  let all = fresh();
  for (const s of [1, 2, 3, 4, 5, 6])
    all = apply(all, { type: 'screens', target: s, patch: { pinned: true } });
  const { cat: c2 } = catalogOn(all);
  assert.equal(
    (
      await c2.propose('set_screen_layer', {
        screen: 'all',
        layer: 'clouds',
        on: true,
      })
    ).say,
    'Every screen is pinned. Nothing changed.',
  );
  // Two screens: the incident board is merged into screen 2.
  const two = apply(
    createSession({ count: 2, tripId: 'trip-choir-austin', epochMs: NOW }),
    {
      type: 'session',
      patch: { report: REPORT },
    },
  );
  const { cat: c3 } = catalogOn(two);
  const merged = two.screens[2]?.merged?.includes?.('incident');
  if (merged)
    assert.equal(
      (await c3.propose('set_screen_role', { screen: '2', role: 'weather' }))
        .tier,
      'ask',
    );
  const demo = apply(fresh(), { type: 'session', patch: { simStorm: NOW } });
  const { cat: c4 } = catalogOn(demo);
  assert.equal(
    (
      await c4.propose('set_screen_layer', {
        screen: '4',
        layer: 'alertAreas',
        on: false,
      })
    ).say,
    'That layer stays on while the demo runs.',
  );
});

test('a proposal is checked again at yes; a moved wall asks again; no state says nothing changed', async () => {
  const { cat, set } = catalogOn(fresh());
  const p = await cat.propose('switch_trip', { trip: 'trip-band-dc' });
  assert.equal(p.tier, 'ask');
  set(apply(fresh(), { type: 'session', patch: { report: REPORT } }));
  const again = await cat.recheck(p);
  assert.equal(again.stale, true);
  assert.equal(again.say, 'The wall changed. Ask again.');
  set(null);
  assert.equal((await cat.propose('visitor_on')).say, 'Nothing changed.');
});

test('speech rules hold in every state: no clock, speakable, short, no yes word in a question, no name in Visitor mode', async () => {
  const states = {
    plain: fresh(),
    visitor: apply(fresh(), { type: 'session', patch: { visitor: true } }),
    demo: apply(fresh(), { type: 'session', patch: { simStorm: NOW } }),
    report: apply(fresh(), { type: 'session', patch: { report: REPORT } }),
    pinned: apply(fresh(), {
      type: 'screens',
      target: 4,
      patch: { pinned: true },
    }),
    four: createSession({
      count: 4,
      tripId: 'trip-choir-austin',
      epochMs: NOW,
    }),
  };
  for (const [label, st] of Object.entries(states)) {
    const { cat } = catalogOn(st);
    for (const { tool, policy } of FITZROY_COMMANDS)
      for (const [, args] of policy.examples.length
        ? policy.examples
        : [[null, {}]]) {
        const p = await cat.propose(tool.name, args);
        const say = p.say || '';
        const where = `${label} ${tool.name} "${say}"`;
        assert.doesNotMatch(say, /\b\d{1,2}:\d{2}\b/, where);
        assert.match(say, /^[A-Za-z0-9 ,.:?'-]*$/, where);
        if (p.question) {
          assert.ok(p.question.split(/\s+/).length <= 26, where);
          for (const w of YES_WORDS)
            assert.doesNotMatch(
              p.question.toLowerCase(),
              new RegExp(`\\b${w}\\b`),
              where,
            );
        } else assert.ok(say.split(/\s+/).length <= 20, where);
        if (label === 'visitor')
          assert.doesNotMatch(say, /Noah|Fox|Jay|Patel/, where);
      }
  }
});

test('the whole import graph stays free of Cesium and node: (F13 P1-3)', () => {
  const seen = new Set();
  const bad = [];
  const walk = (url) => {
    if (seen.has(url.href)) return;
    seen.add(url.href);
    const src = readFileSync(url, 'utf8');
    for (const m of src.matchAll(
      /^\s*(?:import|export)[^'"]*from\s+['"]([^'"]+)['"]/gm,
    )) {
      const spec = m[1];
      if (spec === 'cesium' || spec.startsWith('node:'))
        bad.push(`${url.pathname} → ${spec}`);
      else if (spec.startsWith('.')) walk(new URL(spec, url));
    }
  };
  walk(new URL('./fitzroyCatalog.js', import.meta.url));
  walk(new URL('./fitzroyExport.js', import.meta.url));
  assert.deepEqual(bad, []);
  assert.ok(![...seen].some((u) => u.endsWith('/tools/index.js')));
});

// ---------------------------------------------------------------- round 2

test('undo is checked against the whole wall and fails closed (F13/F16 round 2)', async () => {
  const base = fresh();
  const cases = [
    ['a report opened since', { type: 'session', patch: { report: REPORT } }],
    ['a pin', { type: 'screens', target: 3, patch: { pinned: true } }],
    ['a screen count', { type: 'count', n: 4 }],
  ];
  for (const [label, cmd] of cases) {
    const now = apply(base, cmd);
    const { cat } = catalogOn(now, {
      lastUndo: () => ({ undoId: 'u', before: base }),
    });
    assert.equal((await cat.propose('undo_last')).message, null, label);
  }
  // A safety layer voice turned on while an incident is open stays on.
  const rep = apply(base, { type: 'session', patch: { report: REPORT } });
  const on = apply(rep, {
    type: 'screens',
    target: 1,
    patch: { layers: { safety: true } },
  });
  assert.equal(undoLowers(on, rep, {}), 'safety layer off');
  // No record: refused.
  const { cat } = catalogOn(base, { lastUndo: () => ({ undoId: 'u' }) });
  assert.equal(
    (await cat.propose('undo_last')).refusal.code,
    'undo_protective',
  );
});

test('every check needs its source: a missing hook is refused at creation', () => {
  assert.throws(
    () =>
      createFitzroyCatalog({ twin: { state: () => fresh(), now: () => NOW } }),
    /Fitzroy needs/,
  );
});

test('the guard refuses an actor field or an undeclared field, whatever an entry builds', async () => {
  defineCommand({
    name: 'zz_stub_actor',
    group: 'test',
    title: 'stub',
    description: 'stub',
    tier: 'act',
    emits: { type: 'session', fields: ['visitor'] },
    build: () => ({}),
  });
  const twin = {
    state: () => fresh(),
    now: () => NOW,
    incidentOpen: () => false,
    lastUndo: () => null,
  };
  const guard = fitzroyGuard(twin);
  const call = (cmd) =>
    guard({ tool: { name: 'zz_stub_actor' }, args: {} }, async () => ({
      summary: 'x',
      data: { message: { t: 'cmd', cmd }, effect: 'relay' },
    }));
  assert.equal(
    (await call({ type: 'session', patch: { visitor: true }, by: 'D1' })).data
      .refusal.code,
    'actor_field',
  );
  assert.equal(
    (await call({ type: 'session', patch: { tripId: 'trip-band-dc' } })).data
      .refusal.code,
    'undeclared',
  );
});

test('the safety sweep holds in every state, not only a fresh one', async () => {
  const states = [
    apply(fresh(), { type: 'session', patch: { report: REPORT } }),
    apply(fresh(), {
      type: 'session',
      patch: { visitor: true, simStorm: NOW },
    }),
    apply(fresh(), { type: 'screens', target: 4, patch: { pinned: true } }),
  ];
  for (const st of states) {
    const { cat } = catalogOn(st);
    for (const entry of FITZROY_COMMANDS)
      for (const args of samples(entry)) {
        const p = await cat.propose(entry.tool.name, args);
        if (!p.message || p.message.t !== 'cmd') continue;
        assert.equal(
          lowersProtection(p.message, st, {
            incidentOpen: Boolean(st.session.report),
          }),
          null,
          entry.tool.name,
        );
        if (needsConfirm(p.message.cmd))
          assert.equal(p.tier, 'ask', entry.tool.name);
      }
  }
});

test('round 2 words and raises: a fuzzy name asks, the incident screen asks, demos named right, frame only the spotlit person', async () => {
  const { cat, set } = catalogOn(fresh());
  const fz = await cat.propose(
    'spotlight_person',
    { person: 'twin-JP' },
    { fuzzy: true },
  );
  assert.equal(fz.tier, 'ask');
  assert.match(fz.question, /^I may have misheard the name\. /);
  set(apply(fresh(), { type: 'session', patch: { report: REPORT } }));
  assert.equal(
    (await cat.propose('set_screen_scale', { screen: '3', scale: 'city' }))
      .tier,
    'ask',
  );
  set(apply(fresh(), { type: 'session', patch: { simStorm: NOW } }));
  assert.equal(
    (await cat.propose('stop_demo', { hazard: 'fire' })).say,
    "The simulated fire boundary isn't running. The simulated storm is on.",
  );
  set(
    apply(fresh(), { type: 'session', patch: { simStorm: NOW, simFire: NOW } }),
  );
  assert.match(
    (await cat.propose('return_all_live')).question,
    /storm and fire boundary end\. Return now\?$/,
  );
  set(fresh());
  assert.equal(
    (
      await cat.propose('frame_screen', {
        screen: '1',
        subject: 'person',
        person: 'twin-NF',
      })
    ).say,
    'Spotlight them first, then frame them.',
  );
});
