// Fitzroy hands-free listening (Jesse, 29 Oct 2026; VOICE-CONTROL §7 V5
// notes; FITZROY-V1-HOWTO.md "Listening mode"). Pure: no DOM, no network.
//
// The remote page on the Mac keeps its microphone open while Listening is
// on, and this segmenter cuts the stream into voiced segments with a small
// energy detector (an adaptive noise floor; no model on the page). Only a
// voiced segment is sent to the local voice service, which runs Silero VAD
// and Parakeet on it and acts only when it starts with "Fitzroy"
// (voice-lab/src/v1/wake.py); anything else is dropped there and never
// kept. Silence is never sent.
//
// Fitzroy must not hear itself: `mute(until)` drops every frame until then
// (and any segment in progress). The page mutes while a reply plays and
// for MUTE_TAIL_MS after it ends.

export const LISTEN = Object.freeze({
  startRms: 0.012, // speech starts above this (or 3× the noise floor) …
  floorK: 3,
  startFrames: 2, // … for this many frames in a row
  endRms: 0.008, // and ends after END_MS below this (or 2× the floor)
  endMs: 700,
  preRollMs: 300, // kept from before the start, so the first syllable counts
  minMs: 350, // a shorter burst is a click or a cough: dropped
  maxMs: 8000, // a longer one is cut here and sent
});
/** No listening while a reply plays, and for this long after it ends. */
export const MUTE_TAIL_MS = 300;
/** "Fitzroy." alone: the next segment within this window is its command. */
export const FOLLOW_MS = 6000;
/** A bare "wrong" (no name) counts this long after a turn. */
export const WRONG_MS = 15000;

const rmsOf = (x) => {
  let s = 0;
  for (let i = 0; i < x.length; i += 1) s += x[i] * x[i];
  return x.length ? Math.sqrt(s / x.length) : 0;
};

/**
 * A segmenter for one stream. push(frame: Float32Array, nowMs) → null, or
 * the finished segment's frames (Float32Array[]) when one ends. mute(until)
 * drops frames until `until` (Infinity: until the next mute call) and
 * forgets a segment in progress. o: LISTEN overrides; rate: samples per s.
 */
export function createSegmenter({ rate = 48000, ...over } = {}) {
  const o = { ...LISTEN, ...over };
  let floor = 0.002;
  let speaking = false;
  let run = 0;
  let quietMs = 0;
  let segMs = 0;
  let pre = [];
  let preMs = 0;
  let chunks = [];
  let mutedUntil = 0;
  const reset = () => {
    speaking = false;
    run = 0;
    quietMs = 0;
    segMs = 0;
    pre = [];
    preMs = 0;
    chunks = [];
  };
  return {
    push(x, nowMs) {
      if (nowMs < mutedUntil) return null;
      const ms = (x.length / rate) * 1000;
      const r = rmsOf(x);
      if (!speaking) {
        pre.push({ x, ms });
        preMs += ms;
        while (pre.length > 1 && preMs - pre[0].ms >= o.preRollMs) {
          preMs -= pre.shift().ms;
        }
        if (r > Math.max(o.startRms, floor * o.floorK)) {
          run += 1;
          if (run >= o.startFrames) {
            speaking = true;
            chunks = pre.map((p) => p.x);
            segMs = preMs;
            quietMs = 0;
            pre = [];
            preMs = 0;
          }
        } else {
          run = 0;
          // The floor follows the room down fast and up slowly.
          floor = r < floor ? 0.8 * floor + 0.2 * r : 0.995 * floor + 0.005 * r;
          floor = Math.max(floor, 0.0005);
        }
        return null;
      }
      chunks.push(x);
      segMs += ms;
      quietMs = r < Math.max(o.endRms, floor * 2) ? quietMs + ms : 0;
      if (quietMs >= o.endMs || segMs >= o.maxMs) {
        const voiced = segMs - quietMs;
        const out = chunks;
        reset();
        return voiced >= o.minMs ? out : null;
      }
      return null;
    },
    mute(until) {
      mutedUntil = until;
      reset();
    },
    muted: (nowMs) => nowMs < mutedUntil,
    reset,
  };
}
