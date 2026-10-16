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
  return {
    el: root,
    update(headingDeg) {
      const h = Math.round(norm(headingDeg));
      if (h === last) return;
      last = h;
      // Screen-up is the look direction, so north sits at -heading.
      dial.style.transform = `rotate(${-h}deg)`;
      const on = currentSide(h).key;
      for (const { side, b } of buttons) {
        b.style.transform = `translate(-50%, -50%) rotate(${h}deg)`;
        b.classList.toggle('on', side.key === on);
        b.setAttribute('aria-pressed', String(side.key === on));
      }
      caption.textContent = compassCaption(h);
    },
  };
}
