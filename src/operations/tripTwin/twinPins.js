// Person pins for Trip Twin (04 §5.4, DJ-02): the ring shows only how fresh
// the location is. Role is the T/C badge. Never red or green on a person.
import { initials } from '../participantPins.js';

export const RING = Object.freeze({
  live: { color: '#eff7f3', dash: null, hollow: false },
  stopped: { color: '#eff7f3', dash: null, hollow: false, still: true },
  aging: { color: '#f59e0b', dash: [7, 5], hollow: false },
  last: { color: '#9aa8ac', dash: [2, 5], hollow: true },
  unknown: { color: '#9aa8ac', dash: [2, 5], hollow: true, ghost: true },
});

export function ringKind(pos) {
  if (pos.id === 'POS-03') return 'stopped';
  if (pos.id === 'POS-04') return 'live';
  if (pos.id === 'POS-05') return 'aging';
  if (pos.id === 'POS-02') return 'unknown';
  return 'last';
}

const W = 80;
const H = 96;
const cache = new Map();

/** 80×96 canvas, drawn at 0.5 scale → 40×48 px on screen. */
export function pinCanvas(
  person,
  kind,
  { attention = false, selected = false } = {},
) {
  const key = `${person.id}|${kind}|${attention}|${selected}`;
  if (cache.has(key)) return cache.get(key);
  const style = RING[kind];
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const cx = W / 2;
  const cy = 38;
  const r = 30;
  g.globalAlpha = style.ghost ? 0.55 : 1;
  // Tail pointing at the fix.
  g.beginPath();
  g.moveTo(cx - 7, cy + r - 4);
  g.lineTo(cx, H - 4);
  g.lineTo(cx + 7, cy + r - 4);
  g.closePath();
  g.fillStyle = style.hollow ? 'rgba(6,26,35,0.85)' : style.color;
  g.fill();
  // Halo for contrast on any background (04 --tt-halo).
  g.beginPath();
  g.arc(cx, cy, r + 3, 0, Math.PI * 2);
  g.fillStyle = '#061a23';
  g.fill();
  // Disc.
  g.beginPath();
  g.arc(cx, cy, r - 5, 0, Math.PI * 2);
  g.fillStyle = style.hollow ? 'rgba(18,54,70,0.6)' : '#123646';
  g.fill();
  // Freshness ring.
  g.beginPath();
  g.arc(cx, cy, r - 1, 0, Math.PI * 2);
  g.lineWidth = 6;
  g.strokeStyle = style.color;
  g.setLineDash(style.dash || []);
  g.stroke();
  g.setLineDash([]);
  // Initials.
  g.fillStyle = style.hollow ? '#9aa8ac' : '#eff7f3';
  g.font = '600 20px Inter, ui-sans-serif, system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(style.ghost ? '?' : initials(person.name), cx, cy + 1);
  // Still glyph (stopped · current): two short bars at the top.
  if (style.still) {
    g.fillStyle = '#eff7f3';
    g.fillRect(cx - 7, cy - r - 2, 4, 8);
    g.fillRect(cx + 3, cy - r - 2, 4, 8);
  }
  // Role badge.
  g.fillStyle = '#061a23';
  g.fillRect(cx + 12, cy + 12, 18, 16);
  g.strokeStyle = '#80959b';
  g.lineWidth = 1.5;
  g.strokeRect(cx + 12, cy + 12, 18, 16);
  g.fillStyle = '#eff7f3';
  g.font = '700 11px ui-monospace, Menlo, monospace';
  g.fillText(person.role === 'chaperone' ? 'C' : 'T', cx + 21, cy + 20.5);
  g.globalAlpha = 1;
  // Hotspot ring (needs attention) and selection ring.
  if (attention || selected) {
    g.beginPath();
    g.arc(cx, cy, r + 6, 0, Math.PI * 2);
    g.lineWidth = 3;
    g.strokeStyle = selected ? '#eff7f3' : '#f59e0b';
    g.stroke();
  }
  cache.set(key, c);
  return c;
}
