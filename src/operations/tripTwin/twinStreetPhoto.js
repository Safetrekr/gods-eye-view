// Street photos on screen (review/street-photos P5, UI spec P4): the wall
// plate on S1 and S5, the All-in-one's block in a card, the larger viewer,
// and the direction wedge. Words come from twinStreetPhotos.js; pictures
// from the twin's proxy (/api/twin-photos/*), never from a provider.
// A wall's picture is still: it never pans, so it needs no render hold.
import { createPanoramaRenderer } from '../../layers/streetLevel/panorama.js';
import { panoramaxPictureUrl } from '../../layers/streetLevel/providers/panoramax/policy.js';
import { photoCredit } from './twinStreetPhotos.js';

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
};
const SVG = 'http://www.w3.org/2000/svg';

/**
 * A north-up dial with the view's sector: 18 px, steel. The words say the
 * direction; this only shows it (aria-hidden).
 */
export function photoWedge(lookDeg, fovDeg = 75) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 18 18');
  svg.setAttribute('class', 'tt-photo-wedge');
  svg.setAttribute('aria-hidden', 'true');
  const ring = document.createElementNS(SVG, 'circle');
  ring.setAttribute('cx', '9');
  ring.setAttribute('cy', '9');
  ring.setAttribute('r', '8');
  ring.setAttribute('class', 'ring');
  const tick = document.createElementNS(SVG, 'path');
  tick.setAttribute('d', 'M9 1 V3');
  tick.setAttribute('class', 'tick');
  svg.append(ring, tick);
  if (Number.isFinite(lookDeg)) {
    const half = Math.min(170, (fovDeg || 60) / 2);
    const pt = (deg) => {
      const r = ((deg - 90) * Math.PI) / 180;
      return `${(9 + 7 * Math.cos(r)).toFixed(2)} ${(9 + 7 * Math.sin(r)).toFixed(2)}`;
    };
    const sector = document.createElementNS(SVG, 'path');
    sector.setAttribute(
      'd',
      `M9 9 L${pt(lookDeg - half)} A7 7 0 0 1 ${pt(lookDeg + half)} Z`,
    );
    sector.setAttribute('class', 'sector');
    svg.append(sector);
  }
  return svg;
}

/** Where a pick looks (degrees) and how wide, for the wedge. */
// No heading, no wedge: the direction is not known (every-time P1-1).
export function lookOf(pick) {
  const p = pick?.photo;
  if (!p || p.heading == null) return { look: null, fov: null };
  if (pick.view) return { look: p.heading + pick.view.yaw, fov: pick.view.fov };
  return { look: p.heading, fov: p.fov || 70 };
}

/**
 * The wall plate: kicker, a 2:1 picture, direction, age, foot. Hidden until
 * update() has a picture; `onFail(url)` when the image would not load.
 */
export function createPhotoPlate({ onFail = () => {} } = {}) {
  const root = el('div', 'tt-photo-plate');
  root.hidden = true;
  root.setAttribute('role', 'figure');
  const kicker = el('div', 'tt-kicker tt-photo-kicker');
  const frame = el('div', 'tt-photo-frame');
  const img = new Image();
  img.alt = '';
  img.decoding = 'async';
  const wait = el('div', 'tt-photo-wait', 'Looking for street photos…');
  frame.append(img, wait);
  const dir = el('div', 'tt-photo-dir');
  const age = el('div', 'tt-photo-age');
  const note = el('div', 'tt-wall-note tt-photo-note');
  const foot = el('div', 'tt-wall-note tt-photo-foot');
  // The photographer and licence on the plate itself: the footer is cut at
  // 1728 (UI, brand round 1).
  const credit = el('div', 'tt-photo-credit');
  // No picture (none, not reachable, hidden, failed): one dim line in the
  // plate's place, never an empty frame.
  const line = el('div', 'tt-wall-note tt-photo-line');
  root.append(kicker, frame, dir, age, note, foot, credit, line);
  img.addEventListener('load', () => {
    img.classList.add('in');
    wait.hidden = true;
  });
  img.addEventListener('error', () => {
    if (img.dataset.src) onFail(img.dataset.src);
  });
  return {
    el: root,
    /** lines: photoLines(); url: photoUrl(); pick: pickPhoto(). */
    update({ lines, url, pick, show = true }) {
      root.dataset.ttPhotoState = lines?.state || 'loading';
      const has = Boolean(url && lines?.kicker);
      const compact = !has && lines?.state !== 'loading';
      root.classList.toggle('compact', compact);
      root.hidden = !show || (!has && !lines);
      if (root.hidden) return;
      frame.hidden = compact;
      dir.hidden = compact;
      age.hidden = compact;
      foot.hidden = compact;
      credit.hidden = compact;
      note.hidden = compact || !lines?.note;
      line.hidden = !compact;
      if (compact) {
        kicker.textContent = 'STREET PHOTO';
        line.textContent = lines.line || '';
        img.removeAttribute('src');
        delete img.dataset.src;
        img.classList.remove('in');
        return;
      }
      if (!has) {
        kicker.textContent = 'STREET PHOTO';
        img.removeAttribute('src');
        delete img.dataset.src;
        img.classList.remove('in');
        wait.hidden = false;
        dir.replaceChildren();
        age.textContent = '';
        foot.textContent = '';
        credit.textContent = '';
        return;
      }
      kicker.textContent = lines.kicker;
      if (img.dataset.src !== url) {
        img.classList.remove('in');
        wait.hidden = false;
        img.dataset.src = url;
        img.src = url;
      }
      const { look, fov } = lookOf(pick);
      dir.replaceChildren(photoWedge(look, fov), el('span', '', lines.dir));
      age.textContent = lines.age;
      age.classList.toggle('old', Boolean(lines.old));
      // The note never replaces the foot (brand round 1).
      note.textContent = lines.note || '';
      foot.textContent = lines.foot;
      credit.textContent = lines.credit;
    },
    hide() {
      root.hidden = true;
    },
  };
}

/**
 * The All-in-one's block in a card (site, place, stop brief): a 2:1
 * thumbnail, the lines, and the operator's controls.
 * o: {lines, url, pick, index, count, kept, hidden, controls, linkNote,
 *     longFoot, onPrev, onNext, onOpen, onKeep, onHide, onAuto, onFail}
 * A hidden photo stays visible here, dimmed, with Show on walls (IA round 1).
 */
export function photoBlock(o) {
  const box = el('div', `tt-photo-block${o.hidden ? ' hidden-on-walls' : ''}`);
  box.dataset.ttPhotoState = o.hidden ? 'hidden' : o.lines?.state || 'loading';
  const head = el(
    'div',
    'tt-kicker tt-photo-kicker',
    o.lines?.kicker || 'STREET PHOTO',
  );
  box.append(head);
  const has = Boolean(o.url && o.lines?.kicker);
  if (has) {
    const b = el('button', 'tt-photo-thumb');
    b.type = 'button';
    b.title = 'Open the photo larger';
    const img = new Image();
    img.alt = 'Street photo';
    img.decoding = 'async';
    img.src = o.url;
    img.addEventListener('load', () => img.classList.add('in'));
    img.addEventListener('error', () => o.onFail?.(o.url));
    b.append(img);
    b.addEventListener('click', () => o.onOpen?.());
    const { look, fov } = lookOf(o.pick);
    const dir = el('div', 'tt-photo-dir');
    dir.append(photoWedge(look, fov), el('span', '', o.lines.dir));
    const age = el(
      'div',
      `tt-photo-age${o.lines.old ? ' old' : ''}`,
      o.lines.age,
    );
    box.append(b, dir, age);
    if (o.lines.note) box.append(el('div', 'tt-line dim', o.lines.note));
    box.append(el('div', 'tt-photo-credit', o.lines.credit));
  } else {
    box.append(el('div', 'tt-line dim', o.lines?.line || ''));
  }
  const acts = el('div', 'tt-photo-acts');
  const btn = (label, fn, cls = '') => {
    const b = el('button', `tt-btn sm${cls ? ` ${cls}` : ''}`, label);
    b.type = 'button';
    b.addEventListener('click', fn);
    acts.append(b);
    return b;
  };
  if (o.count > 1) {
    btn('‹', () => o.onPrev?.()).setAttribute('aria-label', 'Previous photo');
    acts.append(el('span', 'tt-photo-count', `${o.index + 1} of ${o.count}`));
    btn('›', () => o.onNext?.()).setAttribute('aria-label', 'Next photo');
  }
  if (has) btn('Open', () => o.onOpen?.());
  if (o.controls !== false) {
    if (o.hidden) btn('Show on walls', () => o.onAuto?.());
    else {
      if (has && !o.kept) btn('Keep for this trip', () => o.onKeep?.());
      if (has || o.lines?.state === 'none')
        btn('Hide on walls', () => o.onHide?.());
      if (o.kept) btn('Back to automatic', () => o.onAuto?.());
    }
  }
  if (acts.childNodes.length) box.append(acts);
  if (o.linkNote) box.append(el('div', 'tt-line dim', o.linkNote));
  if (o.longFoot) box.append(el('div', 'tt-photo-foot-long', o.longFoot));
  return box;
}

/**
 * The larger viewer over the map: a 360° photo drags (WebGL, one context,
 * freed on close); a flat one shows whole. o: {title, pick, fullUrl, lines,
 * longFoot, onUseView(view), onKeep, onHide, onPrev, onNext, index, count,
 * faceLabel}. Returns {close}.
 */
export function openPhotoViewer(o) {
  document.querySelector('.tt-photo-view')?.dispatchEvent(new Event('close'));
  const root = el('div', 'tt-photo-view');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', o.title);
  const head = el('div', 'tt-photo-view-head');
  const x = el('button', 'tt-btn sm tt-photo-x', '×');
  x.type = 'button';
  x.setAttribute('aria-label', 'Close');
  head.append(el('div', 'tt-kicker', o.title), x);
  const stage = el('div', 'tt-photo-stage');
  const status = el('div', 'tt-photo-wait', 'Loading the photo…');
  stage.append(status);
  const lines = el('div', 'tt-photo-view-lines');
  const { look, fov } = lookOf(o.pick);
  const dir = el('div', 'tt-photo-dir');
  dir.append(photoWedge(look, fov), el('span', '', o.lines.dir));
  lines.append(
    dir,
    el('div', 'tt-photo-age', o.lines.age),
    // Shown as taken here: the credit carries no "cropped and dimmed".
    el('div', 'tt-photo-credit', photoCredit(o.pick?.photo)),
    el('div', 'tt-photo-foot-long', o.longFoot),
  );
  const acts = el('div', 'tt-photo-acts');
  const btn = (label, fn) => {
    const b = el('button', 'tt-btn sm', label);
    b.type = 'button';
    b.addEventListener('click', fn);
    acts.append(b);
    return b;
  };
  root.append(head, stage, lines, acts);
  document.body.append(root);

  let renderer = null;
  let canvas = null;
  const isPano = Boolean(o.pick?.photo?.isPano);
  const start = o.pick?.view || { yaw: 0, pitch: 0, fov: 75 };
  if (o.count > 1) {
    btn('‹ Previous', () => o.onPrev?.());
    acts.append(el('span', 'tt-photo-count', `${o.index + 1} of ${o.count}`));
    btn('Next ›', () => o.onNext?.());
  }
  if (isPano) {
    btn(o.faceLabel || 'Face the place', () => {
      renderer?.setView({ ...start, fov: 80 });
    });
    if (o.controls !== false)
      btn('Keep this view for this trip', () => {
        const v = renderer?.getView();
        if (!v) return;
        o.onUseView?.({
          yaw: (Math.round(v.yaw / 5) * 5 + 360) % 360,
          pitch: Math.max(0, Math.min(30, Math.round(v.pitch / 5) * 5)),
        });
        say(o.linkNote ? `Kept · ${o.linkNote}` : 'Kept: walls show this view');
      });
  } else if (o.controls !== false)
    btn('Keep for this trip', () => {
      o.onKeep?.();
      say(o.linkNote ? `Kept · ${o.linkNote}` : 'Kept: walls show this photo');
    });
  if (o.controls !== false)
    btn('Hide on walls', () => {
      o.onHide?.();
      say(o.linkNote ? `Hidden · ${o.linkNote}` : 'Hidden on walls');
    });
  // The photo at its source (CC BY-SA asks for a link where practicable).
  const p0 = o.pick?.photo;
  if (p0?.provider === 'panoramax') {
    const a = el('a', 'tt-btn sm', 'Panoramax ↗');
    a.href = panoramaxPictureUrl(p0.id);
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    acts.append(a);
  }
  const said = el('span', 'tt-photo-count');
  said.setAttribute('role', 'status');
  acts.append(said);
  function say(t) {
    said.textContent = t;
  }

  (async () => {
    try {
      const res = await fetch(o.fullUrl);
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      if (!root.isConnected) return;
      if (isPano) {
        canvas = el('canvas', 'tt-photo-canvas');
        stage.append(canvas);
        try {
          renderer = createPanoramaRenderer(canvas);
        } catch {
          renderer = null;
        }
        if (renderer) {
          renderer.setImage(await createImageBitmap(blob));
          renderer.setView({ ...start, fov: 80 });
          status.hidden = true;
          dragOn(canvas);
          return;
        }
        canvas.remove();
      }
      const img = new Image();
      img.alt = 'Street photo';
      img.src = URL.createObjectURL(blob);
      img.className = 'tt-photo-full';
      img.addEventListener('load', () => URL.revokeObjectURL(img.src));
      stage.append(img);
      status.hidden = true;
    } catch {
      status.textContent = 'The photo would not load · not shown';
    }
  })();

  function dragOn(c) {
    let from = null;
    c.addEventListener('pointerdown', (e) => {
      from = { x: e.clientX, y: e.clientY, v: renderer.getView() };
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      if (!from) return;
      const k = from.v.fov / Math.max(1, c.clientWidth);
      renderer.setView({
        yaw: from.v.yaw - (e.clientX - from.x) * k,
        pitch: from.v.pitch + (e.clientY - from.y) * k,
      });
    });
    const end = () => {
      from = null;
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const v = renderer.getView();
        renderer.setView({ fov: v.fov + Math.sign(e.deltaY) * 5 });
      },
      { passive: false },
    );
  }

  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  function close() {
    renderer?.destroy();
    renderer = null;
    root.remove();
    document.removeEventListener('keydown', onKey);
  }
  x.addEventListener('click', close);
  root.addEventListener('close', close);
  document.addEventListener('keydown', onKey);
  return { close };
}
