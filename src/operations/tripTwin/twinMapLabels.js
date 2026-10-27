// Trip Twin's map words on upstream's world overlay (review/map-labels L5).
// Layers no longer make Cesium labels: an entity carries `mapLabel` (a
// twinMapLabelEntries.js record, solved by upstream's arbiter) or `mapText`
// (the floor instrument, painted last by Trip Twin's own lane so nothing
// covers a floor number or an initial). This bridge watches the data sources
// as the declutter does and publishes them as ONE overlay source, so
// priority holds across layers (every-time P0-1). Upstream's files are
// imported, never edited.
import * as Cesium from 'cesium';
import {
  initWorldOverlay,
  destroyWorldOverlay,
  setOverlayEntries,
  clearOverlaySource,
  hitTestWorldOverlay,
  getOverlayPaintRect,
  registerWorldOverlayPaintLane,
} from '../../overlays/worldOverlay.js';
import { WORLD_OVERLAY_STYLE } from '../../overlays/worldOverlayTokens.js';
import {
  PAGE_LABEL_SCALE,
  TT_LABEL_GROUP,
  freeRect,
  hiddenShare,
  hiddenSide,
  labelSignature,
  overlayFields,
  rulerOrder,
  stackTags,
} from './twinMapLabelEntries.js';
import { declutter } from './twinDeclutter.js';

/** The face upstream's overlay asks for (aliased to Inter, L5 D3). */
export const OVERLAY_FONT = 'JetBrains Mono';
export const overlayFontNamed = () =>
  String(WORLD_OVERLAY_STYLE.fontLabel || '').includes(OVERLAY_FONT);
const INTER_CSS =
  'https://fonts.googleapis.com/css2?family=Inter:wght@500;600&display=swap';

/**
 * Register Inter under the overlay's font name on this page only, from the
 * Google Fonts files the page already uses. No file is added to the repo; a
 * failure leaves the overlay's monospace fallback.
 */
export async function aliasOverlayFont(doc = document) {
  const css = await (await fetch(INTER_CSS)).text();
  const faces = [];
  for (const block of css.match(/@font-face\s*{[^}]*}/g) || []) {
    const url = /url\(([^)]+)\)/.exec(block)?.[1];
    if (!url) continue;
    const weight = /font-weight:\s*([^;]+);/.exec(block)?.[1] || '500';
    const range = /unicode-range:\s*([^;]+);/.exec(block)?.[1];
    faces.push(
      new FontFace(OVERLAY_FONT, `url(${url})`, {
        weight,
        style: 'normal',
        ...(range ? { unicodeRange: range } : {}),
      }),
    );
  }
  for (const f of faces) doc.fonts.add(f);
  await Promise.all(faces.map((f) => f.load().catch(() => null)));
  return faces.length;
}

const FLOOR_PAD = { x: 4, y: 2 };
const SOURCE = TT_LABEL_GROUP;
// Keep-out bands reuse ids upstream's frozen exclusion list already names
// (L3 §4); z 7 keeps them soft: a veto (z ≤ 6) could drop a rally label.
const BAND_IDS = {
  left: 'left-panel-stack',
  right: 'right-context-rail',
  top: 'title-bar',
  bottom: 'command-dock',
};
const ARROW = { left: '◂', right: '▸', top: '▴', bottom: '▾' };
const pxScale = (font, f) =>
  f === 1
    ? font
    : font.replace(/(\d+(?:\.\d+)?)px/, (_, p) => `${(p * f).toFixed(1)}px`);

/**
 * Start the host on this page. o: {scale() → presentation scale (read on the
 * beat, never per frame), wall() → true on a wall (no pointer input),
 * onActivate(entity)}. Returns {pick, paintRects, composite, beat,
 * setSafeArea, diagnostics, dispose}.
 */
export function createTwinMapLabels(viewer, o = {}) {
  const scene = viewer.scene;
  let current = o.scale?.() || 1;
  const scale = () => current;
  let safeArea = null; // () => covered margins in viewport px
  initWorldOverlay(viewer);
  const recs = new Map(); // data source → its record
  let n = 0;
  let published = false;
  let dirty = true;
  let shownKey = '';
  let floorHits = [];
  let rects = [];
  let tagsPainted = 0;
  let uiRects = 0;
  const offs = [];

  const now = () => viewer.clock.currentTime;
  const positionOf = (e) => {
    const p = e.position;
    if (!p) return null;
    if (p.isConstant) {
      const v = p.getValue(now());
      return v ? () => v : null;
    }
    const out = new Cesium.Cartesian3();
    return () => p.getValue(now(), out);
  };

  /** A data source's labels, re-read when anything about them changed. */
  function sync(ds) {
    const r = recs.get(ds);
    if (!r) return;
    const wall = Boolean(o.wall?.());
    const interactive = !wall;
    const parts = [];
    const entries = [];
    const texts = [];
    const tops = [];
    const guard = new Map();
    for (const e of ds.entities.values) {
      if (e.show === false) continue;
      if (e.mapText) texts.push(e);
      if (e.onTop && e.billboard) tops.push(e);
      if (!e.mapLabel) continue;
      let f;
      try {
        f = overlayFields(e.mapLabel, { scale, interactive, wall });
      } catch {
        continue; // a live title that throws never stops the others
      }
      if (!f.title) continue; // '' says nothing (a merged route End)
      const at = e.position?.isConstant ? e.position.getValue(now()) : null;
      parts.push(
        `${e.id}|${labelSignature(e.mapLabel, f)}|${at ? `${at.x.toFixed(1)},${at.y.toFixed(1)}` : ''}`,
      );
      const position = positionOf(e);
      if (!position) continue;
      const id = `${r.n}:${e.id}`;
      if (f.protected)
        guard.set(id, {
          title: f.title,
          state: e.mapLabel.state,
          accent: f.accent,
          e,
        });
      entries.push({
        id,
        position,
        ...f,
        accessibilityLabel: f.interactive ? f.title : '',
        activate:
          f.interactive && o.onActivate
            ? () => o.onActivate(e) !== false
            : null,
        metadata: {
          entity: e,
          kind: e.mapLabel.kind,
          state: e.mapLabel.state,
          tagAlso: e.mapLabel.tagAlso,
          merge: e.mapLabel.merge,
          rank: e.mapLabel.rank,
        },
      });
    }
    r.texts = texts;
    r.tops = tops;
    const sig = parts.join('\n');
    if (sig === r.sig) return;
    r.sig = sig;
    r.entries = entries;
    r.guard = guard;
    dirty = true;
    scene.requestRender();
  }

  // A double-buffered layer (people) keeps its old source up until the new
  // one's geometry is ready; its words are ready at once, so only the
  // newest source of a name is read (no doubled, side-stepped initials).
  function visible() {
    const newest = new Map();
    for (const [ds, r] of recs) {
      // A source not read yet never hides the one on screen (no blink).
      if (r.sig === null) continue;
      const prev = newest.get(r.key);
      if (!prev || r.n > recs.get(prev).n) newest.set(r.key, ds);
    }
    const out = [];
    for (const [ds, r] of recs)
      if (ds.show !== false && newest.get(r.key) === ds) out.push(r);
    return out;
  }
  /** One overlay source for every layer, re-sent only on change. */
  let pub = [];
  function publish() {
    const vis = visible();
    const key = vis.map((r) => r.n).join(',');
    if (!dirty && key === shownKey) return;
    dirty = false;
    shownKey = key;
    pub = [];
    for (const r of vis)
      for (const ent of r.entries) {
        if (merged.drop.has(ent.id)) continue;
        const x = merged.extra.get(ent.id);
        pub.push(
          x
            ? {
                ...ent,
                variant: 'card',
                details: [...ent.details, ...x.lines],
                protected: ent.protected || x.protect,
                metadata: {
                  ...ent.metadata,
                  tagAlso: [...(ent.metadata.tagAlso || []), ...x.titles],
                },
              }
            : ent,
        );
      }
    if (pub.length) setOverlayEntries(SOURCE, pub);
    else if (published) clearOverlaySource(SOURCE);
    published = pub.length > 0;
  }

  // Places a plate's height apart on screen share one plate too (UI round
  // 2): the most important carries the others' words, and stays protected
  // if any of them is. Worked out when the camera is still.
  let merged = { key: '', drop: new Set(), extra: new Map() };
  function screenMerge() {
    if (moving) return;
    const reach = 62 * current;
    const pts = [];
    for (const r of visible())
      for (const ent of r.entries) {
        if (!ent.metadata.merge) continue;
        const p = ent.position();
        const w =
          p && Cesium.SceneTransforms.worldToWindowCoordinates(scene, p);
        if (w)
          pts.push({
            ent,
            x: w.x,
            y: w.y,
            // Roughly half the plate (Inter at 12 px is ~7 px a letter).
            halfW:
              ((Math.max(
                ent.title.length,
                ...ent.details.map((d) => d.length),
              ) *
                6.5 +
                24) /
                2) *
              current,
          });
      }
    pts.sort(
      (a, b) =>
        (a.ent.metadata.rank ?? 10) - (b.ent.metadata.rank ?? 10) ||
        b.ent.priority - a.ent.priority,
    );
    const hosts = [];
    const drop = new Set();
    const extra = new Map();
    for (const p of pts) {
      // Inside the room the host's plate takes, above or below it: about
      // half a plate's width across, a leader gap plus a plate up or down.
      const h = hosts.find(
        (q) => Math.abs(q.x - p.x) < q.halfW && Math.abs(q.y - p.y) < reach,
      );
      if (!h) {
        hosts.push(p);
        continue;
      }
      drop.add(p.ent.id);
      const x = extra.get(h.ent.id) || {
        lines: [],
        titles: [],
        protect: false,
      };
      const words = [
        p.ent.title,
        ...p.ent.details.filter((d) => !/^(Also here|End of shown)/.test(d)),
      ].join(' · ');
      x.lines.push(`Also here: ${words}`);
      // The route's End stays said when its place merges (every-time R3).
      if (
        p.ent.details.includes('End of shown route') &&
        !h.ent.details.includes('End of shown route') &&
        !x.lines.includes('End of shown route')
      )
        x.lines.push('End of shown route');
      if (p.ent.protected) {
        x.protect = true;
        x.titles.push(p.ent.title);
      }
      extra.set(h.ent.id, x);
    }
    // The words are in the key: a state change re-sends the plate.
    const key = JSON.stringify([
      [...drop].sort(),
      [...extra].map(([id, x]) => [id, x.lines, x.titles]),
    ]);
    if (key === merged.key) return;
    merged = { key, drop, extra };
    dirty = true;
    scene.requestRender();
  }

  const track = (ds) => {
    if (recs.has(ds)) return;
    const r = {
      n: (n += 1),
      key: ds.name || `#${n}`,
      sig: null,
      entries: [],
      texts: [],
      tops: [],
      guard: new Map(),
    };
    // A rebuild adds entities one by one: one read per batch (AIA R2).
    r.off = ds.entities.collectionChanged.addEventListener(() => later(ds));
    recs.set(ds, r);
    sync(ds);
  };
  const queued = new Set();
  const later = (ds) => {
    if (queued.has(ds)) return;
    queued.add(ds);
    queueMicrotask(() => {
      queued.delete(ds);
      sync(ds);
    });
  };
  const untrack = (ds) => {
    const r = recs.get(ds);
    if (!r) return;
    r.off();
    recs.delete(ds);
    dirty = true;
    scene.requestRender();
  };
  track({ entities: viewer.entities, show: true, name: 'default' });
  for (let i = 0; i < viewer.dataSources.length; i += 1)
    track(viewer.dataSources.get(i));
  offs.push(
    viewer.dataSources.dataSourceAdded.addEventListener((_, ds) => track(ds)),
    viewer.dataSources.dataSourceRemoved.addEventListener((_, ds) =>
      untrack(ds),
    ),
    // A layer hides by `ds.show`: the source follows before the frame.
    scene.preRender.addEventListener(publish),
  );

  const bands = Object.entries(BAND_IDS).map(([side, id]) => {
    const b = document.createElement('div');
    b.id = id;
    b.className = 'tt-label-keepout';
    b.dataset.side = side;
    b.setAttribute('aria-hidden', 'true');
    document.body.append(b);
    return b;
  });
  /** The map's free rect in canvas px (walls inset the map). */
  const free = () =>
    freeRect(safeArea?.(), viewer.canvas.getBoundingClientRect(), {
      w: innerWidth,
      h: innerHeight,
    });
  let bandKey = '';
  function placeBands() {
    const f = free();
    const box = viewer.canvas.getBoundingClientRect();
    const key = f
      ? [
          f.left,
          f.right,
          f.top,
          f.bottom,
          box.left,
          box.top,
          box.width,
          box.height,
        ]
          .map(Math.round)
          .join('|')
      : '';
    if (key === bandKey) return;
    bandKey = key;
    for (const b of bands) b.hidden = !f;
    if (!f) return;
    const at = {
      left: [box.left, box.top, f.left, box.height],
      right: [box.left + f.right, box.top, box.width - f.right, box.height],
      top: [box.left, box.top, box.width, f.top],
      bottom: [box.left, box.top + f.bottom, box.width, box.height - f.bottom],
    };
    for (const b of bands) {
      const [x, y, w, h] = at[b.dataset.side];
      Object.assign(b.style, {
        left: `${x}px`,
        top: `${y}px`,
        width: `${Math.max(0, w)}px`,
        height: `${Math.max(0, h)}px`,
      });
      b.hidden = w <= 0 || h <= 0;
    }
  }

  // The top lane, after every plate: safety glyphs a plate covers, the floor
  // instrument (ruler fixed, reported floor last, initials side-step only),
  // then edge tags for protected words under a panel.
  function paintTop(frame) {
    const ctx = frame.ctx;
    uiRects = frame.uiRectCount;
    rects = [];
    floorHits = [];
    const f = free();
    const vis = visible();
    const tags = [];
    for (const r of vis)
      for (const ent of r.entries) {
        const pr = getOverlayPaintRect(SOURCE, ent.id);
        if (!pr) continue;
        rects.push({
          x: pr.x,
          y: pr.y,
          w: pr.w,
          h: pr.h,
          priority: ent.priority,
          keep: ent.protected || ent.metadata.kind === 'edit',
        });
      }
    for (const ent of pub) {
      if (!ent.protected) continue;
      const pr = getOverlayPaintRect(SOURCE, ent.id);
      const side = pr && hiddenSide(pr, f);
      if (side)
        tags.push({
          title: ent.title,
          state: ent.metadata.state,
          also: ent.metadata.tagAlso || [],
          accent: ent.accent,
          e: ent.metadata.entity,
          side,
          plate: pr,
        });
    }
    // Clear first, paint after (round 2): a tagged plate's hidden remains,
    // an ordinary plate sliced by a panel, an ordinary plate under a tag.
    const laid = layoutTags(ctx, tags, f);
    for (const t of laid)
      ctx.clearRect(t.plate.x, t.plate.y, t.plate.w, t.plate.h);
    const overTag = (q) =>
      laid.some(
        (t) =>
          q.x < t.x + t.w &&
          t.x < q.x + q.w &&
          q.y < t.y + t.h &&
          t.y < q.y + q.h,
      );
    const overKept = (q) =>
      rects.some(
        (k) =>
          k.keep &&
          q.x < k.x + k.w &&
          k.x < q.x + q.w &&
          q.y < k.y + k.h &&
          k.y < q.y + q.h,
      );
    rects = rects.filter((q) => {
      if (q.keep || (hiddenShare(q, f) < 0.15 && !overTag(q))) return true;
      // Never clear over a protected plate's words (UX R3).
      if (overKept(q)) return true;
      ctx.clearRect(q.x, q.y, q.w, q.h);
      return false;
    });
    paintGlyphs(ctx, vis);
    paintFloors(ctx, vis, f, tags);
    paintTags(ctx, laid);
  }

  /** A marker's screen box (canvas px) and image, or null off screen. */
  function markBox(e, t, cam) {
    const bb = e.billboard;
    const img = bb.image?.getValue?.(t);
    if (!img || typeof img === 'string' || !img.width) return null;
    const pos = e.position?.getValue?.(t);
    if (!pos) return null;
    const ddc = bb.distanceDisplayCondition?.getValue?.(t);
    const dist = Cesium.Cartesian3.distance(cam, pos);
    if (ddc && (dist < ddc.near || dist > ddc.far)) return null;
    const win = Cesium.SceneTransforms.worldToWindowCoordinates(scene, pos);
    if (!win) return null;
    const s = bb.scale?.getValue?.(t) ?? 1;
    const w = img.width * s;
    const h = img.height * s;
    const bottom =
      bb.verticalOrigin?.getValue?.(t) === Cesium.VerticalOrigin.BOTTOM;
    return {
      img,
      x: win.x - w / 2,
      y: bottom ? win.y - h : win.y - h / 2,
      w,
      h,
      alpha: bb.color?.getValue?.(t)?.alpha ?? 1,
    };
  }

  // Markers are soft keep-out areas too, so plates are placed off them:
  // stand-ins with a class upstream's exclusion list matches (many
  // elements allowed), moved only when the camera is still (round 1).
  const marks = [];
  let moving = false;
  function placeMarks() {
    if (moving) return;
    const box = viewer.canvas.getBoundingClientRect();
    const t = now();
    const cam = scene.camera.positionWC;
    const out = [];
    for (const r of visible())
      for (const e of r.tops) {
        const m = markBox(e, t, cam);
        if (!m || m.x + m.w < 0 || m.y + m.h < 0) continue;
        if (m.x > box.width || m.y > box.height) continue;
        out.push(m);
      }
    while (marks.length < out.length) {
      const d = document.createElement('div');
      d.className = 'ops-legend tt-mark-keepout';
      d.setAttribute('aria-hidden', 'true');
      document.body.append(d);
      marks.push(d);
    }
    marks.forEach((d, i) => {
      const m = out[i];
      const key = m
        ? [box.left + m.x, box.top + m.y, m.w, m.h].map(Math.round).join(',')
        : '';
      if (d.dataset.at === key) return;
      d.dataset.at = key;
      // Parked off screen, never hidden: upstream's observer keeps seeing
      // it when it comes back (AIA R2).
      const [x, y, w, h] = m ? key.split(',') : [-9999, -9999, 1, 1];
      Object.assign(d.style, {
        left: `${x}px`,
        top: `${y}px`,
        width: `${w}px`,
        height: `${h}px`,
      });
    });
  }
  offs.push(
    scene.camera.moveStart.addEventListener(() => {
      moving = true;
    }),
    scene.camera.moveEnd.addEventListener(() => {
      moving = false;
      placeMarks();
      screenMerge();
    }),
  );

  /** A marker a plate still covers is drawn over it (markers over words). */
  function paintGlyphs(ctx, vis) {
    const t = now();
    const cam = scene.camera.positionWC;
    for (const r of vis)
      for (const e of r.tops) {
        const m = markBox(e, t, cam);
        if (!m) continue;
        const { img, x, y, w, h } = m;
        // Over ordinary words only: a protected plate's words (a rally,
        // SIMULATED) stay readable where a tight cluster leaves no room.
        const covered = rects.some(
          (q) =>
            !q.keep &&
            x < q.x + q.w &&
            q.x < x + w &&
            y < q.y + q.h &&
            q.y < y + h,
        );
        if (!covered) continue;
        ctx.globalAlpha = m.alpha;
        ctx.drawImage(img, x, y, w, h);
        ctx.globalAlpha = 1;
      }
  }

  function paintFloors(ctx, vis, f, tags) {
    const cam = scene.camera.positionWC;
    const t = now();
    // Floor words grow with the wall, as the plates do (round 1).
    const k = current / PAGE_LABEL_SCALE;
    const fixed = [];
    const moving = [];
    const drawn = new Map();
    for (const r of vis)
      for (const e of r.texts) {
        const mt = e.mapText;
        if (mt.show === false) continue;
        const pos = e.position?.getValue?.(t);
        if (!pos) continue;
        const dist = Cesium.Cartesian3.distance(cam, pos);
        if (dist < (mt.near ?? 0) || dist > (mt.far ?? Infinity)) continue;
        const win = Cesium.SceneTransforms.worldToWindowCoordinates(scene, pos);
        if (!win) continue;
        const text = typeof mt.text === 'function' ? mt.text() : mt.text;
        const font = pxScale(mt.font, k);
        ctx.font = font;
        const px = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] || 11);
        const p0 = mt.padding || FLOOR_PAD;
        const pad = { x: p0.x * k, y: p0.y * k };
        const w = Math.ceil(ctx.measureText(text).width) + pad.x * 2;
        const h = Math.round(px * 1.3) + pad.y * 2;
        const ax = win.x + (mt.offset?.x || 0) * k;
        const ay = win.y + (mt.offset?.y || 0) * k;
        const x =
          mt.align === 'left' ? ax : mt.align === 'right' ? ax - w : ax - w / 2;
        const y =
          mt.baseline === 'bottom'
            ? ay - h
            : mt.baseline === 'top'
              ? ay
              : ay - h / 2;
        const id = `${r.n}:${e.id}`;
        const it = {
          id,
          x,
          y,
          w,
          h,
          fixed: Boolean(mt.fixed),
          axis: mt.axis || 'y',
          priority: mt.priority ?? 5,
          rank: mt.rank || 0,
        };
        (it.fixed ? fixed : moving).push(it);
        drawn.set(id, { e, mt, text, pad, font });
      }
    if (!fixed.length && !moving.length) return;
    const ruler = rulerOrder(fixed);
    // Initials yield to the ruler, protected plates and the panels only; a
    // street name never pushes one away (UX/AIA P0).
    if (f)
      for (const it of moving) {
        if (it.x < f.left) it.x = f.left;
        else if (it.x + it.w > f.right) it.x = f.right - it.w;
      }
    const obstacles = [
      ...rects
        .filter((q) => q.keep)
        .map((q, i) => ({ ...q, id: `#plate${i}`, fixed: true })),
      ...(f
        ? [
            {
              id: '#bandL',
              x: -1e4,
              y: -1e4,
              w: 1e4 + f.left,
              h: 2e4,
              fixed: true,
            },
            { id: '#bandR', x: f.right, y: -1e4, w: 1e4, h: 2e4, fixed: true },
          ]
        : []),
    ];
    const shifts = declutter([...obstacles, ...ruler, ...moving]);
    const paint = (it, dx, dy) => {
      const { e, mt, text, pad, font } = drawn.get(it.id);
      const x = it.x + dx;
      const y = it.y + dy;
      ctx.fillStyle = mt.background || 'rgba(4,12,18,0.92)';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, it.w, it.h, 2);
      else ctx.rect(x, y, it.w, it.h);
      ctx.fill();
      ctx.fillStyle = mt.color || '#eef5f3';
      ctx.font = font;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillText(text, x + pad.x, y + it.h / 2 + 0.5);
      floorHits.push({ x, y, w: it.w, h: it.h, e });
    };
    // An initial with no clear slot still paints in place: it overprints
    // rather than vanish (AIA Q, UX P0-2).
    for (const it of moving) {
      const sh = shifts.get(it.id);
      paint(it, sh?.dx ?? 0, sh?.dy ?? 0);
    }
    // The ruler last, the reported floor last of all.
    for (const it of ruler) paint(it, 0, 0);
  }

  /** Where each edge tag goes (stacked, inside the free rect). */
  function layoutTags(ctx, tags, f) {
    if (!tags.length || !f) return [];
    const s = current;
    ctx.font = `600 ${(12 * s).toFixed(1)}px Inter, ui-sans-serif, sans-serif`;
    const h = Math.round(22 * s);
    return stackTags(
      tags.map((t) => {
        const words = `${t.title}${t.state ? ` · ${t.state}` : ''}${t.also.map((a) => ` + ${a}`).join('')}`;
        const text =
          t.side === 'right'
            ? `${words} ${ARROW.right}`
            : `${ARROW[t.side]} ${words}`;
        const w = Math.ceil(ctx.measureText(text).width) + 16 * s;
        const p = t.plate;
        const clampY = (y) => Math.max(f.top, Math.min(y, f.bottom - h));
        const clampX = (x) => Math.max(f.left, Math.min(x, f.right - w));
        const at = {
          left: { x: f.left, y: clampY(p.y) },
          right: { x: f.right - w, y: clampY(p.y) },
          top: { x: clampX(p.x), y: f.top },
          bottom: { x: clampX(p.x), y: f.bottom - h },
        }[t.side];
        return { ...t, text, w, h, ...at };
      }),
      3,
      f,
    );
  }
  function paintTags(ctx, laid) {
    tagsPainted = 0;
    const s = current;
    ctx.font = `600 ${(12 * s).toFixed(1)}px Inter, ui-sans-serif, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    for (const t of laid) {
      ctx.fillStyle = 'rgba(4,12,16,0.92)';
      ctx.fillRect(t.x, t.y, t.w, t.h);
      ctx.fillStyle = t.accent;
      ctx.fillRect(t.x, t.y, 2, t.h);
      ctx.fillStyle = '#e8f0f4';
      ctx.fillText(t.text, t.x + 8 * s, t.y + t.h / 2 + 0.5);
      rects.push({ x: t.x, y: t.y, w: t.w, h: t.h, priority: 100, keep: true });
      floorHits.push({ x: t.x, y: t.y, w: t.w, h: t.h, e: t.e });
      tagsPainted += 1;
    }
  }
  const lane = registerWorldOverlayPaintLane('tracked', paintTop, {
    id: 'tt-floors',
    active: true,
  });
  // When Inter arrives under the overlay's name, plates are measured again.
  aliasOverlayFont()
    .then(() => {
      for (const r of recs.values()) r.sig = null;
      for (const ds of recs.keys()) sync(ds);
      scene.requestRender();
    })
    .catch(() => {});

  return {
    /** The entity whose words are at this canvas point, or null. */
    pick(x, y) {
      for (let i = floorHits.length - 1; i >= 0; i -= 1) {
        const h = floorHits[i];
        if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h)
          return h.e;
      }
      return (
        hitTestWorldOverlay(x, y, { collisionGroup: TT_LABEL_GROUP })?.entry
          ?.metadata?.entity || null
      );
    },
    /** This frame's important plates, for the storm's Cesium labels. */
    paintRects: () => rects.filter((q) => q.priority >= 60),
    /** Draw the overlay over a capture of the map (wall thumbnails). */
    composite(ctx2, w, h) {
      const c = document.getElementById('world-overlay-canvas');
      if (c?.width) ctx2.drawImage(c, 0, 0, w, h);
    },
    /** The page's 500 ms beat: live text, entity shows, panel bands. */
    beat() {
      const next = o.scale?.() || 1;
      if (next !== current) {
        current = next;
        scene.requestRender();
      }
      for (const ds of recs.keys()) sync(ds);
      placeBands();
      placeMarks();
      screenMerge();
    },
    /** The page's covered margins, in viewport px. */
    setSafeArea(fn) {
      safeArea = fn || null;
      bandKey = '';
    },
    /** Counts for the smoke test. */
    diagnostics() {
      const vis = visible();
      let protectedShown = 0;
      for (const r of vis) protectedShown += r.guard.size;
      return {
        sources: recs.size,
        labels: vis.reduce((a, r) => a + r.entries.length, 0),
        protectedShown,
        texts: vis.reduce((a, r) => a + r.texts.length, 0),
        floorPainted: floorHits.length - tagsPainted,
        painted: rects.length - tagsPainted,
        tags: tagsPainted,
        scale: current,
        uiRects,
        bands: bands.filter((b) => !b.hidden).length,
      };
    },
    dispose() {
      for (const r of recs.values()) r.off();
      recs.clear();
      for (const f of offs) f();
      lane.unregister();
      for (const b of bands) b.remove();
      for (const d of marks) d.remove();
      destroyWorldOverlay();
    },
  };
}
