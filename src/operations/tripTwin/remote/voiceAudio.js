// Fitzroy V1: push-to-talk audio for the voice service (remoteVoice.js).
// Pure (no DOM), so it is tested in Node.
export const SR = 16000;

/** Float32 chunks at `rate` → 16 kHz mono 16-bit WAV bytes. */
export function encodeWav(chunks, rate) {
  const n = chunks.reduce((a, c) => a + c.length, 0);
  const all = new Float32Array(n);
  let o = 0;
  for (const c of chunks) {
    all.set(c, o);
    o += c.length;
  }
  const ratio = rate / SR;
  const out = new Int16Array(Math.floor(n / ratio));
  for (let i = 0; i < out.length; i++) {
    // Average the input samples that fall in this output sample (a box
    // filter: enough for speech going to 16 kHz).
    const a = Math.floor(i * ratio);
    const b = Math.max(a + 1, Math.floor((i + 1) * ratio));
    let s = 0;
    for (let j = a; j < b && j < n; j++) s += all[j];
    const v = Math.max(-1, Math.min(1, s / (b - a)));
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  const buf = new ArrayBuffer(44 + out.length * 2);
  const dv = new DataView(buf);
  const str = (p, s) =>
    [...s].forEach((ch, i) => dv.setUint8(p + i, ch.charCodeAt(0)));
  str(0, 'RIFF');
  dv.setUint32(4, 36 + out.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true);
  dv.setUint32(24, SR, true);
  dv.setUint32(28, SR * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  str(36, 'data');
  dv.setUint32(40, out.length * 2, true);
  new Int16Array(buf, 44).set(out);
  return new Uint8Array(buf);
}

export const toB64 = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
export const fromB64 = (b64) =>
  Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
