// Builds every generated Fitzroy file as text (no writes): the CLI writes
// them, and fitzroy tests compare them for drift.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  applyCommand,
  createSession,
} from '../src/operations/tripTwin/twinSession.js';
import { DEMO_TRIPS } from '../src/operations/tripTwin/demoTrips.js';
import { sitesForCity } from '../src/operations/tripTwin/twinSites.js';
import { TWIN_CITIES } from '../src/operations/tripTwin/twinCities.js';
import { tripTwinDemoSnapshot } from '../src/operations/tripTwin/demoTripTwin.js';
import { createFitzroyCatalog } from '../src/operations/tripTwin/fitzroy/fitzroyCatalog.js';
import {
  FITZROY_COMMANDS,
  SPOKEN,
} from '../src/operations/tripTwin/fitzroy/fitzroyCommands.js';
import {
  toAnswerKey,
  toFunctions,
  toLlamaSchema,
  toMarkdown,
} from '../src/operations/tripTwin/fitzroy/fitzroyExport.js';

export const FITZROY_OUT = 'scripts/fixtures/trip-twin/fitzroy';
const SAMPLE_NOW = Date.parse('2026-10-22T15:00:00Z');
/** The state a docs row starts from, so its example changes something. */
const DOC_PRIME = {
  set_screen_live: {
    type: 'screens',
    target: 5,
    patch: { mode: 'advance', day: 2 },
  },
  clear_spotlight: {
    type: 'session',
    patch: { spotlight: { kind: 'person', id: 'twin-NF' } },
  },
  set_weather_now: { type: 'session', patch: { wxAt: SAMPLE_NOW + 30 * 60e3 } },
  stop_demo: { type: 'session', patch: { simStorm: SAMPLE_NOW } },
  reset_screen: {
    type: 'screens',
    target: 2,
    patch: { layers: { streets: true } },
  },
  return_all_live: {
    type: 'session',
    patch: { spotlight: { kind: 'person', id: 'twin-NF' } },
  },
};
/** Arguments for entries that have no example (docs only). */
const DOC_ARGS = {
  unpin_screen: { screen: '3' },
  start_demo: { hazard: 'storm' },
  set_screen_count: { count: 4 },
};

const json = (v) => `${JSON.stringify(v, null, 2)}\n`;

function trips(root) {
  const pois = (key) => {
    try {
      return (
        JSON.parse(
          readFileSync(
            join(root, 'scripts/fixtures/trip-twin', `${key}.pois.json`),
          ),
        ).pois || []
      );
    } catch {
      return [];
    }
  };
  return DEMO_TRIPS.map((t) => {
    const sites = sitesForCity(t.city);
    const poisBySite = Object.fromEntries(
      sites.map((s) => [s.key, pois(s.key)]),
    );
    const snap = tripTwinDemoSnapshot(t.city, t.scenario, {
      now: SAMPLE_NOW,
      elapsed: 0,
      pois: pois(t.city),
      poisBySite,
    });
    return {
      id: t.id,
      title: t.title,
      org: t.org,
      city: t.city,
      cityLabel: TWIN_CITIES[t.city]?.label ?? null,
      sites: sites.map((s) => ({
        key: s.key,
        label: s.label ?? s.key,
        short: s.short ?? null,
        hotel: s.key === t.city,
      })),
      people: (snap.participants || []).map((p) => ({
        id: p.id,
        name: p.name ?? `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim(),
      })),
      safety: (snap.safety_points || []).map((p) => ({
        id: p.id,
        category: p.category,
        name: p.name,
      })),
    };
  });
}

/** {relative path → text} for every generated file. */
export async function buildFitzroyOutputs(root) {
  const data = trips(root);
  const austin = data[0];
  const people = new Map(
    data.flatMap((t) => t.people.map((p) => [p.id, p.name])),
  );
  const places = new Map(
    data.flatMap((t) => t.safety.map((p) => [p.id, p.name])),
  );
  const base = createSession({
    count: 6,
    tripId: austin.id,
    epochMs: SAMPLE_NOW,
  });
  let state = base;
  const placeWord = new Map(
    data.flatMap((t) => t.safety.map((p) => [p.id, SPOKEN.place[p.category]])),
  );
  const catalog = createFitzroyCatalog({
    twin: {
      state: () => state,
      now: () => SAMPLE_NOW,
      lastUndoId: () => 'u-sample',
      names: {
        person: (id) => people.get(id) || null,
        place: (id) => places.get(id) || null,
        placeWord: (id) => placeWord.get(id) || null,
      },
    },
  });
  const rows = [];
  for (const { tool, policy } of FITZROY_COMMANDS) {
    const [example, args] = policy.examples[0] || [
      null,
      DOC_ARGS[tool.name] || {},
    ];
    state = DOC_PRIME[tool.name]
      ? applyCommand(base, DOC_PRIME[tool.name], { at: SAMPLE_NOW }).state
      : base;
    const proposal = await catalog.propose(tool.name, args);
    rows.push({ name: tool.name, example, say: proposal.say, proposal });
  }
  return {
    [`${FITZROY_OUT}/llama-schema.json`]: json(toLlamaSchema()),
    [`${FITZROY_OUT}/function-tools.json`]: json(toFunctions()),
    [`${FITZROY_OUT}/v0-answer-key.json`]: json(toAnswerKey()),
    [`${FITZROY_OUT}/entities.json`]: json({ spoken: SPOKEN, trips: data }),
    'docs/trip-twin/FITZROY-COMMANDS.md': toMarkdown(rows),
  };
}
