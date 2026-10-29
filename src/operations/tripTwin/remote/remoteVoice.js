// Fitzroy V1 on the remote (plans/trip-twin/VOICE-CONTROL.md §2, §3.4, §5
// "This Mac"; plans/trip-twin/FITZROY-V1-HOWTO.md). Loaded only with
// `?voice=1`, so the remote is unchanged for anyone else.
//
// Hold the button (or Space while this page is focused) and speak; release
// sends the audio to the local voice service through the dev server's
// same-origin route /api/twin-voice (vite.twin.config.js, this computer
// only). The service answers with the transcript and a decision; this page
// turns it into a catalog proposal and submits it on its OWN relay socket,
// under its own identity and lease (voice proposes, the device submits).
// Tier A applies with Undo in the bar; Tier B gets the server's question in
// the same Confirm bar (K10); Tier C and the guard's refusals are said and
// sent nowhere but the relay's refusal log (intent only).
//
// 29 Oct 2026 (Jesse: "1-3"):
// - Hands-free: with Listening on, the microphone stays open and
//   fitzroyListen.js cuts it into voiced segments; each goes to /listen,
//   which acts only when it starts with "Fitzroy" (anything else is dropped
//   by the service and never kept). The turn then runs exactly as a push-
//   to-talk turn, from this page, under its lease. No listening while a
//   reply plays (and 300 ms after), while muted, or while Visitor mode is on.
//   The walls show FITZROY LISTENING from a boolean this page sets on the
//   relay ({t:'voice', listening}); no words ever go with it.
// - Fewer questions: a command that names no screen goes to the TARGET this
//   remote tapped or the last screen it spoke to ("Talking about: S2").
// - Learn from real use: the service keeps a local usage log (voice-lab,
//   never Trip Twin's log). This page reports what happened to each turn by
//   its id (applied, asked, confirmed, cancelled, undone, refused) and
//   "That was wrong" flags the last turn; neither carries a word.
//
// The transcript is shown in this page's voice strip and goes nowhere else
// in Trip Twin: not on the relay socket, not in the session, not in a log.
import './remoteVoice.css';
import { createFitzroyCatalog } from '../fitzroy/fitzroyCatalog.js';
import {
  SAY,
  controlSay,
  logText,
  planTurn,
  remoteTwin,
  sayAfter,
  talkingAbout,
  talkingText,
  voiceContext,
  voiceMessage,
} from '../fitzroy/fitzroyVoice.js';
import {
  FOLLOW_MS,
  MUTE_TAIL_MS,
  WRONG_MS,
  createSegmenter,
} from '../fitzroy/fitzroyListen.js';
import { CODE } from '../twinProtocol.js';
import { encodeWav, fromB64, toB64 } from './voiceAudio.js';

const API = '/api/twin-voice';
const MAX_MS = 12000;
const MIN_MS = 250;
const PRE_ROLL_MS = 300;
const UNDO_MS = 10000;
/** "That was wrong" flags the last turn while it is this recent. */
const FLAG_MS = 2 * 60 * 1000;
const LISTEN_KEY = 'tripTwin.remote.voiceListen';

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const store = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* private window: the switch still works for this page */
    }
  },
};

async function post(path, body) {
  const r = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({ ok: false }));
  if (!r.ok || j.ok === false) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

/**
 * api (from remote.js): {mount(node), state(), controller(), incidentOpen(),
 * tripDays(), snapshot(), send(cmd, label, {voice, text}) → ack,
 * undo(undoId, voice) → ack, lastUndo() → {undoId, before} of this
 * remote's last change while its Undo lasts, request(msg) → ack, confirm()
 * → this remote's open question or null, cancelConfirm(), target() →
 * {target, at} (at: when the user tapped it, else null), setListening(on)
 * (the relay's boolean for the walls), hooks (an object this module fills:
 * applied(cmd, r), undone(undoId, r), confirmed(confirmId, r),
 * restale(oldId, newId), cancelled(confirmId), expired(confirmId))}.
 */
export function mountVoice(api) {
  const v = {
    health: null, // {ok, model, asr, log: {on, keep_days}, listen: {default}}
    phase: 'idle', // idle | listening | thinking | acting | done | failed
    muted: false,
    heard: '',
    said: '',
    level: 0,
    lastTarget: null,
    memTrip: undefined, // the trip and site the memory belongs to
    memSite: undefined,
    last: null, // {undoIds, before, at, turnId}: this remote's last voice change
    lastTurn: null, // {id, at}: the last turn the service logged
    flagged: null, // {id, at}: shown with Undo beside it
    busy: false,
    listenWant: null, // the switch (null: not decided yet)
    listening: false, // the microphone is really open for "Fitzroy…"
    listenWhy: '', // why the switch is on but nothing listens
    followUntil: 0,
  };
  const turnOfUndo = new Map(); // undoId → turnId
  const turnOfConfirm = new Map(); // confirmId → turnId

  // ---- the strip ----
  const strip = el('section', 'rm-voice');
  strip.dataset.ttVoice = '';
  strip.setAttribute('aria-label', 'Fitzroy voice');
  const talk = el('button', 'rm-btn rm-voice-talk', 'Hold to talk');
  talk.type = 'button';
  talk.dataset.ttVoiceTalk = '';
  const meter = el('span', 'rm-voice-meter');
  const meterBar = el('i');
  meter.append(meterBar);
  const status = el('span', 'rm-voice-status');
  const talking = el('span', 'rm-voice-about');
  talking.dataset.ttVoiceTalking = '';
  const logNote = el('span', 'rm-voice-log');
  logNote.dataset.ttVoiceLog = '';
  const heard = el('span', 'rm-voice-heard');
  heard.dataset.ttVoiceHeard = '';
  const said = el('span', 'rm-voice-said');
  said.dataset.ttVoiceSaid = '';
  said.setAttribute('aria-live', 'polite');
  const mute = el('button', 'rm-btn rm-voice-mute', 'Mute');
  mute.type = 'button';
  const listen = el('button', 'rm-btn rm-voice-listen', 'Listening: off');
  listen.type = 'button';
  listen.setAttribute('role', 'switch');
  listen.dataset.ttVoiceListen = '';
  const wrong = el('button', 'rm-btn rm-voice-wrong', 'That was wrong');
  wrong.type = 'button';
  wrong.dataset.ttVoiceWrong = '';
  wrong.title = 'Flag the last turn for review · nothing changes on the walls';
  const flagUndo = el('button', 'rm-btn rm-voice-undo', 'Undo it');
  flagUndo.type = 'button';
  flagUndo.dataset.ttVoiceFlagUndo = '';
  flagUndo.hidden = true;
  const lines = el('div', 'rm-voice-lines');
  lines.append(heard, said);
  const head = el('div', 'rm-voice-head');
  head.append(
    el('span', 'rm-voice-name', 'FITZROY'),
    status,
    talking,
    logNote,
    meter,
  );
  const keys = el('div', 'rm-voice-keys');
  keys.append(talk, listen, wrong, flagUndo, mute);
  strip.append(head, lines, keys);
  api.mount(strip);

  const flagUndoable = () => {
    const b = api.lastUndo();
    return Boolean(v.flagged && b && turnOfUndo.get(b.undoId) === v.flagged.id);
  };
  function about() {
    const t = api.target?.() || {};
    return talkingAbout({
      target: t.target,
      targetAt: t.at,
      lastTarget: v.lastTarget,
      nowMs: Date.now(),
      screens: api.state()?.screens,
    });
  }

  function render() {
    const down = !v.health?.ok;
    const word = {
      idle: down
        ? 'Voice down · touch still works'
        : v.muted
          ? 'Voice muted'
          : `Voice ready · ${v.health?.model || 'rules only'}`,
      listening: 'Listening…',
      thinking: 'Thinking…',
      acting: 'Acting…',
      done: 'Done',
      failed: 'Failed',
    }[v.phase];
    status.textContent = word;
    strip.dataset.phase = v.phase;
    strip.dataset.listening = v.listening ? 'on' : 'off';
    strip.classList.toggle('down', down);
    strip.classList.toggle('muted', v.muted);
    talking.textContent = talkingText(about());
    logNote.textContent = logText(v.health?.log);
    heard.textContent = v.heard ? `Heard: “${v.heard}”` : '';
    said.textContent = v.said ? `Fitzroy: ${v.said}` : '';
    talk.disabled = down || v.muted || v.busy;
    talk.textContent =
      v.phase === 'listening' && !v.listening
        ? 'Release to send'
        : 'Hold to talk';
    mute.textContent = v.muted ? 'Unmute' : 'Mute';
    listen.textContent = v.listenWant
      ? v.listening
        ? 'Listening: on · say “Fitzroy…”'
        : `Listening: paused${v.listenWhy ? ` · ${v.listenWhy}` : ''}`
      : 'Listening: off';
    listen.setAttribute('aria-checked', v.listenWant ? 'true' : 'false');
    listen.classList.toggle('on', Boolean(v.listenWant));
    listen.disabled = down;
    wrong.disabled = !(v.lastTurn && Date.now() - v.lastTurn.at < FLAG_MS);
    flagUndo.hidden = !flagUndoable();
    meterBar.style.transform = `scaleX(${Math.min(1, v.level * 6).toFixed(3)})`;
  }

  async function checkHealth() {
    try {
      const r = await fetch(`${API}/health`);
      v.health = r.ok ? await r.json() : { ok: false };
    } catch {
      v.health = { ok: false };
    }
    if (v.listenWant == null && v.health?.ok) {
      const saved = store.get(LISTEN_KEY);
      v.listenWant = saved ? saved === 'on' : Boolean(v.health.listen?.default);
    }
    syncListening();
    render();
  }
  checkHealth();
  setInterval(checkHealth, 10000);

  // ---- outcomes for the usage log (ids and events only, never words) ----
  function outcome(id, event, extra = {}) {
    if (!id) return;
    post('/outcome', { id, event, ...extra }).catch(() => {
      /* the log is best effort; the wall is what counts */
    });
  }
  api.hooks.applied = (cmd) => {
    // Return all by touch or voice: the last screen spoken to is forgotten.
    if (cmd?.type === 'returnLive') v.lastTarget = null;
  };
  api.hooks.undone = (undoId, r) => {
    const id = turnOfUndo.get(undoId);
    if (id && r?.ok && r.restored?.length) outcome(id, 'undone');
    render();
  };
  api.hooks.confirmed = (confirmId, r) => {
    const id = turnOfConfirm.get(confirmId);
    if (!id) return;
    turnOfConfirm.delete(confirmId);
    if (r?.ok) {
      outcome(id, 'confirmed');
      if (r.undoId) turnOfUndo.set(r.undoId, id);
    }
  };
  api.hooks.restale = (oldId, newId) => {
    const id = turnOfConfirm.get(oldId);
    if (id) turnOfConfirm.set(newId, id);
  };
  api.hooks.cancelled = (confirmId) => {
    const id = turnOfConfirm.get(confirmId);
    if (id) outcome(id, 'cancelled');
    turnOfConfirm.delete(confirmId);
  };
  api.hooks.expired = (confirmId) => {
    const id = turnOfConfirm.get(confirmId);
    if (id) outcome(id, 'expired');
    turnOfConfirm.delete(confirmId);
  };

  // ---- audio out ----
  let actx = null;
  let playing = null;
  const audioCtx = () => (actx ||= new AudioContext());
  let seg = createSegmenter({ rate: 48000 });
  const muteTail = () => seg.mute(performance.now() + MUTE_TAIL_MS);
  function stopSpeaking() {
    const was = playing;
    try {
      playing?.stop();
    } catch {
      /* already stopped */
    }
    playing = null;
    if (was) muteTail();
  }
  async function play(b64) {
    if (!b64) return;
    stopSpeaking();
    // Fitzroy never hears itself: no listening from now until 300 ms after
    // the reply ends.
    seg.mute(Infinity);
    try {
      const ctx = audioCtx();
      const bytes = fromB64(b64);
      const buf = await ctx.decodeAudioData(bytes.buffer.slice(0));
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start();
      playing = src;
      src.onended = () => {
        if (playing === src) playing = null;
        if (!playing) muteTail();
      };
    } catch {
      muteTail();
    }
  }
  /** Show and speak one template sentence (the walls never hear it). */
  async function speak(text) {
    v.said = text || '';
    render();
    if (!text) return;
    try {
      const r = await post('/speak', { text });
      await play(r.audio);
    } catch {
      /* the words are on screen; speech is best effort */
    }
  }

  // ---- audio in ----
  let mic = null; // {stream, node, src, rate}
  let micOpening = null;
  let rec = null; // {chunks, at}
  let ring = [];
  function openMic() {
    if (mic) return Promise.resolve(mic);
    micOpening ||= startMic().finally(() => {
      micOpening = null;
    });
    return micOpening;
  }
  async function startMic() {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    const ctx = audioCtx();
    const src = ctx.createMediaStreamSource(stream);
    const node = ctx.createScriptProcessor(2048, 1, 1);
    const preRoll = Math.ceil(((PRE_ROLL_MS / 1000) * ctx.sampleRate) / 2048);
    node.onaudioprocess = (e) => {
      const x = new Float32Array(e.inputBuffer.getChannelData(0));
      let s = 0;
      for (let i = 0; i < x.length; i += 4) s += x[i] * x[i];
      v.level = Math.sqrt(s / (x.length / 4));
      if (rec) {
        rec.chunks.push(x);
        meterBar.style.transform = `scaleX(${Math.min(1, v.level * 6).toFixed(3)})`;
        return;
      }
      // A short pre-roll keeps the first syllable (V0 capture notes).
      ring.push(x);
      if (ring.length > preRoll) ring.shift();
      if (v.listening) {
        const done = seg.push(x, performance.now());
        if (done) heardSegment(done);
      }
    };
    src.connect(node);
    node.connect(ctx.destination);
    mic = { stream, node, src, rate: ctx.sampleRate };
    seg = createSegmenter({ rate: ctx.sampleRate });
    return mic;
  }

  async function press() {
    if (rec || v.busy || v.muted || !v.health?.ok) return;
    stopSpeaking(); // barge-in
    try {
      await openMic();
      if (actx.state === 'suspended') await actx.resume();
    } catch {
      v.phase = 'failed';
      v.said = 'No microphone · allow it for this page, or use touch';
      return render();
    }
    rec = { chunks: [...ring], at: performance.now() };
    ring = [];
    v.phase = 'listening';
    v.heard = '';
    v.said = '';
    render();
    rec.timer = setTimeout(release, MAX_MS);
  }

  async function release() {
    if (!rec) return;
    const r = rec;
    rec = null;
    clearTimeout(r.timer);
    v.level = 0;
    seg.reset();
    if (performance.now() - r.at < MIN_MS) {
      v.phase = 'idle';
      return render();
    }
    v.busy = true;
    v.phase = 'thinking';
    render();
    const t0 = performance.now();
    try {
      await turn('/turn', encodeWav(r.chunks, mic.rate), t0);
    } catch {
      v.phase = 'failed';
      v.said = 'Voice down · nothing changed · touch still works';
      render();
    } finally {
      v.busy = false;
      render();
    }
  }

  // ---- hands-free listening ----
  /** Listening for "Fitzroy…" (and the relay's boolean for the walls). */
  async function syncListening() {
    const visitor = Boolean(api.state()?.session?.visitor);
    const down = !v.health?.ok;
    v.listenWhy = down
      ? 'voice down'
      : v.muted
        ? 'muted'
        : visitor
          ? 'Visitor mode is on'
          : '';
    let on = Boolean(v.listenWant) && !v.listenWhy;
    if (on) {
      try {
        await openMic();
        if (actx.state === 'suspended') await actx.resume();
        if (actx.state !== 'running') {
          v.listenWhy = 'click the page to start';
          on = false;
        }
      } catch {
        v.listenWhy = 'no microphone';
        on = false;
      }
    }
    if (on !== v.listening) {
      v.listening = on;
      seg.reset();
      api.setListening(on);
      render();
    }
  }
  /** A voiced segment from the open microphone: Fitzroy's only if named. */
  async function heardSegment(chunks) {
    if (v.busy || rec || !v.listening) return;
    v.busy = true;
    const t0 = performance.now();
    try {
      await turn('/listen', encodeWav(chunks, mic.rate), t0);
    } catch {
      v.phase = 'failed';
      v.said = 'Voice down · nothing changed · touch still works';
    } finally {
      v.busy = false;
      render();
    }
  }

  // ---- one turn ----
  /**
   * This remote's last change (the bar's Undo): a two-change voice turn
   * undoes both, from the wall before the first.
   */
  function lastOf(b) {
    return v.last && v.last.undoIds.at(-1) === b.undoId
      ? v.last
      : { undoIds: [b.undoId], before: b.before };
  }
  function twin() {
    return remoteTwin({
      state: api.state,
      now: () => Date.now(),
      lastUndo: () => {
        const b = api.lastUndo();
        return b ? { undoId: b.undoId, before: lastOf(b).before } : null;
      },
      incidentOpen: api.incidentOpen,
      tripDays: api.tripDays,
      snapshot: api.snapshot,
    });
  }
  /** A trip or site switch (touch or voice) forgets the last screen. */
  function memoryForState(state) {
    const s = state?.session || {};
    if (v.memTrip !== s.tripId || v.memSite !== s.siteKey) {
      if (v.memTrip !== undefined) v.lastTarget = null;
      v.memTrip = s.tripId;
      v.memSite = s.siteKey;
    }
  }

  async function turn(path, wav, t0) {
    const state = api.state();
    if (!state?.session?.tripId) throw new Error('no trip');
    memoryForState(state);
    const pending = api.confirm();
    const now = Date.now();
    const ctx = voiceContext(state, {
      pending: pending ? pending.text || 'pending' : null,
      lastTarget: v.lastTarget,
      defaultTarget: about(),
      reportOpen: api.incidentOpen(),
      source: 'remote',
    });
    const body = {
      audio: toB64(wav),
      context: ctx,
      speak: false,
      ...(v.lastTurn ? { last_turn: v.lastTurn.id } : {}),
    };
    if (path === '/listen') {
      body.follow = now < v.followUntil;
      body.wrong_ok = Boolean(v.lastTurn && now - v.lastTurn.at < WRONG_MS);
    }
    const out = await post(path, body);
    if (path === '/listen') {
      // Not for Fitzroy: nothing shown, nothing kept.
      if (!out.addressed) return;
      v.followUntil = 0;
      if (out.name_only) {
        v.followUntil = Date.now() + FOLLOW_MS;
        v.heard = out.transcript || '';
        v.said = 'Listening for the command…';
        v.phase = 'listening';
        render();
        setTimeout(() => {
          if (v.phase === 'listening' && !rec) {
            v.phase = 'idle';
            v.said = '';
            render();
          }
        }, FOLLOW_MS);
        return;
      }
    }
    if (out.control === 'wrong') return flaggedNow(out.flagged, 'voice', out);
    v.heard = out.transcript || '';
    if ('last_target' in out) v.lastTarget = out.last_target;
    if (out.turn_id) v.lastTurn = { id: out.turn_id, at: Date.now() };
    v.flagged = null;
    v.phase = 'acting';
    render(); // the heard line shows before anything is sent
    if (!out.transcript) {
      v.phase = 'idle';
      v.said = 'Nothing heard';
      return render();
    }
    const catalog = createFitzroyCatalog({ twin: twin() });
    const plan = await planTurn(catalog, out);
    const needsControl = ['act', 'ask', 'undo'].includes(plan.kind);
    let res;
    if (needsControl && !api.controller())
      res = { said: SAY.takeControl, event: 'not_controller' };
    else res = await carry(plan, catalog, out.turn_id);
    outcome(out.turn_id, res.event, {
      said: res.said || '',
      ...(res.reason ? { reason: res.reason } : {}),
    });
    v.phase = 'done';
    v.ms = Math.round(performance.now() - t0);
    render();
    await speak(res.said);
    setTimeout(() => {
      if (v.phase === 'done') {
        v.phase = 'idle';
        render();
      }
    }, 4000);
  }

  /** "That was wrong" (the button, or the spoken word): flags, never acts. */
  async function flaggedNow(ok, how, out = null) {
    if (how === 'button') {
      if (!v.lastTurn) return;
      try {
        const r = await post('/flag', { id: v.lastTurn.id, how });
        ok = Boolean(r.flagged);
      } catch {
        ok = false;
      }
    }
    if (out?.transcript) v.heard = out.transcript;
    v.flagged = ok && v.lastTurn ? { id: v.lastTurn.id, at: Date.now() } : null;
    v.phase = 'done';
    render();
    const words = ok
      ? flagUndoable()
        ? 'Flagged. Nothing changed. Undo it if you want it back.'
        : SAY.flagged
      : how === 'button'
        ? 'Not flagged · the usage log is off or not reachable'
        : SAY.nothingToFlag;
    await speak(how === 'button' && !ok ? '' : words);
    if (how === 'button' && !ok) {
      v.said = words;
      render();
    }
  }

  /** Undo this remote's last voice change (Esc, or "Undo it" by a flag). */
  async function undoLast() {
    if (!v.last || v.busy || Date.now() - v.last.at >= UNDO_MS) return;
    const last = v.last;
    v.last = null;
    let r;
    for (const id of [...last.undoIds].reverse()) r = await api.undo(id, null);
    v.said = r?.ok
      ? r.restored?.length
        ? SAY.undone
        : SAY.nothingUndone
      : r?.error || '';
    render();
  }

  /** Carry out a plan; → {said, event, reason?} (event: the usage log's). */
  async function carry(plan, catalog, turnId) {
    const open = Boolean(api.confirm());
    switch (plan.kind) {
      case 'control':
        if (plan.control === 'stop') {
          stopSpeaking();
          if (open) api.cancelConfirm();
          return { said: '', event: 'nothing' };
        }
        if (plan.control === 'no' && open) api.cancelConfirm();
        if (plan.control === 'mute') {
          v.muted = true;
          syncListening();
        }
        return {
          said: controlSay(plan.control, { pending: open }),
          event: 'nothing',
        };
      case 'touch': {
        // Tier C: nothing to apply. The relay still hears the intent (and
        // nothing else) so the refusal is in its log (voice.refused,
        // touch_only); its words are the catalog's, the same as these.
        if (!api.controller())
          return { said: plan.say, event: 'refused', reason: 'touch_only' };
        const r = await api.request({
          t: 'cmd',
          cmd: null,
          voice: { intent: plan.intent },
        });
        return {
          said: r?.error || plan.say,
          event: 'refused',
          reason: 'touch_only',
        };
      }
      case 'undo': {
        const b = api.lastUndo();
        if (!b) return { said: 'Nothing to undo.', event: 'nothing' };
        const last = lastOf(b);
        const voice = voiceMessage(plan.proposals[0]).voice;
        let r;
        for (const id of [...last.undoIds].reverse())
          r = await api.undo(id, voice);
        v.last = null;
        return {
          said: sayAfter(plan, plan.proposals[0], r),
          event: r?.ok ? 'applied' : 'refused',
          ...(r?.ok ? {} : { reason: r?.code || 'not applied' }),
        };
      }
      case 'act':
      case 'ask': {
        const before = api.state();
        const undoIds = [];
        let r;
        let p;
        for (p of plan.proposals) {
          // A later proposal is checked against the wall as it is now.
          if (p !== plan.proposals[0])
            p = await catalog.propose(p.name, p.args);
          const m = voiceMessage(p);
          if (!m)
            return {
              said: p.say || SAY.notApplied,
              event: 'refused',
              reason: 'guard',
            };
          r = await api.send(m.cmd, 'Voice', {
            voice: m.voice,
            text: plan.kind === 'ask' ? p.question : null,
          });
          if (r?.ok && r.undoId) {
            undoIds.push(r.undoId);
            turnOfUndo.set(r.undoId, turnId);
          }
          if (r?.code === CODE.CONFIRM_REQUIRED && r.confirmId)
            turnOfConfirm.set(r.confirmId, turnId);
          if (!r?.ok) break;
        }
        if (undoIds.length)
          v.last = { undoIds, before, at: Date.now(), turnId };
        const event = r?.ok
          ? 'applied'
          : r?.code === CODE.CONFIRM_REQUIRED
            ? 'asked'
            : 'refused';
        const reason = event === 'refused' ? r?.code || 'not applied' : null;
        if (plan.proposals.length > 1 && r?.ok)
          return { said: plan.say, event };
        return { said: sayAfter(plan, p, r), event, reason };
      }
      case 'question':
        return { said: plan.say || '', event: 'question' };
      default:
        return { said: plan.say || '', event: 'nothing' };
    }
  }

  // ---- input ----
  talk.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try {
      // Keep the release even when the finger slides off the button.
      talk.setPointerCapture(e.pointerId);
    } catch {
      /* no capture for this pointer: pointerup still ends the turn */
    }
    press();
  });
  for (const ev of ['pointerup', 'pointercancel'])
    talk.addEventListener(ev, () => release());
  const toggleMute = () => {
    v.muted = !v.muted;
    if (v.muted) stopSpeaking();
    syncListening();
    render();
  };
  mute.addEventListener('click', toggleMute);
  listen.addEventListener('click', () => {
    v.listenWant = !v.listenWant;
    store.set(LISTEN_KEY, v.listenWant ? 'on' : 'off');
    syncListening();
    render();
  });
  wrong.addEventListener('click', () => flaggedNow(false, 'button'));
  flagUndo.addEventListener('click', () => {
    v.flagged = null;
    undoLast();
  });
  // A page opened with Listening saved on may need one click before the
  // browser lets audio run.
  window.addEventListener(
    'pointerdown',
    () => {
      if (v.listenWant && !v.listening) syncListening();
    },
    { capture: true },
  );
  const typing = (t) =>
    t?.closest?.('input, textarea, select, [contenteditable="true"]');
  // Capture phase: this runs before the remote's own Esc (which cancels an
  // open question), so an Esc that cancels never also undoes.
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      if (e.code === 'Space') {
        e.preventDefault(); // Space is push-to-talk here, never a button press
        if (!e.repeat) press();
        return;
      }
      if (e.code === 'KeyM' && !e.repeat) return toggleMute();
      // Esc: the remote cancels an open question itself; otherwise it undoes
      // this remote's last voice change while its undo lasts (§3.4).
      if (e.key === 'Escape' && !api.confirm() && v.last && !v.busy) undoLast();
    },
    { capture: true },
  );
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space' && !typing(e.target)) {
      e.preventDefault();
      release();
    }
  });
  // Push-to-talk ends when the page loses focus; listening does not (the
  // remote may sit in a background tab while Fitzroy listens).
  window.addEventListener('blur', () => release());
  setInterval(() => {
    memoryForState(api.state());
    syncListening();
    render();
  }, 1000);
  render();
  return { state: v };
}
