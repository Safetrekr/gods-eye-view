// The Fitzroy command list (review/fitzroy-commands F1, F5 D3). Every thing
// an operator may ask Fitzroy for, as an upstream-shaped tool plus Trip
// Twin's policy. Argument lists come from Trip Twin's own data; the model
// fills trip, site, person and screen with the words it heard and a
// resolver turns them into these ids, so a heard word never reaches a cmd.
//
// Tiers: act (read back, undo), ask (a closed question first), touch (said
// why, never a message). Voice does only what touch can, and is never less
// safe: what lowers protection is touch only (fitzroyPolicy.js).
import { DEMO_TRIPS, tripById } from '../demoTripList.js';
import {
  LAYER_CATALOG,
  ROLE_ORDER,
  ROLES,
  WALL_TEXT_MAX,
  WALL_TEXT_MIN,
} from '../twinScreenRoles.js';
import { sitesForCity, siteConfig } from '../twinSites.js';
import { defineCommand } from './fitzroyCommand.js';
import { SCREEN_SHORT, spokenLayer } from './fitzroySpeech.js';

// ------------------------------------------------------------ vocabularies

export const SCREENS = Object.freeze(['1', '2', '3', '4', '5', '6']);
export const SCREENS_ALL = Object.freeze([...SCREENS, 'all']);
export const LAYERS = Object.freeze(
  LAYER_CATALOG.flatMap((g) => g.layers.map((L) => L.key)),
);
export const SCALES = Object.freeze(['building', 'neighborhood', 'city']);
/** The remote's Time lens buttons (stations.js weather lens). */
export const LENS_MINUTES = Object.freeze([-30, 15, 30, 45, 60]);
export const TRIPS = Object.freeze(DEMO_TRIPS.map((t) => t.id));
export const SITES = Object.freeze(
  DEMO_TRIPS.flatMap((t) => sitesForCity(t.city).map((s) => s.key)),
);
/** Safety place categories and their demo ids (`sp-<site>-<suffix>`). */
export const PLACES = Object.freeze({
  hospital: 'hospital',
  police: 'police',
  fire: 'fire',
  embassy: 'embassy',
  rally_primary: 'rally-1',
  rally_secondary: 'rally-2',
  safe_house: 'safe-house',
  relocation: 'relocation',
});
export const HAZARDS = Object.freeze(['storm', 'fire', 'cyclone', 'all']);
const SIM_OF = { storm: 'simStorm', fire: 'simFire', cyclone: 'simCyclone' };
const HAZARD_WORDS = {
  storm: 'the demo storm',
  fire: 'the demo fire boundary',
  cyclone: 'the demo hurricane',
  all: 'every demo',
};
const PLACE_WORDS = {
  hospital: 'the hospital',
  police: 'the police station',
  fire: 'the fire station',
  embassy: 'the embassy',
  rally_primary: 'the primary rally point',
  rally_secondary: 'the secondary rally point',
  safe_house: 'the group shelter',
  relocation: 'the relocation site',
};

const obj = (properties, required = Object.keys(properties)) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const screenArg = { type: 'string', enum: [...SCREENS_ALL] };
const oneScreenArg = { type: 'string', enum: [...SCREENS] };

// ----------------------------------------------------------------- helpers

const target = (args) => (args.screen === 'all' ? 'all' : Number(args.screen));
/** A screen above the room's count is refused, never clamped (F1). */
function noScreen(args, twin) {
  if (args.screen === 'all') return null;
  const n = Number(args.screen);
  const count = twin.state()?.count ?? 6;
  return n > count
    ? { refuse: { code: 'no_screen', say: `There is no screen ${n}.` } }
    : null;
}
const screensCmd = (args, patch) => ({
  type: 'screens',
  target: target(args),
  patch,
});
const currentTrip = (twin) => tripById(twin.state()?.session?.tripId);
/** The site on the walls: its key, or the trip's hotel (null siteKey). */
const currentSite = (twin) =>
  twin.state()?.session?.siteKey || currentTrip(twin).city;
const SCREEN_ARG_ROLE = Object.fromEntries(
  ROLE_ORDER.map((k) => [k, SCREEN_SHORT[k]]),
);

// ------------------------------------------------------------------ screens

const screens = [
  defineCommand({
    name: 'set_screen_layer',
    group: 'Screens',
    station: 'Layers & display',
    title: 'Layer on or off',
    description:
      'Turn one map layer on or off on one screen, or on every screen.',
    inputSchema: obj({
      screen: screenArg,
      layer: { type: 'string', enum: [...LAYERS] },
      on: { type: 'boolean' },
    }),
    heard: { screen: 'screen' },
    tier: 'act',
    raiseWhen: ['pinned', 'reportOpen'],
    emits: { type: 'screens', fields: ['layers'] },
    build: (args, twin) =>
      noScreen(args, twin) ||
      screensCmd(args, { layers: { [args.layer]: args.on } }),
    examples: [
      [
        'Storm radar on screen four',
        { screen: '4', layer: 'radar3d', on: true },
      ],
      [
        'Turn the clouds off everywhere',
        { screen: 'all', layer: 'clouds', on: false },
      ],
      // Live aircraft (29 Oct 2026): the planes are a layer like any other.
      [
        'Show the planes on every screen',
        { screen: 'all', layer: 'aircraft', on: true },
      ],
      [
        'Hide the planes on screen one',
        { screen: '1', layer: 'aircraft', on: false },
      ],
    ],
  }),
  defineCommand({
    name: 'step_screen_text',
    group: 'Screens',
    station: 'Layers & display',
    title: 'Text larger or smaller',
    description:
      'Make the text on one screen one step larger or smaller (one screen, as on the remote).',
    inputSchema: obj({
      screen: oneScreenArg,
      direction: { type: 'string', enum: ['up', 'down'] },
    }),
    heard: { screen: 'screen' },
    tier: 'act',
    raiseWhen: ['pinned', 'reportOpen'],
    emits: { type: 'screens', fields: ['textScale'] },
    build(args, twin) {
      const miss = noScreen(args, twin);
      if (miss) return miss;
      const slot = Number(args.screen);
      const was = Number(twin.state()?.screens?.[slot]?.textScale || 1.75);
      const next = Math.max(
        WALL_TEXT_MIN,
        Math.min(WALL_TEXT_MAX, was + (args.direction === 'up' ? 0.25 : -0.25)),
      );
      if (next === was)
        return {
          refuse: {
            code: 'at_limit',
            say: `Screen ${slot} text is already at its ${args.direction === 'up' ? 'largest' : 'smallest'}.`,
          },
        };
      return screensCmd(args, { textScale: next });
    },
    examples: [['Make screen two bigger', { screen: '2', direction: 'up' }]],
  }),
  defineCommand({
    name: 'set_screen_scale',
    group: 'Screens',
    station: 'Layers & display',
    title: 'Building, neighborhood or city',
    description:
      'Set how much of the area one screen, or every screen, shows: building, neighborhood or city.',
    inputSchema: obj({
      screen: screenArg,
      scale: { type: 'string', enum: [...SCALES] },
    }),
    heard: { screen: 'screen' },
    tier: { one: 'act', all: 'ask' },
    verb: 'Apply',
    raiseWhen: ['pinned', 'reportOpen'],
    emits: { type: 'screens', fields: ['scale'] },
    build: (args, twin) =>
      noScreen(args, twin) || screensCmd(args, { scale: args.scale }),
    examples: [
      ['Site screen to just the building', { screen: '1', scale: 'building' }],
      [
        'Site screen to the whole neighbourhood',
        { screen: '1', scale: 'neighborhood' },
      ],
    ],
  }),
  defineCommand({
    name: 'set_screen_role',
    group: 'Screens',
    station: 'Screens & devices',
    title: 'What a screen shows',
    description: `Change what one screen shows (one screen, as on the remote): ${ROLE_ORDER.map((k) => ROLES[k].label).join(', ')}.`,
    inputSchema: obj({
      screen: oneScreenArg,
      role: { type: 'string', enum: [...ROLE_ORDER] },
    }),
    heard: { screen: 'screen' },
    tier: 'act',
    raiseWhen: ['pinned', 'reportOpen'],
    emits: { type: 'screens', fields: ['role'] },
    build: (args, twin) =>
      noScreen(args, twin) || screensCmd(args, { role: args.role }),
    examples: [
      [
        'Put the people board on screen three',
        { screen: '3', role: 'travelers' },
      ],
    ],
  }),
  defineCommand({
    name: 'set_screen_advance',
    group: 'Screens',
    station: 'Day plan',
    title: 'Advance',
    description:
      'Advance planning, as the remote does: one screen to Advance (or to the day plan for a day), or every screen to Advance for a day.',
    inputSchema: obj(
      {
        screen: screenArg,
        day: { type: 'integer', minimum: 1, maximum: 9 },
      },
      ['screen'],
    ),
    heard: { screen: 'screen' },
    tier: { one: 'act', all: 'ask' },
    verb: 'Apply',
    raiseWhen: ['pinned', 'reportOpen'],
    emits: { type: 'screens', fields: ['mode', 'day', 'role'] },
    build(args, twin) {
      const miss = noScreen(args, twin);
      if (miss) return miss;
      const days = twin.tripDays?.();
      if (args.day != null && days && args.day > days)
        return {
          refuse: { code: 'no_day', say: `The trip has ${days} days.` },
        };
      // The remote: one screen + a day = the day plan for that day (R12);
      // one screen = Advance; every screen = Advance (for the day).
      if (args.screen !== 'all')
        return screensCmd(
          args,
          args.day != null
            ? { role: 'day', day: args.day }
            : { mode: 'advance' },
        );
      return screensCmd(
        args,
        args.day != null
          ? { mode: 'advance', day: args.day }
          : { mode: 'advance' },
      );
    },
    examples: [['Everything to day two planning', { screen: 'all', day: 2 }]],
  }),
  defineCommand({
    name: 'set_screen_live',
    group: 'Screens',
    station: 'Day plan',
    title: 'Back to Live',
    description: 'Put one screen, or every screen, back to Live.',
    inputSchema: obj({ screen: screenArg }),
    heard: { screen: 'screen' },
    tier: { one: 'act', all: 'ask' },
    verb: 'Apply',
    raiseWhen: ['pinned', 'reportOpen'],
    emits: { type: 'screens', fields: ['mode'] },
    build: (args, twin) =>
      noScreen(args, twin) || screensCmd(args, { mode: 'live' }),
    examples: [['Screen five back to live', { screen: '5' }]],
  }),
  defineCommand({
    name: 'frame_screen',
    group: 'Screens',
    station: 'Site',
    title: 'Frame the camera',
    description:
      'Point one screen’s camera, as the remote does: the storm on the Weather screen, the reported floor or a person on the Site screen; or clear its selection.',
    inputSchema: obj(
      {
        screen: oneScreenArg,
        subject: {
          type: 'string',
          enum: ['storm', 'floor', 'person', 'clear'],
        },
        person: { type: 'string', pattern: '^twin-[A-Za-z0-9-]{1,40}$' },
      },
      ['screen', 'subject'],
    ),
    heard: { screen: 'screen', person: 'person' },
    tier: 'act',
    raiseWhen: ['pinned', 'reportOpen'],
    emits: { type: 'screens', fields: ['frame'] },
    build(args, twin) {
      const miss = noScreen(args, twin);
      if (miss) return miss;
      const st = twin.state();
      const role = st?.screens?.[Number(args.screen)]?.role;
      // Only where the remote frames it (stations.js): never another board.
      const needs = { storm: 'weather', floor: 'site', person: 'site' }[
        args.subject
      ];
      if (needs && role !== needs)
        return {
          refuse: {
            code: 'wrong_screen',
            say: `That frames on the ${SCREEN_SHORT[needs]} screen.`,
          },
        };
      let subject;
      if (args.subject === 'floor') {
        const floor = st?.session?.report?.floor ?? twin.reportedFloor?.();
        if (floor == null)
          return {
            refuse: { code: 'no_report', say: 'No floor is reported.' },
          };
        subject = { kind: 'floor', label: floor };
      } else if (args.subject === 'person') {
        if (!args.person)
          return {
            refuse: { code: 'which_person', say: 'Who should it frame?' },
          };
        // Touch frames the spotlit person (stations.js): never anyone else.
        if (st?.session?.spotlight?.id !== args.person)
          return {
            refuse: {
              code: 'not_spotlit',
              say: 'Spotlight them first, then frame them.',
            },
          };
        if (!twin.names.person(args.person))
          return {
            refuse: {
              code: 'no_person',
              say: 'No one by that name on this trip.',
            },
          };
        subject = { kind: 'person', id: args.person };
      } else subject = { kind: args.subject };
      return screensCmd(args, { frame: { subject, nonce: twin.now() } });
    },
    examples: [
      [
        'Frame the storm on the weather screen',
        { screen: '4', subject: 'storm' },
      ],
    ],
  }),
  defineCommand({
    name: 'set_screen_motion',
    group: 'Screens',
    station: 'Layers & display',
    title: 'Motion on or off',
    description:
      'Turn a screen’s motion (live, event and cinematic) on or off.',
    inputSchema: obj({ screen: screenArg, on: { type: 'boolean' } }),
    heard: { screen: 'screen' },
    tier: 'act',
    // Less motion is calmer, never less safe (F1 §6).
    protective: (args) => args.on === false,
    emits: { type: 'screens', fields: ['motion'] },
    build: (args, twin) =>
      noScreen(args, twin) ||
      screensCmd(args, {
        motion: { live: args.on, event: args.on, cine: args.on },
      }),
    examples: [['Stop the movement on screen one', { screen: '1', on: false }]],
  }),
  defineCommand({
    name: 'pin_screen',
    group: 'Screens',
    station: 'Screens & devices',
    title: 'Pin a screen',
    description:
      'Pin one screen so pushes to every screen leave it as it is. One screen only.',
    inputSchema: obj({ screen: oneScreenArg }),
    heard: { screen: 'screen' },
    // Pinning shields a screen from All pushes; Return all still resets it,
    // so a misheard pin cannot block the kill switch (F1 §5, F5 D6).
    tier: 'act',
    emits: { type: 'screens', fields: ['pinned'] },
    build: (args, twin) =>
      noScreen(args, twin) || screensCmd(args, { pinned: true }),
    examples: [['Keep screen six as it is', { screen: '6' }]],
  }),
  defineCommand({
    name: 'reset_screen',
    group: 'Screens',
    station: 'Screens & devices',
    title: 'Reset a screen',
    description: 'Put one screen, or every screen, back to its role defaults.',
    inputSchema: obj({ screen: screenArg }),
    heard: { screen: 'screen' },
    tier: { one: 'act', all: 'ask' },
    verb: 'Reset',
    raiseWhen: ['pinned', 'reportOpen'],
    emits: { type: 'reset' },
    build: (args, twin) =>
      noScreen(args, twin) || { type: 'reset', target: target(args) },
    examples: [['Reset everything', { screen: 'all' }]],
  }),
];

// --------------------------------------------------------------------- wall

const wall = [
  defineCommand({
    name: 'switch_trip',
    group: 'Wall',
    station: 'Trips',
    title: 'Switch trip',
    description: 'Switch every screen to another trip.',
    inputSchema: obj({ trip: { type: 'string', enum: [...TRIPS] } }),
    heard: { trip: 'trip' },
    tier: 'ask',
    verb: 'Switch',
    emits: {
      type: 'session',
      fields: [
        'tripId',
        'siteKey',
        'spotlight',
        'report',
        'incidentAck',
        'simStorm',
        'simFire',
        'simCyclone',
      ],
    },
    question: (args) => {
      const t = tripById(args.trip);
      return `That switches every screen to the ${t.title}, ${t.org}`;
    },
    build(args, twin) {
      const ss = twin.state()?.session || {};
      if (args.trip === ss.tripId)
        return {
          refuse: {
            code: 'same_trip',
            say: 'That trip is already on the walls.',
          },
        };
      // A switch closes the open report: clearing a report is touch only.
      if (ss.report)
        return {
          refuse: {
            code: 'report_open',
            say: 'A report is open. Switch trips on the remote, in Trips.',
          },
        };
      return {
        type: 'session',
        patch: {
          tripId: args.trip,
          siteKey: null,
          spotlight: null,
          report: null,
          incidentAck: null,
          simStorm: null,
          simFire: null,
          simCyclone: null,
        },
      };
    },
    examples: [['Switch to the London trip', { trip: 'trip-youth-london' }]],
  }),
  defineCommand({
    name: 'go_to_site',
    group: 'Wall',
    station: 'Day plan',
    title: 'Go to a site',
    description: 'Move every screen to another site of the trip on the walls.',
    inputSchema: obj({ site: { type: 'string', enum: [...SITES] } }),
    heard: { site: 'site' },
    tier: 'ask',
    verb: 'Go',
    emits: { type: 'session', fields: ['siteKey'] },
    question: (args, state) =>
      `Every screen to ${args.site === tripById(state?.session?.tripId).city ? 'the hotel' : siteConfig(args.site)?.short || args.site}`,
    build(args, twin) {
      const trip = currentTrip(twin);
      const site = siteConfig(args.site);
      const here = sitesForCity(trip.city).some((s) => s.key === args.site);
      if (!here) {
        const other = DEMO_TRIPS.find((t) =>
          sitesForCity(t.city).some((s) => s.key === args.site),
        );
        return {
          refuse: {
            code: 'other_trip',
            say: `${site?.short || args.site} is on the ${other?.title || 'another trip'}. Switch trips first.`,
            offer: other
              ? { name: 'switch_trip', args: { trip: other.id } }
              : null,
          },
        };
      }
      return {
        type: 'session',
        patch: { siteKey: args.site === trip.city ? null : args.site },
      };
    },
    examples: [
      ['Go to the Long Center', { site: 'austin-long-center' }],
      ['Back to the hotel', { site: 'austin' }],
    ],
  }),
  defineCommand({
    name: 'spotlight_person',
    group: 'Wall',
    station: 'People',
    title: 'Spotlight a person',
    description: 'Spotlight one traveller on every screen.',
    inputSchema: obj({
      person: { type: 'string', pattern: '^twin-[A-Za-z0-9-]{1,40}$' },
    }),
    heard: { person: 'person' },
    tier: 'act',
    raiseWhen: ['reportOpen'],
    emits: { type: 'session', fields: ['spotlight'] },
    build: (args, twin) =>
      !twin.names.person(args.person)
        ? {
            refuse: {
              code: 'no_person',
              say: 'No one by that name on this trip.',
            },
          }
        : {
            type: 'session',
            patch: { spotlight: { kind: 'person', id: args.person } },
          },
    examples: [['Show me Noah', { person: 'twin-NF' }]],
  }),
  defineCommand({
    name: 'spotlight_place',
    group: 'Wall',
    station: 'Site',
    title: 'Spotlight a safety place',
    description: 'Spotlight a safety place of the site on every screen.',
    inputSchema: obj({ place: { type: 'string', enum: Object.keys(PLACES) } }),
    tier: 'act',
    raiseWhen: ['reportOpen'],
    emits: { type: 'session', fields: ['spotlight'] },
    build(args, twin) {
      const id = `sp-${currentSite(twin)}-${PLACES[args.place]}`;
      // Only a place this site has (a venue has no relocation site).
      if (!twin.names.place(id))
        return {
          refuse: {
            code: 'no_place',
            say: `This site has no ${PLACE_WORDS[args.place].replace(/^the /, '')}.`,
          },
        };
      return { type: 'session', patch: { spotlight: { kind: 'place', id } } };
    },
    examples: [['Where is the hospital', { place: 'hospital' }]],
  }),
  defineCommand({
    name: 'set_weather_time',
    group: 'Wall',
    station: 'Weather',
    title: 'Weather ahead',
    description:
      'Show the weather a number of minutes ahead (or 30 back) on every screen.',
    inputSchema: obj({ minutes: { type: 'integer', enum: [...LENS_MINUTES] } }),
    tier: 'act',
    raiseWhen: ['reportOpen'],
    emits: { type: 'session', fields: ['wxAt'] },
    build: (args, twin) => ({
      type: 'session',
      patch: { wxAt: twin.now() + args.minutes * 60e3 },
    }),
    examples: [['Weather in half an hour', { minutes: 30 }]],
  }),
  defineCommand({
    name: 'set_weather_now',
    group: 'Wall',
    station: 'Weather',
    title: 'Weather now',
    description: 'Put the weather back to now on every screen.',
    tier: 'act',
    emits: { type: 'session', fields: ['wxAt'] },
    build: () => ({ type: 'session', patch: { wxAt: null } }),
    examples: [['Weather back to now', {}]],
  }),
  defineCommand({
    name: 'return_all_live',
    group: 'Wall',
    station: 'Screens & devices',
    title: 'Return all',
    description:
      'Every screen, pinned ones too, back to Live and its role defaults; ends the demos, the lens and the spotlight.',
    tier: 'ask',
    verb: 'Return',
    emits: { type: 'returnLive' },
    question: (args, state) => {
      const ss = state?.session || {};
      const demos = [
        ss.simStorm && 'storm',
        ss.simFire && 'fire boundary',
        ss.simCyclone && 'hurricane',
      ].filter(Boolean);
      return `Every screen, pinned ones too, back to Live and its role defaults${demos.length ? `. The simulated ${demos.join(' and ')} ${demos.length > 1 ? 'end' : 'ends'}` : ''}`;
    },
    build: () => ({ type: 'returnLive' }),
    examples: [['Put everything back to live', {}]],
  }),
];

// --------------------------------------------------------------- protective

const protective = [
  defineCommand({
    name: 'visitor_on',
    group: 'Protective',
    station: 'Screens & devices',
    title: 'Visitor mode on',
    description: 'Turn Visitor mode on: walls show initials and counts only.',
    tier: 'act',
    protective: true,
    emits: { type: 'session', fields: ['visitor'] },
    already: (args, state) =>
      state?.session?.visitor ? 'Visitor mode is already on.' : null,
    build: () => ({ type: 'session', patch: { visitor: true } }),
    examples: [['Visitors are coming in', {}]],
  }),
  defineCommand({
    name: 'stop_demo',
    group: 'Protective',
    station: 'Weather',
    title: 'Stop a demo',
    description:
      'End the demo storm, the demo fire boundary, the demo hurricane, or every demo.',
    // "Stop the demo" with no name ends every demo that runs.
    inputSchema: obj({ hazard: { type: 'string', enum: [...HAZARDS] } }, []),
    tier: 'act',
    protective: true,
    already: (args, state) => {
      const ss = state?.session || {};
      const h = args.hazard || 'all';
      const running = Object.keys(SIM_OF).filter((k) => ss[SIM_OF[k]]);
      if (h === 'all') return running.length ? null : 'No demo is running.';
      if (ss[SIM_OF[h]]) return null;
      // Never "no demo" while another runs (F11/F16 R2).
      return `The ${HAZARD_WORDS[h].replace(/^the demo /, 'simulated ')} isn't running.${running.length ? ` The ${running.map((k) => HAZARD_WORDS[k].replace(/^the demo /, 'simulated ')).join(' and ')} is on.` : ''}`;
    },
    emits: { type: 'session', fields: ['simStorm', 'simFire', 'simCyclone'] },
    build: (args) => ({
      type: 'session',
      patch:
        (args.hazard || 'all') === 'all'
          ? { simStorm: null, simFire: null, simCyclone: null }
          : { [SIM_OF[args.hazard]]: null },
    }),
    examples: [['Stop the demo storm', { hazard: 'storm' }]],
  }),
];

// ------------------------------------------------------- Fitzroy controls

const controls = [
  defineCommand({
    name: 'undo_last',
    group: 'Fitzroy',
    title: 'Undo',
    description: 'Undo the last change this device made, within 10 seconds.',
    tier: 'act',
    words: ['undo', 'undo that', 'take that back'],
    // What was undone is spoken from the relay's answer in V1.
    reply: 'Undone.',
    emits: { t: 'undo' },
    build: (args, twin) => {
      const last = twin.lastUndo?.();
      return last?.undoId
        ? { t: 'undo', undoId: last.undoId }
        : { refuse: { code: 'nothing_to_undo', say: 'Nothing to undo.' } };
    },
  }),
  defineCommand({
    name: 'mute_voice',
    group: 'Fitzroy',
    title: 'Mute voice',
    description: 'Stop listening until voice is unmuted on the remote.',
    tier: 'act',
    protective: true,
    effect: 'device',
    words: ['mute voice', 'stop listening'],
    reply: 'Voice muted. Unmute on the remote.',
  }),
  defineCommand({
    name: 'stop_speaking',
    group: 'Fitzroy',
    title: 'Stop speaking',
    description: 'Cut Fitzroy’s reply short; cancels an open question.',
    tier: 'act',
    protective: true,
    effect: 'device',
    words: ['stop', 'quiet', "that's enough"],
    reply: '',
  }),
  defineCommand({
    name: 'reply_yes',
    group: 'Fitzroy',
    title: 'Yes',
    description: 'Answer yes to the one open question from this device.',
    tier: 'act',
    effect: 'device',
    words: ['yes', 'confirm', 'do it'],
    reply: '',
  }),
  defineCommand({
    name: 'reply_cancel',
    group: 'Fitzroy',
    title: 'Cancel',
    description: 'Cancel the open question.',
    tier: 'act',
    effect: 'device',
    words: ['cancel', 'no', 'never mind'],
    reply: 'Cancelled. Nothing changed.',
  }),
  defineCommand({
    name: 'reply_unsure',
    group: 'Fitzroy',
    title: 'Unsure',
    description: 'An answer that is neither yes nor cancel.',
    tier: 'act',
    effect: 'device',
    reply: 'Say yes or cancel.',
  }),
];

// --------------------------------------------------------------- touch only

const touchOnly = (name, title, description, action, station, extra = {}) =>
  defineCommand({
    name,
    group: 'Touch only',
    station,
    title,
    description,
    tier: 'touch',
    refusal: {
      code: 'touch_only',
      // A null station: "Touch only: that is on the remote." (remote_only).
      // Spoken: "Screens and devices" (the remote's pane, "&" said as "and").
      say: station
        ? `Touch only: ${action} on the remote, in ${station.replace(/&/g, 'and')}.`
        : `Touch only: ${action} on the remote.`,
    },
    ...extra,
  });

const touch = [
  touchOnly(
    'visitor_off',
    'Visitor mode off',
    'Bring names back on the walls.',
    'turn Visitor mode off',
    'Screens & devices',
    {
      examples: [['Bring the names back', {}]],
    },
  ),
  touchOnly(
    'unpin_screen',
    'Unpin a screen',
    'Unpin a screen.',
    'unpin',
    'Screens & devices',
    {
      inputSchema: obj({ screen: oneScreenArg }),
      heard: { screen: 'screen' },
      examples: [['Unpin screen three', { screen: '3' }]],
    },
  ),
  touchOnly(
    'start_demo',
    'Start a demo',
    'Start the demo storm, fire boundary or hurricane.',
    'start a demo',
    'Weather',
    {
      inputSchema: obj({
        hazard: { type: 'string', enum: ['storm', 'fire', 'cyclone'] },
      }),
      examples: [['Start the demo storm', { hazard: 'storm' }]],
    },
  ),
  touchOnly(
    'set_screen_count',
    'Screen count',
    'Change how many screens the room has.',
    'change the number of screens',
    'Screens & devices',
    {
      inputSchema: obj({ count: { type: 'integer', minimum: 1, maximum: 6 } }),
      examples: [['Use four screens', { count: 4 }]],
    },
  ),
  touchOnly(
    'report_incident',
    'Report an incident',
    'Add a reported floor or incident.',
    'add the reported floor',
    'Incident',
    {
      examples: [['Report a medical on floor eleven', {}]],
    },
  ),
  touchOnly(
    'clear_report',
    'Clear the report',
    'Clear the reported floor.',
    'clear the reported floor',
    'Incident',
    {
      examples: [['Clear the report', {}]],
    },
  ),
  touchOnly(
    'acknowledge_incident',
    'Acknowledge',
    'Acknowledge the open report.',
    'acknowledge',
    'Incident',
    {
      examples: [['Acknowledge the incident', {}]],
    },
  ),
  touchOnly(
    'clear_spotlight',
    'Clear the spotlight',
    'Clear the spotlight (the remote clears it with Return all).',
    'clear the spotlight with Return all',
    'Screens & devices',
    { examples: [['Clear the spotlight', {}]] },
  ),
  touchOnly(
    'remote_only',
    'Remote only',
    'Wall controls, layout, the traffic camera, street photos and review: on the remote.',
    'that is',
    null,
    {
      inputSchema: obj(
        {
          topic: {
            type: 'string',
            enum: [
              'wall_controls',
              'layout',
              'traffic_camera',
              'street_photo',
              'review',
            ],
          },
        },
        [],
      ),
      examples: [
        [
          'Show the traffic camera on the site wall',
          { topic: 'traffic_camera' },
        ],
      ],
    },
  ),
  touchOnly(
    'manage_devices',
    'Devices',
    'Pair, hand over, set up, identify or revoke a device.',
    'pairing and hand-over are',
    'Screens & devices',
    {
      examples: [['Pair the new iPad', {}]],
    },
  ),
];

/** Every entry, in docs order: {tool, policy}. */
export const FITZROY_COMMANDS = Object.freeze([
  ...screens,
  ...wall,
  ...protective,
  ...controls,
  ...touch,
]);
export const FITZROY_NAMES = Object.freeze(
  FITZROY_COMMANDS.map((c) => c.tool.name),
);

/** What Fitzroy hears that is no command (no message, ever). */
export const NON_COMMANDS = Object.freeze([
  {
    intent: 'question',
    say: 'Questions are not on yet. Nothing changed.',
    phase: 'V2',
  },
  { intent: 'route', say: 'Routes come later. Nothing changed.', phase: 'V4' },
  { intent: 'unclear', say: "I didn't catch a command." },
  { intent: 'not_for_system', say: '' },
]);

/** The only words that mean every screen: 'all' is never inferred (F2 §4). */
export const ALL_SCREENS_WORDS = Object.freeze([
  'all screens',
  'every screen',
  'all the screens',
  'everywhere',
]);

/** Spoken names for docs and the lab grammar (keys are catalog ids). */
export const SPOKEN = Object.freeze({
  layer: Object.fromEntries(LAYERS.map((k) => [k, spokenLayer(k)])),
  // Other words people use for a layer, for the lab's next rules round (the
  // frozen v2 rules do not know these yet).
  layerAlso: { aircraft: ['planes', 'aircraft', 'flights', 'air traffic'] },
  role: SCREEN_ARG_ROLE,
  place: PLACE_WORDS,
  hazard: HAZARD_WORDS,
});
