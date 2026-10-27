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
import { lowersProtection } from './fitzroyPolicy.js';
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
        lastUndoId: () => 'u1',
        names: {
          person: (id) => (id === 'twin-NF' ? 'Noah Fox' : null),
          place: () => null,
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
      for (const k of ['by', 'via', 'proposalId'])
        assert.equal(k in p.message.cmd, false);
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
    assert.match(p.say, /^Touch only: .+ on the remote, in [A-Za-z ]+\.$/);
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
  assert.equal(off.say, 'That layer stays on while a report is open.');
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
  assert.equal((await cat.propose('clear_spotlight')).say, 'Nothing changed.');
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
