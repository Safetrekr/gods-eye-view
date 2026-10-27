// Traffic cameras on screen (review/traffic-cameras T5): the wall plate (S1,
// S5, in the street photo's slot), the S3 board card, the still that
// refreshes every 30 s, and the All-in-one's list. Words come from
// twinCameras.js; pictures from the twin's proxy, never from an agency.
// A wall shows a still only — no video, no "live" — and it is DOM, so the
// map needs no render hold.
import {
  LONG_FOOT,
  WALL_REFRESH_S,
  cameraFrameUrl,
  cameraName,
  kindWord,
} from './twinCameras.js';

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
};

/**
 * One camera's still, fetched every 30 s while shown (paused while the
 * page is hidden). onFrame({url, fetchedAt, sameSince, state}).
 */
export function createCameraFeed(onFrame) {
  let id = null;
  let timer = null;
  let url = null;
  let last = null;
  let seq = 0;
  async function pull() {
    if (!id || document.hidden) return;
    const mine = ++seq;
    try {
      const res = await fetch(cameraFrameUrl(id, Date.now()));
      if (mine !== seq) return;
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      if (mine !== seq) return;
      const next = URL.createObjectURL(blob);
      if (url) URL.revokeObjectURL(url);
      url = next;
      // A held-over picture (the camera is failing) is marked stale.
      const stale = res.headers.get('x-twin-stale') === '1';
      last = {
        url,
        fetchedAt: Number(res.headers.get('x-twin-fetched')) || Date.now(),
        sameSince: Number(res.headers.get('x-twin-same-since')) || Date.now(),
        stale,
        state: stale ? 'failed' : 'ok',
      };
    } catch {
      if (mine !== seq) return;
      last = last ? { ...last, state: 'failed' } : { state: 'failed' };
    }
    onFrame({ ...last, id });
  }
  const onVis = () => {
    if (!document.hidden) pull();
  };
  document.addEventListener('visibilitychange', onVis);
  return {
    show(nextId) {
      if (nextId === id) return;
      id = nextId;
      seq++;
      last = null;
      if (url) URL.revokeObjectURL(url);
      url = null;
      clearInterval(timer);
      if (!id) return;
      onFrame({ id, state: 'loading' });
      pull();
      timer = setInterval(pull, WALL_REFRESH_S * 1000);
    },
    get current() {
      return last;
    },
    dispose() {
      this.show(null);
      document.removeEventListener('visibilitychange', onVis);
    },
  };
}

/** The camera's picture and lines; `card` is the S3 board card form. */
function cameraBody(root, { card = false } = {}) {
  const kicker = el('div', 'tt-kicker tt-photo-kicker');
  const frame = el('div', 'tt-photo-frame tt-cam-frame');
  const img = new Image();
  img.alt = '';
  img.decoding = 'async';
  const wait = el('div', 'tt-photo-wait', 'Fetching the traffic camera…');
  frame.append(img, wait);
  const name = el('div', 'tt-photo-dir tt-cam-name');
  const where = el('div', 'tt-photo-age tt-cam-where');
  const time = el('div', 'tt-wall-note tt-cam-time');
  const note = el('div', 'tt-wall-note tt-cam-note');
  const foot = el('div', 'tt-wall-note tt-photo-foot');
  const credit = el('div', 'tt-photo-credit');
  root.append(kicker, frame, name, where, time, note, foot, credit);
  img.addEventListener('load', () => {
    img.classList.add('in');
    wait.hidden = true;
  });
  return {
    update({ lines, frame: f }) {
      kicker.textContent = lines.kicker;
      name.textContent = lines.name;
      where.textContent = lines.where;
      time.textContent = lines.time;
      note.textContent = lines.note || '';
      note.hidden = !lines.note;
      foot.textContent = lines.foot;
      credit.textContent = lines.credit;
      root.dataset.ttCameraState = f?.state || 'loading';
      if (f?.url && img.dataset.src !== f.url) {
        img.dataset.src = f.url;
        img.src = f.url;
      }
      // A failed refresh keeps the last image, dimmed.
      frame.classList.toggle('stale', f?.state === 'failed');
      if (!f?.url) {
        img.removeAttribute('src');
        delete img.dataset.src;
        img.classList.remove('in');
        wait.hidden = false;
        wait.textContent =
          f?.state === 'failed'
            ? 'Not answering right now'
            : 'Fetching the traffic camera…';
      }
    },
  };
}

/** The wall plate: the street photo's slot, while a camera is sent here. */
export function createCameraPlate() {
  const root = el('div', 'tt-photo-plate cam');
  root.hidden = true;
  root.setAttribute('role', 'figure');
  const body = cameraBody(root);
  return { el: root, update: body.update };
}

/** The S3 board card, at the end of the right column; it folds first. */
export function createCameraCard() {
  const root = el('section', 'tt-board-card tt-board-camera');
  const body = cameraBody(root, { card: true });
  return { el: root, update: body.update };
}

/**
 * The All-in-one's list (collapsed): up to 5 cameras, each with Open and
 * Show on the wall. o: {cameras, line, wallLabel, shownId, status, stopAny,
 * canSend, linkNote, onOpen(c), onShow(c), onStop(), open}. The status line
 * says what the walls show, whichever list this is, with Stop.
 */
export function cameraBlock(o) {
  const box = el('details', 'tt-cam-block');
  box.open = Boolean(o.open);
  const sum = el(
    'summary',
    'tt-kicker',
    `TRAFFIC CAMERAS NEARBY${o.stopAny ? ' · ONE ON THE WALLS' : ''}`,
  );
  box.append(sum);
  if (o.status) {
    const st = el('div', 'tt-cam-status');
    st.append(el('span', 'tt-line', o.status));
    if (o.stopAny) {
      const b = el('button', 'tt-btn sm', 'Stop traffic camera');
      b.type = 'button';
      b.addEventListener('click', () => o.onStop?.());
      st.append(b);
    }
    box.append(st);
  }
  if (!o.cameras?.length) {
    box.append(el('div', 'tt-line dim', o.line || ''));
    return box;
  }
  const list = el('ul', 'tt-cam-list');
  for (const c of o.cameras) {
    const li = el('li', `tt-cam-row${c.id === o.shownId ? ' on' : ''}`);
    li.append(
      el('div', 'tt-cam-row-name', cameraName(c.name)),
      el('div', 'tt-cam-row-meta', `${c.distText} · ${kindWord(c.kind)}`),
    );
    const acts = el('div', 'tt-photo-acts');
    const btn = (label, fn) => {
      const b = el('button', 'tt-btn sm', label);
      b.type = 'button';
      b.addEventListener('click', fn);
      acts.append(b);
    };
    btn('Open', () => o.onOpen?.(c));
    if (c.id !== o.shownId && o.canSend !== false)
      btn(`Show on ${o.wallLabel}`, () => o.onShow?.(c));
    li.append(acts);
    list.append(li);
  }
  box.append(list);
  if (o.linkNote) box.append(el('div', 'tt-line dim', o.linkNote));
  box.append(
    el(
      'div',
      'tt-photo-foot-long',
      'Public road cameras near the place, not views of the group · walls show one traffic camera at a time, a still every 30 s, and stop it after 30 min',
    ),
  );
  return box;
}

/**
 * The All-in-one's viewer for a still camera: the proxy's picture, every
 * 30 s, undimmed so the operator can judge it. o: {camera, lines(frame)}.
 */
export function openCameraViewer(o) {
  document.querySelector('.tt-photo-view')?.dispatchEvent(new Event('close'));
  const root = el('div', 'tt-photo-view tt-cam-view');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', cameraName(o.camera.name));
  const head = el('div', 'tt-photo-view-head');
  const x = el('button', 'tt-btn sm tt-photo-x', '×');
  x.type = 'button';
  x.setAttribute('aria-label', 'Close');
  const kick = el('div', 'tt-kicker');
  head.append(kick, x);
  const stage = el('div', 'tt-photo-stage tt-cam-stage');
  const img = new Image();
  img.alt = 'Traffic camera still';
  img.className = 'tt-photo-full';
  const wait = el('div', 'tt-photo-wait', 'Fetching the traffic camera…');
  stage.append(wait, img);
  const name = el('div', 'tt-photo-dir');
  const where = el('div', 'tt-photo-age');
  const time = el('div', 'tt-photo-credit');
  const note = el('div', 'tt-photo-credit');
  const credit = el('div', 'tt-photo-credit');
  const foot = el('div', 'tt-photo-foot-long', LONG_FOOT);
  root.append(head, stage, name, where, time, note, credit, foot);
  document.body.append(root);
  const draw = (frame) => {
    const l = o.lines(frame);
    kick.textContent = l.kicker;
    name.textContent = l.name;
    where.textContent = l.where;
    time.textContent = l.time;
    note.textContent = l.note || '';
    credit.textContent = l.credit;
    if (frame?.url) {
      img.src = frame.url;
      wait.hidden = true;
    }
    stage.classList.toggle('stale', l.state === 'failed');
  };
  draw(null);
  const feed = createCameraFeed((f) => draw(f));
  feed.show(o.camera.id);
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  function close() {
    feed.dispose();
    root.remove();
    document.removeEventListener('keydown', onKey);
  }
  x.addEventListener('click', close);
  root.addEventListener('close', close);
  document.addEventListener('keydown', onKey);
  return { close };
}
