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
// The transcript is shown in this page's voice strip and goes nowhere else:
// not on the relay socket, not in the session, not in a log.
import './remoteVoice.css';
import { createFitzroyCatalog } from '../fitzroy/fitzroyCatalog.js';
import {
  SAY,
  controlSay,
  planTurn,
  remoteTwin,
  sayAfter,
  voiceContext,
  voiceMessage,
} from '../fitzroy/fitzroyVoice.js';
import { encodeWav, fromB64, toB64 } from './voiceAudio.js';

const API = '/api/twin-voice';
const MAX_MS = 12000;
const MIN_MS = 250;
const PRE_ROLL_MS = 300;
const UNDO_MS = 10000;

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
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
 * → this remote's open question or null, cancelConfirm()}.
 */
export function mountVoice(api) {
  const v = {
    health: null, // {ok, model, asr}
    phase: 'idle', // idle | listening | thinking | acting | done | failed
    muted: false,
    heard: '',
    said: '',
    level: 0,
    lastTarget: null,
    lastTrip: null,
    last: null, // {undoIds, before, at}: this remote's last voice change
    busy: false,
  };

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
  const heard = el('span', 'rm-voice-heard');
  heard.dataset.ttVoiceHeard = '';
  const said = el('span', 'rm-voice-said');
  said.dataset.ttVoiceSaid = '';
  said.setAttribute('aria-live', 'polite');
  const mute = el('button', 'rm-btn rm-voice-mute', 'Mute');
  mute.type = 'button';
  const lines = el('div', 'rm-voice-lines');
  lines.append(heard, said);
  const head = el('div', 'rm-voice-head');
  head.append(el('span', 'rm-voice-name', 'FITZROY'), status, meter);
  strip.append(head, lines, el('div', 'rm-voice-keys'));
  strip.lastChild.append(talk, mute);
  api.mount(strip);

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
    strip.classList.toggle('down', down);
    strip.classList.toggle('muted', v.muted);
    heard.textContent = v.heard ? `Heard: “${v.heard}”` : '';
    said.textContent = v.said ? `Fitzroy: ${v.said}` : '';
    talk.disabled = down || v.muted || v.busy;
    talk.textContent =
      v.phase === 'listening' ? 'Release to send' : 'Hold to talk';
    mute.textContent = v.muted ? 'Unmute' : 'Mute';
    meterBar.style.transform = `scaleX(${Math.min(1, v.level * 6).toFixed(3)})`;
  }

  async function checkHealth() {
    try {
      const r = await fetch(`${API}/health`);
      v.health = r.ok ? await r.json() : { ok: false };
    } catch {
      v.health = { ok: false };
    }
    render();
  }
  checkHealth();
  setInterval(checkHealth, 10000);

  // ---- audio out ----
  let actx = null;
  let playing = null;
  const audioCtx = () => (actx ||= new AudioContext());
  function stopSpeaking() {
    try {
      playing?.stop();
    } catch {
      /* already stopped */
    }
    playing = null;
  }
  async function play(b64) {
    if (!b64) return;
    stopSpeaking();
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
    };
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
  let mic = null; // {stream, node, src}
  let rec = null; // {chunks, at}
  let ring = [];
  async function openMic() {
    if (mic) return mic;
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
      } else {
        // A short pre-roll keeps the first syllable (V0 capture notes).
        ring.push(x);
        if (ring.length > preRoll) ring.shift();
      }
    };
    src.connect(node);
    node.connect(ctx.destination);
    mic = { stream, node, src, rate: ctx.sampleRate };
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
    if (performance.now() - r.at < MIN_MS) {
      v.phase = 'idle';
      return render();
    }
    v.busy = true;
    v.phase = 'thinking';
    render();
    const t0 = performance.now();
    try {
      await turn(encodeWav(r.chunks, mic.rate), t0);
    } catch {
      v.phase = 'failed';
      v.said = 'Voice down · nothing changed · touch still works';
      render();
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

  async function turn(wav, t0) {
    const state = api.state();
    if (!state?.session?.tripId) throw new Error('no trip');
    if (v.lastTrip !== state.session.tripId) v.lastTarget = null;
    v.lastTrip = state.session.tripId;
    const pending = api.confirm();
    const ctx = voiceContext(state, {
      pending: pending ? pending.text || 'pending' : null,
      lastTarget: v.lastTarget,
      reportOpen: api.incidentOpen(),
      source: 'remote',
    });
    const out = await post('/turn', {
      audio: toB64(wav),
      context: ctx,
      speak: false,
    });
    v.heard = out.transcript || '';
    v.lastTarget = out.last_target ?? v.lastTarget;
    v.phase = 'acting';
    render(); // the heard line shows before anything is sent
    if (!out.transcript) {
      v.phase = 'idle';
      v.said = 'Nothing heard';
      return render();
    }
    const catalog = createFitzroyCatalog({ twin: twin() });
    const plan = await planTurn(catalog, out);
    const said = await carry(plan, catalog);
    v.phase = 'done';
    v.ms = Math.round(performance.now() - t0);
    render();
    await speak(said);
    setTimeout(() => {
      if (v.phase === 'done') {
        v.phase = 'idle';
        render();
      }
    }, 4000);
  }

  /** Carry out a plan; → the words to say. */
  async function carry(plan, catalog) {
    const open = Boolean(api.confirm());
    switch (plan.kind) {
      case 'control':
        if (plan.control === 'stop') {
          stopSpeaking();
          if (open) api.cancelConfirm();
          return '';
        }
        if (plan.control === 'no' && open) api.cancelConfirm();
        if (plan.control === 'mute') v.muted = true;
        return controlSay(plan.control, { pending: open });
      case 'touch': {
        // Tier C: nothing to apply. The relay still hears the intent (and
        // nothing else) so the refusal is in its log (voice.refused,
        // touch_only); its words are the catalog's, the same as these.
        const r = await api.request({
          t: 'cmd',
          cmd: null,
          voice: { intent: plan.intent },
        });
        return r?.error || plan.say;
      }
      case 'undo': {
        const b = api.lastUndo();
        if (!b) return 'Nothing to undo.';
        const last = lastOf(b);
        const voice = voiceMessage(plan.proposals[0]).voice;
        let r;
        for (const id of [...last.undoIds].reverse())
          r = await api.undo(id, voice);
        v.last = null;
        return sayAfter(plan, plan.proposals[0], r);
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
          if (!m) return p.say || SAY.notApplied;
          r = await api.send(m.cmd, 'Voice', {
            voice: m.voice,
            text: plan.kind === 'ask' ? p.question : null,
          });
          if (r?.ok && r.undoId) undoIds.push(r.undoId);
          if (!r?.ok) break;
        }
        if (undoIds.length) v.last = { undoIds, before, at: Date.now() };
        if (plan.proposals.length > 1 && r?.ok) return plan.say;
        return sayAfter(plan, p, r);
      }
      default:
        return plan.say || '';
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
  mute.addEventListener('click', () => {
    v.muted = !v.muted;
    if (v.muted) stopSpeaking();
    render();
  });
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
      if (e.code === 'KeyM' && !e.repeat) {
        v.muted = !v.muted;
        if (v.muted) stopSpeaking();
        return render();
      }
      // Esc: the remote cancels an open question itself; otherwise it undoes
      // this remote's last voice change while its undo lasts (§3.4).
      if (e.key === 'Escape' && !api.confirm() && v.last && !v.busy) {
        if (Date.now() - v.last.at >= UNDO_MS) return;
        const last = v.last;
        v.last = null;
        (async () => {
          let r;
          for (const id of [...last.undoIds].reverse())
            r = await api.undo(id, null);
          v.said = r?.ok
            ? r.restored?.length
              ? SAY.undone
              : SAY.nothingUndone
            : r?.error || '';
          render();
        })();
      }
    },
    { capture: true },
  );
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space' && !typing(e.target)) {
      e.preventDefault();
      release();
    }
  });
  window.addEventListener('blur', () => release());
  render();
  return { state: v };
}
