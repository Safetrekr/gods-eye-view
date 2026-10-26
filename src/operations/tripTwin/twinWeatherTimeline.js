// Weather timeline (phase 6): scrub or play from the last two hours of
// observed weather into the forecast. A native range input (keyboard and
// screen readers for free) over a track shaded by the kind of data.
import { relText } from './twinWeatherTime.js';

/** Offset from the real now, rounded to 5 min like the wall strip. */
function lensRel(t) {
  const m = Math.round((t - Date.now()) / 60e3);
  return Math.abs(m) >= 10
    ? `${m > 0 ? '+' : '−'}${Math.round(Math.abs(m) / 5) * 5} min`
    : relText(t, Date.now());
}

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

export const KIND_TEXT = {
  observed: 'observed map',
  model: 'model forecast map',
  projected: 'projection on the current track',
  site: 'site forecast',
  none: 'no frame yet',
};

/**
 * createWeatherTimeline({onChange(t|null), clock(ms) → "HH:MM"})
 * render({now, start, end, stepMs, t, segments: [{from, to, kind}], kindAt,
 *         sourceAt(t) → text, playing})
 */
export function createWeatherTimeline({ onChange, clock, tick = clock }) {
  const root = el('section', 'tt-wxtl tt-panel');
  root.setAttribute('aria-label', 'Weather timeline');
  root.hidden = true;
  const play = el('button', 'tt-btn sm tt-wxtl-play', 'Play');
  play.type = 'button';
  play.setAttribute('aria-pressed', 'false');
  const range = el('input', 'tt-wxtl-range');
  range.type = 'range';
  range.setAttribute('aria-label', 'Weather time');
  const ticks = el('div', 'tt-wxtl-ticks');
  const segs = el('div', 'tt-wxtl-segs');
  const nowMark = el('span', 'tt-wxtl-nowmark');
  const track = el('div', 'tt-wxtl-track');
  track.append(segs, nowMark, range, ticks);
  const now = el('button', 'tt-btn sm tt-wxtl-now', 'Back to now');
  now.type = 'button';
  const cap = el('div', 'tt-wxtl-cap');
  cap.setAttribute('role', 'status');
  const legend = el('div', 'tt-wxtl-legend');
  root.append(play, track, now, cap, legend);

  let model = null;
  let timer = null;
  const stop = () => {
    clearInterval(timer);
    timer = null;
    play.textContent = 'Play';
    play.setAttribute('aria-pressed', 'false');
    cap.setAttribute('aria-live', 'polite');
  };
  // Esc from the slider: back to now (the page ignores keys in inputs).
  range.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || model?.t == null) return;
    e.preventDefault();
    e.stopPropagation();
    stop();
    onChange(null);
  });
  range.addEventListener('input', () => {
    if (!model) return;
    stop();
    const t = Number(range.value);
    onChange(Math.abs(t - model.now) < model.stepMs / 2 ? null : t);
  });
  now.addEventListener('click', () => {
    stop();
    onChange(null);
  });
  play.addEventListener('click', () => {
    if (timer) return stop();
    if (!model) return;
    play.textContent = 'Pause';
    play.setAttribute('aria-pressed', 'true');
    // Do not re-announce every frame while playing.
    cap.setAttribute('aria-live', 'off');
    // Play forward from where the thumb is; from now when at the end.
    let t = model.t ?? model.now;
    if (t >= model.end) t = model.now;
    timer = setInterval(() => {
      t += model.stepMs;
      if (t > model.end) {
        stop();
        return;
      }
      onChange(t);
    }, 700);
  });

  return {
    el: root,
    stop,
    get playing() {
      return Boolean(timer);
    },
    render(m) {
      model = m?.disabled ? null : m;
      root.hidden = !m;
      if (!m) return stop();
      for (const c of [play, range, now]) c.disabled = Boolean(m.disabled);
      if (m.disabled) {
        stop();
        root.classList.remove('away');
        cap.textContent = m.disabled;
        legend.replaceChildren();
        ticks.replaceChildren();
        now.hidden = true;
        return;
      }
      range.min = String(m.start);
      range.max = String(m.end);
      range.step = String(m.stepMs);
      const t = m.t ?? m.now;
      range.value = String(t);
      range.setAttribute(
        'aria-valuetext',
        `${clock(t) ? `${clock(t)} ` : ''}${m.t == null ? 'now' : relText(t, m.now)} · ${KIND_TEXT[m.kindAt(t)]}`,
      );
      // Track segments by data kind: solid observed, striped model map,
      // outlined site forecast (review/phase6 L13). Bad values dropped.
      const span = m.end - m.start;
      const pct = (x) =>
        Math.min(100, Math.max(0, ((x - m.start) / span) * 100));
      const drawn = m.segments.filter(
        (s) =>
          Number.isFinite(s.from) && Number.isFinite(s.to) && s.to > s.from,
      );
      segs.replaceChildren(
        ...drawn.map((s) => {
          const d = el('span', `seg ${s.kind}`);
          d.style.left = `${pct(s.from)}%`;
          d.style.width = `${pct(s.to) - pct(s.from)}%`;
          return d;
        }),
      );
      nowMark.style.left = `${pct(m.now)}%`;
      // Ticks: NOW, and every 6 h never within 40 px of NOW.
      ticks.replaceChildren();
      const width = track.clientWidth || 600;
      const mark = (time, label, cls = '') => {
        const k = el('span', `tick ${cls}`, label);
        k.style.left = `${pct(time)}%`;
        ticks.append(k);
      };
      mark(m.now, 'NOW', 'now');
      const first = Math.ceil(m.start / (6 * 3600e3)) * 6 * 3600e3;
      for (let x = first; x <= m.end; x += 6 * 3600e3)
        if ((Math.abs(x - m.now) / span) * width > 40) mark(x, tick(x));
      const kind = m.kindAt(t);
      root.classList.toggle('away', m.t != null);
      root.dataset.kind = kind;
      now.hidden = m.t == null;
      // Only the "not live" lead is amber; the detail stays readable grey.
      if (m.t == null) cap.replaceChildren(`Now · ${m.sourceAt(t)}`);
      else
        cap.replaceChildren(
          el(
            'strong',
            'lead',
            `${clock(t) ? `WEATHER AT ${clock(t)} (${lensRel(t)})` : `WEATHER ${lensRel(t)}`} · ${t > m.now ? (m.kindAt?.(t) === 'projected' ? 'projection on the current track' : 'forecast') : 'past'} — not live`,
          ),
          ` · ${m.sourceAt(t)} · people and incidents are shown now (dimmed people)`,
        );
      legend.replaceChildren(
        ...['observed', 'projected', 'model', 'site', 'none']
          .filter((k) => drawn.some((s) => s.kind === k))
          .map((k) => {
            const i = el('span', `lg ${k}`);
            i.append(el('i'), KIND_TEXT[k]);
            return i;
          }),
      );
    },
  };
}
