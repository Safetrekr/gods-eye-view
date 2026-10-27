// Generated views of the Fitzroy catalog (review/fitzroy-commands F5 D10).
// Pure: scripts/fitzroy-catalog.mjs writes them; a test checks they match.
// - toLlamaSchema: the voice lab's llama-server grammar (anyOf/const are an
//   export format only: upstream's schema subset forbids them in tools).
// - toFunctions: upstream toFunctionTools, touch and device entries left out.
// - toAnswerKey: the V0 cards as {card, kind, command, args, tier, …}.
// - toMarkdown: docs/trip-twin/FITZROY-COMMANDS.md.
import { toFunctionTools } from '../../../tools/functions.js';
import { FITZROY_POLICY } from './fitzroyCommand.js';
import { FITZROY_COMMANDS, NON_COMMANDS } from './fitzroyCommands.js';
import { V0_CARDS } from './fitzroyCards.js';

const HEARD_MAX = 60;

/** One llama branch per entry; heard slots are free words for the resolver. */
export function toLlamaSchema(commands = FITZROY_COMMANDS) {
  const branches = commands.map(({ tool, policy }) => {
    const props = { intent: { const: tool.name } };
    for (const [k, s] of Object.entries(tool.inputSchema.properties || {}))
      props[k] = policy.heard[k]
        ? { type: 'string', maxLength: HEARD_MAX }
        : structuredClone(s);
    return {
      type: 'object',
      properties: props,
      required: ['intent', ...(tool.inputSchema.required || [])],
      additionalProperties: false,
    };
  });
  for (const n of NON_COMMANDS)
    branches.push({
      type: 'object',
      properties: { intent: { const: n.intent } },
      required: ['intent'],
      additionalProperties: false,
    });
  return { anyOf: branches };
}

/** Function tools for a future local tool-calling model. */
export function toFunctions(commands = FITZROY_COMMANDS) {
  const skip = commands
    .filter(({ policy }) => policy.effect !== 'relay')
    .map(({ tool }) => tool.name);
  return toFunctionTools(
    commands.map(({ tool }) => tool),
    { exclude: skip },
  );
}

/** The base tier for a card's args (context may raise it, never lower). */
export function baseTier(name, args = {}) {
  const p = FITZROY_POLICY.get(name);
  if (!p) return null;
  return args.screen === 'all' ? p.tier.all : p.tier.one;
}

export function toAnswerKey(cards = V0_CARDS) {
  return cards.map((k) =>
    k.kind === 'none'
      ? { card: k.card, kind: 'none', intent: k.intent, note: k.note }
      : {
          card: k.card,
          kind: k.kind,
          command: k.command,
          args: k.args,
          // What a scorer expects: a control, a clarifying question, a
          // refusal (card 46), else the entry's base tier (F14 P1).
          tier:
            k.kind === 'clarify'
              ? 'clarify'
              : FITZROY_POLICY.get(k.command)?.group === 'Fitzroy'
                ? 'control'
                : /^refused/.test(k.note || '')
                  ? 'refused'
                  : baseTier(k.command, k.args),
          ...(k.ask ? { ask: k.ask } : {}),
          ...(k.note ? { note: k.note } : {}),
        },
  );
}

const TIER_WORD = {
  act: 'act',
  ask: 'ask first',
  touch: 'touch only',
  control: 'control',
  clarify: 'asks which',
  refused: 'refused',
};
const cell = (s) =>
  String(s ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\n/g, ' ');
const cmdText = (m) =>
  !m
    ? '—'
    : m.t === 'undo'
      ? '`{t: undo}`'
      : `\`${m.cmd.type}${m.cmd.target != null ? ` ${m.cmd.target}` : ''}${m.cmd.patch ? ` ${JSON.stringify(m.cmd.patch).replace(/"/g, '')}` : ''}\``;

/** Docs headings: plain words, not safety-system language (F15 P2). */
const GROUP_HEADING = {
  Protective: 'Always act (they make the wall calmer)',
  Fitzroy: 'Answers and controls',
};

/**
 * rows: [{name, say, example, proposal}] filled by the script from the
 * Austin demo session, so "Fitzroy says" is the exact string; variants:
 * [{situation, example, say}] for a wall that is not plain.
 */
export function toMarkdown(rows, { cards = V0_CARDS, variants = [] } = {}) {
  const out = [];
  out.push('# Fitzroy commands');
  out.push('');
  out.push(
    'Generated from `src/operations/tripTwin/fitzroy/` by `node scripts/fitzroy-catalog.mjs`. Do not edit: change the catalog and run the script (a test fails when this file drifts).',
  );
  out.push('');
  out.push(
    '"Fitzroy" is a working name: the conflict screen and trademark clearance are still open (plans/trip-twin/VOICE-CONTROL.md).',
  );
  out.push('');
  out.push(
    'Fitzroy is Trip Twin’s local voice assistant ("Hey Fitzroy"). It only proposes what touch can already do; the device sends the existing command. Nothing here is built into a voice pipeline yet.',
  );
  out.push('');
  out.push(
    '- **act**: it acts and reads back what changed; "undo" takes back this device’s last change for 10 seconds, never a protective one.',
  );
  out.push(
    '- **ask first**: one closed question ("… Switch now?"); "yes", "confirm" or "do it" applies it, "cancel" drops it, 10 seconds. A raised question says why first ("Screen 4 is pinned.").',
  );
  out.push(
    '- **touch only**: it says where on the remote, and changes nothing.',
  );
  out.push(
    '- Context only raises a tier (a pinned screen, an open incident, anything touch asks about); the calming commands always act.',
  );
  out.push('');
  out.push(
    'Fitzroy says: read from the Austin demo, six screens (1 Site, 2 People, 3 Incident, 4 Weather, 5 Day plan, 6 Trips), no report open.',
  );
  const groups = [
    ...new Set(rows.map((r) => FITZROY_POLICY.get(r.name).group)),
  ];
  for (const g of groups) {
    out.push('');
    out.push(`## ${GROUP_HEADING[g] || g}`);
    out.push('');
    out.push(
      '| Command | You might say | What changes | Tier (one / all) | Fitzroy says |',
    );
    out.push('|---|---|---|---|---|');
    for (const r of rows.filter(
      (x) => FITZROY_POLICY.get(x.name).group === g,
    )) {
      const p = FITZROY_POLICY.get(r.name);
      const tier =
        p.tier.one === p.tier.all
          ? TIER_WORD[p.tier.one]
          : `${TIER_WORD[p.tier.one]} / ${TIER_WORD[p.tier.all]}`;
      const words = p.words
        ? p.words.map((w) => `"${w}"`).join(', ')
        : r.example
          ? `"${r.example}"`
          : '';
      // A yes reads back the change it answered; stop is silent.
      const say =
        r.say ||
        (r.name === 'reply_yes'
          ? '(reads back the change it answered)'
          : '(no words: a tone)');
      out.push(
        `| \`${r.name}\` | ${cell(words)} | ${cell(cmdText(r.proposal?.message))} | ${tier} | ${cell(say)} |`,
      );
    }
  }
  if (variants.length) {
    out.push('');
    out.push('## When the wall is not plain');
    out.push('');
    out.push('| Situation | You might say | Fitzroy says |');
    out.push('|---|---|---|');
    for (const v of variants)
      out.push(
        `| ${cell(v.situation)} | "${cell(v.example)}" | ${cell(v.say)} |`,
      );
  }
  out.push('');
  out.push('## Not commands');
  out.push('');
  for (const n of NON_COMMANDS)
    out.push(
      `- \`${n.intent}\`${n.phase ? ` (${n.phase})` : ''}: ${n.say ? `"${n.say}"` : 'no reply'}`,
    );
  out.push('');
  out.push('## V0 cards');
  out.push('');
  out.push('| Card | Maps to | Expect |');
  out.push('|---|---|---|');
  for (const k of toAnswerKey(cards))
    out.push(
      `| ${k.card} | ${k.kind === 'none' ? `no command (${k.intent})` : `\`${k.command}\` ${cell(JSON.stringify(k.args).replace(/"/g, ''))}${k.ask ? ` → "${cell(k.ask)}"` : ''}`}${k.note ? ` · ${cell(k.note)}` : ''} | ${k.tier ? TIER_WORD[k.tier] : '—'} |`,
    );
  out.push('');
  return out.join('\n');
}
