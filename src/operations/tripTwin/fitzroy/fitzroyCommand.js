// Fitzroy command entries (review/fitzroy-commands F5 D1). Each entry is a
// real upstream tool (src/tools/catalog.js defineTool, kind 'action') whose
// run() BUILDS the Trip Twin message and never sends it: voice proposes, the
// device submits. defineTool keeps only its own fields, so Trip Twin's
// policy (tier, protective, words) lives in a frozen side table by name.
import { defineTool } from '../../../tools/catalog.js';
import { SCREEN_KEYS, SESSION_KEYS } from '../twinDescribe.js';

export const TIERS = Object.freeze(['act', 'ask', 'touch']);
const EMPTY = Object.freeze({
  type: 'object',
  properties: {},
  additionalProperties: false,
});

/** name → policy (frozen): the Trip Twin half of every entry. */
export const FITZROY_POLICY = new Map();

const asTier = (t) =>
  typeof t === 'string' ? { one: t, all: t } : { one: t.one, all: t.all };

/**
 * spec: {name, group, title, description, inputSchema?, tier ('act' |
 * 'ask' | 'touch', or {one, all}), protective? (bool or args → bool),
 * raiseWhen? ['pinned' | 'reportOpen'], heard? {arg: 'screen'|'trip'|…},
 * emits? {type, fields} | {t: 'undo'}, effect ('relay' | 'device' |
 * 'none'), build?(args, twin) → cmd | {refuse: {code, say}}, question?
 * (args, ctx) → words, verb?, refusal? {code, say}, words? [utterances]
 * (whole-utterance controls), reply?, already?(args, state) → words when
 * it is so already, station?, examples? [phrases]}.
 */
export function defineCommand(spec) {
  const {
    name,
    group,
    title,
    description,
    inputSchema = EMPTY,
    protective = false,
    raiseWhen = [],
    heard = {},
    emits = null,
    effect = 'relay',
    build = null,
    question = null,
    verb = null,
    refusal = null,
    words = null,
    reply = null,
    already = null,
    station = null,
    examples = [],
  } = spec;
  const tier = asTier(spec.tier);
  for (const t of [tier.one, tier.all])
    if (!TIERS.includes(t)) throw new TypeError(`${name}: tier ${t}`);
  const touch = tier.one === 'touch';
  if (touch && (build || !refusal?.say))
    throw new TypeError(`${name}: a touch entry has a refusal, never build`);
  if (!touch && effect === 'relay' && typeof build !== 'function')
    throw new TypeError(`${name}: a relay entry needs build()`);
  if (protective === true && (tier.one !== 'act' || tier.all !== 'act'))
    throw new TypeError(`${name}: protective entries always act`);
  const props = inputSchema.properties || {};
  for (const k of Object.keys(heard))
    if (!(k in props))
      throw new TypeError(`${name}: heard ${k} is no argument`);
  if (emits?.fields) {
    const known = emits.type === 'screens' ? SCREEN_KEYS : SESSION_KEYS;
    for (const f of emits.fields)
      if (!known.includes(f)) throw new TypeError(`${name}: emits ${f}`);
  }
  if ((tier.one === 'ask' || tier.all === 'ask') && !verb)
    throw new TypeError(`${name}: an ask entry names its verb`);
  if (words && !words.every((w) => w === w.toLowerCase()))
    throw new TypeError(`${name}: control words are lower case`);
  const tool = defineTool({
    name,
    kind: 'action',
    title,
    description,
    inputSchema,
    requires: ['twin'],
    annotations: { destructiveHint: false, openWorldHint: false },
    async run(args, { services }) {
      if (touch)
        return {
          summary: refusal.say,
          data: { message: null, effect: 'none', refusal },
        };
      if (effect === 'device')
        return {
          summary: reply || title,
          data: { message: null, effect: 'device', control: name },
        };
      const built = build(args, services.twin);
      if (built?.refuse)
        return {
          summary: built.refuse.say,
          data: { message: null, effect: 'none', refusal: built.refuse },
        };
      const message = built.t === 'undo' ? built : { t: 'cmd', cmd: built };
      return { summary: title, data: { message, effect: 'relay' } };
    },
  });
  const policy = Object.freeze({
    name,
    group,
    tier: Object.freeze(tier),
    protective,
    raiseWhen: Object.freeze([...raiseWhen]),
    heard: Object.freeze({ ...heard }),
    emits: emits ? Object.freeze({ ...emits }) : null,
    effect: touch ? 'none' : effect,
    question,
    verb,
    refusal: refusal ? Object.freeze({ ...refusal }) : null,
    words: words ? Object.freeze([...words]) : null,
    reply,
    already,
    station,
    examples: Object.freeze([...examples]),
  });
  if (FITZROY_POLICY.has(name)) throw new TypeError(`Duplicate entry ${name}`);
  FITZROY_POLICY.set(name, policy);
  return { tool, policy };
}
