// The Fitzroy catalog (review/fitzroy-commands F5 D1, D5, D7): upstream's
// composeCatalog over the Fitzroy entries only (never coreTools, never MCP),
// with one outermost guard. A call returns a PROPOSAL; nothing is sent.
//
// propose(name, args) → {name, tier: 'act'|'ask'|'touch', message,
//   readBack, question, refusal, effect}
// The guard refuses an actor field, a field the entry does not declare, or
// anything that lowers protection; then it sets the tier (raised, never
// lowered) and the words.
import { composeCatalog } from '../../../tools/catalog.js';
import { FITZROY_COMMANDS } from './fitzroyCommands.js';
import { FITZROY_POLICY } from './fitzroyCommand.js';

const policy = (name) => FITZROY_POLICY.get(name);
import { ACTOR_FIELDS, lowersProtection, tierFor } from './fitzroyPolicy.js';
import { closedQuestion, readBack } from './fitzroySpeech.js';

const refused = (code, say) => ({ code, say });

/** The guard: one outermost interceptor (upstream `(call, next)`). */
export function fitzroyGuard(twin) {
  return async (call, next) => {
    const result = await next(call);
    const policy = FITZROY_POLICY.get(call.tool.name);
    const data = {
      ...result.data,
      tier: tierFor(policy, call.args, null, twin.state()),
    };
    const msg = data.message;
    if (data.refusal || !msg) return { ...result, data };
    const state = twin.state();
    if (msg.t === 'cmd') {
      const cmd = msg.cmd;
      if (ACTOR_FIELDS.some((k) => k in cmd))
        return {
          ...result,
          data: {
            ...data,
            message: null,
            refusal: refused('actor_field', 'Nothing changed.'),
          },
        };
      const emits = policy.emits;
      const fields = Object.keys(cmd.patch || {});
      if (
        !emits ||
        emits.type !== cmd.type ||
        (emits.fields && fields.some((f) => !emits.fields.includes(f)))
      )
        return {
          ...result,
          data: {
            ...data,
            message: null,
            refusal: refused('undeclared', 'Nothing changed.'),
          },
        };
      const lower = lowersProtection(msg, state);
      if (lower)
        return {
          ...result,
          data: {
            ...data,
            message: null,
            refusal: refused(
              'lowers_protection',
              lower === 'safety layer off'
                ? 'That layer stays on while a report is open.'
                : 'Touch only: do that on the remote.',
            ),
          },
        };
    }
    const tier = tierFor(policy, call.args, msg, state);
    if (msg.t === 'undo')
      // What was undone is known when the relay answers (V1 speaks it).
      return {
        ...result,
        data: { ...data, tier, readBack: policy.reply, question: null },
      };
    const words = readBack(msg, state, { now: twin.now(), names: twin.names });
    // A command that changes nothing is never sent, asked or read back.
    if (words === 'Nothing changed.')
      return {
        ...result,
        data: {
          ...data,
          message: null,
          refusal: refused('no_change', 'Nothing changed.'),
        },
      };
    const question =
      tier === 'ask'
        ? closedQuestion(
            policy.question ? policy.question(call.args, state) : words,
            policy.verb || 'Apply',
          )
        : null;
    return { ...result, data: { ...data, tier, readBack: words, question } };
  };
}

/**
 * twin: {state() → session state, now() → ms, lastUndoId?() → id,
 * names?: {person(id), place(id)}}.
 */
export function createFitzroyCatalog({ twin }) {
  const catalog = composeCatalog({
    tools: FITZROY_COMMANDS.map((c) => c.tool),
    services: { twin },
    interceptors: [fitzroyGuard(twin)],
  });
  return Object.freeze({
    list: catalog.list,
    /** A proposal for one heard command; never sends anything. */
    async propose(name, args = {}) {
      const r = await catalog.call(name, args);
      const d = r.data;
      return {
        name,
        tier: d.refusal ? (d.tier === 'touch' ? 'touch' : 'refused') : d.tier,
        message: d.message,
        readBack: d.readBack ?? null,
        question: d.question ?? null,
        refusal: d.refusal ?? null,
        effect: d.effect,
        say: d.refusal
          ? d.refusal.say
          : d.effect === 'device'
            ? policy(name).reply
            : d.tier === 'ask'
              ? d.question
              : d.readBack,
      };
    },
  });
}
