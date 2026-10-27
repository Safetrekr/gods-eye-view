// The Fitzroy catalog (review/fitzroy-commands F5 D1, D5, D7; F20): upstream's
// composeCatalog over the Fitzroy entries only (never coreTools, never MCP),
// with one outermost guard. A call returns a PROPOSAL; nothing is sent.
//
// propose(name, args) → {name, args, rev, tier: 'act'|'ask'|'touch'|
//   'refused', message, readBack, question, refusal, effect, say}
// recheck(proposal) runs it again at "yes": a wall that moved meanwhile
// gets "The wall changed. Ask again." (F4 §4).
//
// The guard refuses an actor field, a field the entry does not declare,
// anything that lowers protection (undo included), and a command that
// changes nothing; then it sets the tier (raised, never lowered) and the
// words, and a raised question says why.
import { composeCatalog } from '../../../tools/catalog.js';
import { describeCommand } from '../twinDescribe.js';
import { SIM_KEYS } from '../twinSession.js';
import { FITZROY_COMMANDS } from './fitzroyCommands.js';
import { FITZROY_POLICY } from './fitzroyCommand.js';
import { ACTOR_FIELDS, lowersProtection, tierFor } from './fitzroyPolicy.js';
import { closedQuestion, speakChange } from './fitzroySpeech.js';

const policyOf = (name) => FITZROY_POLICY.get(name);
const NOTHING = 'Nothing changed.';
const refusal = (data, code, say, tier = 'refused') => ({
  ...data,
  message: null,
  effect: 'none',
  tier,
  refusal: { code, say },
});

/** Would undoing this change make the wall less safe? (Visitor off, a demo back.) */
function undoLowers(last) {
  if (!last?.message?.cmd || !last.before) return false;
  const change = describeCommand(last.message.cmd, last.before);
  return Boolean(
    change?.parts.some(
      (p) =>
        (p.field === 'visitor' && p.to?.value === true) ||
        (SIM_KEYS.includes(p.field) &&
          p.to?.value == null &&
          last.before.session?.[p.field]),
    ),
  );
}

/** The guard: one outermost interceptor (upstream `(call, next)`). */
export function fitzroyGuard(twin) {
  return async (call, next) => {
    const state = twin.state();
    const policy = policyOf(call.tool.name);
    if (!state?.session)
      return {
        summary: NOTHING,
        data: refusal({}, 'no_state', NOTHING),
      };
    const ctx = { incidentOpen: Boolean(twin.incidentOpen?.()) };
    const result = await next(call);
    const data = { ...result.data };
    const base = tierFor(policy, call.args, null, state, ctx).tier;
    if (data.refusal)
      return {
        ...result,
        data: { ...data, tier: base === 'touch' ? 'touch' : 'refused' },
      };
    const msg = data.message;
    if (!msg) return { ...result, data: { ...data, tier: base } };
    if (msg.t === 'undo') {
      // Undo by voice never takes back a protective change (F16 P0-1).
      if (undoLowers(twin.lastUndo?.()))
        return {
          ...result,
          data: refusal(
            data,
            'undo_protective',
            'Touch only: undo that on the remote, in Screens and devices.',
          ),
        };
      return {
        ...result,
        data: { ...data, tier: 'act', readBack: policy.reply, question: null },
      };
    }
    const cmd = msg.cmd;
    if (ACTOR_FIELDS.some((k) => k in cmd))
      return { ...result, data: refusal(data, 'actor_field', NOTHING) };
    const emits = policy.emits;
    const fields = Object.keys(cmd.patch || {});
    if (
      !emits ||
      emits.type !== cmd.type ||
      (emits.fields && fields.some((f) => !emits.fields.includes(f)))
    )
      return { ...result, data: refusal(data, 'undeclared', NOTHING) };
    const lower = lowersProtection(msg, state, ctx);
    if (lower)
      return {
        ...result,
        data: refusal(
          data,
          'lowers_protection',
          lower === 'safety layer off'
            ? 'That layer stays on while an incident is open.'
            : lower === 'demo layer off'
              ? 'That layer stays on while the demo runs.'
              : 'Touch only: do that on the remote.',
        ),
      };
    const already = policy.already?.(call.args, state);
    if (already) return { ...result, data: refusal(data, 'already', already) };
    // A command that changes nothing is never sent, asked or read back;
    // every screen pinned is said so (F16 P1-5).
    const change = describeCommand(cmd, state, { at: twin.now() });
    if (!change?.parts.length)
      return {
        ...result,
        data: refusal(
          data,
          'no_change',
          change?.pinned.length
            ? 'Every screen is pinned. Nothing changed.'
            : NOTHING,
        ),
      };
    const words = speakChange(change, state, {
      visitor: Boolean(state.session.visitor),
      names: twin.names,
    });
    const { tier, why } = tierFor(policy, call.args, msg, state, ctx);
    const what = policy.question ? policy.question(call.args, state) : words;
    const question =
      tier === 'ask'
        ? closedQuestion(why ? `${why}. ${what}` : what, policy.verb || 'Apply')
        : null;
    return { ...result, data: { ...data, tier, readBack: words, question } };
  };
}

/**
 * twin: {state() → session state, now() → ms, lastUndo?() → {undoId,
 * message, before}, incidentOpen?() → bool (the trip data's incidents too),
 * reportedFloor?(), tripDays?(), names?: {person(id), place(id),
 * placeWord(id)}}.
 */
export function createFitzroyCatalog({ twin }) {
  const catalog = composeCatalog({
    tools: FITZROY_COMMANDS.map((c) => c.tool),
    services: { twin },
    interceptors: [fitzroyGuard(twin)],
  });
  async function propose(name, args = {}) {
    const rev = twin.state()?.rev ?? null;
    let r;
    try {
      r = await catalog.call(name, args);
    } catch {
      // A slot the model got wrong is said, never silence (F11 P1-2).
      const say =
        name === 'pin_screen' && args?.screen === 'all'
          ? 'Pin one screen at a time.'
          : "I didn't catch that. Nothing changed.";
      return {
        name,
        args,
        rev,
        tier: 'refused',
        message: null,
        readBack: null,
        question: null,
        refusal: { code: 'invalid', say },
        effect: 'none',
        say,
      };
    }
    const d = r.data;
    return {
      name,
      args,
      rev,
      tier: d.tier,
      message: d.message,
      readBack: d.readBack ?? null,
      question: d.question ?? null,
      refusal: d.refusal ?? null,
      effect: d.effect,
      say: d.refusal
        ? d.refusal.say
        : d.effect === 'device'
          ? policyOf(name).reply
          : d.tier === 'ask'
            ? d.question
            : d.readBack,
    };
  }
  return Object.freeze({
    list: catalog.list,
    /** A proposal for one heard command; never sends anything. */
    propose,
    /**
     * At "yes": the same proposal against the wall now. A moved wall (rev)
     * is never applied blind (F16 P1-6).
     */
    async recheck(proposal) {
      if ((twin.state()?.rev ?? null) !== proposal.rev)
        return {
          ...proposal,
          stale: true,
          message: null,
          say: 'The wall changed. Ask again.',
        };
      return propose(proposal.name, proposal.args);
    },
  });
}
