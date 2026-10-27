// Compass (phase 3 Part D, Jesse): north is always readable, and clicking a
// side views the site from that side. The dial turns with the camera so each
// letter points at the real direction on screen; letters stay upright.

export const SIDES = Object.freeze([
  { key: 'N', name: 'north', from: 0 },
  { key: 'E', name: 'east', from: 90 },
  { key: 'S', name: 'south', from: 180 },
  { key: 'W', name: 'west', from: 270 },
]);

const norm = (d) => ((d % 360) + 360) % 360;

/** Camera look direction for "view from <side>": stand there, look across. */
export const lookHeadingFrom = (fromDeg) => norm(fromDeg + 180);

/** Which side the camera is on now (nearest of N/E/S/W). */
export function currentSide(headingDeg) {
  const from = norm(headingDeg + 180);
  return SIDES[Math.round(from / 90) % 4];
}

const WIND = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const wind = (deg) => WIND[Math.round(norm(deg) / 45) % 8];

/** Caption under the dial: "Viewing from S · looking N". */
export function compassCaption(headingDeg) {
  return `Viewing from ${wind(headingDeg + 180)} · looking ${wind(headingDeg)}`;
}

/**
 * Straight down there is no side to view from (screens/55-S2-PLAN): the
 * caption says plan view and which way is up — "north up" within 5°.
 */
export function planCaption(headingDeg) {
  const h = norm(headingDeg);
  return Math.min(h, 360 - h) <= 5
    ? 'Plan view · north up'
    : `Plan view · up is ${wind(h)}`;
}

/** Rotate the view by ±90° around the target (keys , and .). */
export const rotated = (headingDeg, dir) => norm(headingDeg + 90 * dir);

/**
 * createCompass({ onView(headingDeg), onNorthUp() }) → { el, update(heading) }.
 */
export function createCompass({ onView, onNorthUp }) {
  const root = document.createElement('div');
  root.className = 'tt-compass';
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', 'Compass: view the site from a side');
  const dial = document.createElement('div');
  dial.className = 'tt-compass-dial';
  const ticks = document.createElement('div');
  ticks.className = 'tt-compass-ticks';
  ticks.setAttribute('aria-hidden', 'true');
  dial.append(ticks);
  const buttons = SIDES.map((side) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `tt-compass-side s-${side.key}`;
    b.textContent = side.key;
    b.title = `View from ${side.name}`;
    b.setAttribute('aria-label', `View from ${side.name}`);
    b.addEventListener('click', () => onView(lookHeadingFrom(side.from)));
    dial.append(b);
    return { side, b };
  });
  // A fixed north marker on the dial (turns with it, always points north).
  const north = document.createElement('span');
  north.className = 'tt-compass-north';
  north.setAttribute('aria-hidden', 'true');
  dial.append(north);
  // Off-scene hazards at amber (hazards H4): a tick on the dial's edge
  // toward each, turning with the dial; at most two.
  const hzLayer = document.createElement('div');
  hzLayer.className = 'tt-compass-hzs';
  hzLayer.setAttribute('aria-hidden', 'true');
  dial.append(hzLayer);
  const baseLabel = root.getAttribute('aria-label');
  const center = document.createElement('button');
  center.type = 'button';
  center.className = 'tt-compass-center';
  center.title = 'North up (N): view from the south side, looking north';
  center.setAttribute('aria-label', 'North up');
  center.addEventListener('click', onNorthUp);
  const caption = document.createElement('div');
  caption.className = 'tt-compass-caption';
  caption.setAttribute('aria-hidden', 'true'); // buttons carry the names
  root.append(dial, center, caption);
  let last = null;
  let lastHz = '';
  return {
    el: root,
    /** items: [{deg, kind: 'fire'|'cyclone', label}] (at most two shown). */
    setHazards(items = []) {
      const list = items.filter((i) => Number.isFinite(i.deg)).slice(0, 2);
      const key = list.map((i) => `${i.kind}:${Math.round(i.deg)}`).join('|');
      if (key === lastHz) return;
      lastHz = key;
      hzLayer.replaceChildren(
        ...list.map((i) => {
          const arm = document.createElement('span');
          arm.className = 'tt-compass-hzarm';
          arm.style.transform = `rotate(${Math.round(i.deg)}deg)`;
          const tick = document.createElement('span');
          tick.className = `tt-compass-hz ${i.kind}`;
          arm.append(tick);
          return arm;
        }),
      );
      root.setAttribute(
        'aria-label',
        list.length
          ? `${baseLabel} · ${list.map((i) => i.label).join(' · ')}`
          : baseLabel,
      );
    },
    /** pitch (radians, optional): near straight down reads as plan view. */
    update(headingDeg, pitch = null) {
      const h = Math.round(norm(headingDeg));
      const plan = pitch != null && pitch < -1.4; // steeper than ~80°
      const key = `${h}|${plan}`;
      if (key === last) return;
      last = key;
      // Screen-up is the look direction, so north sits at -heading.
      dial.style.transform = `rotate(${-h}deg)`;
      const on = currentSide(h).key;
      for (const { side, b } of buttons) {
        b.style.transform = `translate(-50%, -50%) rotate(${h}deg)`;
        b.classList.toggle('on', side.key === on);
        b.setAttribute('aria-pressed', String(side.key === on));
      }
      caption.textContent = plan ? planCaption(h) : compassCaption(h);
      root.classList.toggle('plan', plan);
    },
  };
}
