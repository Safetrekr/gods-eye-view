// Trip Twin's map words on upstream's world overlay (review/map-labels L5).
// Layers no longer make Cesium labels: an entity carries `mapLabel` (a
// twinMapLabelEntries.js record, solved by upstream's arbiter) or `mapText`
// (the floor instrument, painted last by Trip Twin's own lane so nothing
// covers a floor number or an initial). This bridge watches the data sources
// as the declutter does, publishes one overlay source per data source, and
// follows its `show`. Upstream's files are imported, never edited.
import * as Cesium from 'cesium';
import {
  initWorldOverlay,
  destroyWorldOverlay,
  setOverlayEntries,
  setOverlaySourceVisible,
  clearOverlaySource,
  hitTestWorldOverlay,
  getOverlayPaintRect,
  registerWorldOverlayPaintLane,
} from '../../overlays/worldOverlay.js';
import { WORLD_OVERLAY_STYLE } from '../../overlays/worldOverlayTokens.js';
import {
  TT_LABEL_GROUP,
  labelText,
  overlayFields,
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

/**
 * Start the host on this page. o: {scale() → presentation scale (read on the
 * beat, never per frame), wall() → true on a wall (no pointer input),
 * onActivate(entity)}. Returns {pick, paintRects, composite, beat,
 * setBounds, dispose}.
 */
export function createTwinMapLabels(viewer, o = {}) {
  const scene = viewer.scene;
  let current = o.scale?.() || 1;
  const scale = () => current;
  let bounds = null; // () => {left, right}: x range the panels leave free
  initWorldOverlay(viewer);
  aliasOverlayFont().catch(() => {});
  const sourceOf = new WeakMap(); // data source → {id, sig, shown, texts}
  let n = 0;
  const tracked = new Set();
  const offs = [];
  let floorHits = [];
  let rects = [];

  const recOf = (ds) => {
    let r = sourceOf.get(ds);
    if (!r) {
      r = {
        id: `tt-${(n += 1)}`,
        n,
        sig: '',
        shown: null,
        ids: [],
        texts: [],
        guard: new Map(), // id → {title, accent}: protected words
      };
      sourceOf.set(ds, r);
      tracked.add(ds);
    }
    return r;
  };
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

  /** Publish a data source's labels when what they say has changed. */
  function sync(ds) {
    if (!ds?.entities || !tracked.has(ds)) return;
    const interactive = !o.wall?.();
    const r = recOf(ds);
    const parts = [];
    const live = [];
    const texts = [];
    for (const e of ds.entities.values) {
      if (e.mapText && e.show !== false) texts.push(e);
      if (!e.mapLabel || e.show === false) continue;
      const t = labelText(e.mapLabel);
      const at = e.position?.isConstant ? e.position.getValue(now()) : null;
      parts.push(
        `${e.id}|${t.title}|${t.details.join('/')}|${at ? `${at.x.toFixed(1)},${at.y.toFixed(1)}` : ''}`,
      );
      live.push(e);
    }
    r.texts = texts;
    const sig = parts.join('\n');
    if (sig === r.sig) return;
    r.sig = sig;
    r.ids = live.map((e) => e.id);
    r.guard.clear();
    const entries = [];
    for (const e of live) {
      const position = positionOf(e);
      if (!position) continue;
      const f = overlayFields(e.mapLabel, { scale, interactive });
      if (f.protected) r.guard.set(e.id, { title: f.title, accent: f.accent });
      entries.push({
        id: e.id,
        position,
        ...f,
        accessibilityLabel: f.interactive ? f.title : '',
        activate:
          f.interactive && o.onActivate
            ? () => o.onActivate(e) !== false
            : null,
        metadata: { entity: e },
      });
    }
    if (entries.length) setOverlayEntries(r.id, entries);
    else if (r.had) clearOverlaySource(r.id);
    r.had = entries.length > 0;
    scene.requestRender();
  }
  const pending = new Set();
  let flush = 0;
  const schedule = (ds) => {
    pending.add(ds);
    if (flush) return;
    flush = setTimeout(() => {
      flush = 0;
      for (const d of pending) sync(d);
      pending.clear();
    }, 0);
  };
  const watch = (ds) => {
    recOf(ds);
    offs.push(
      ds.entities.collectionChanged.addEventListener(() => schedule(ds)),
    );
    schedule(ds);
  };
  const defaults = { entities: viewer.entities, show: true, name: 'default' };
  watch(defaults);
  for (let i = 0; i < viewer.dataSources.length; i += 1)
    watch(viewer.dataSources.get(i));
  offs.push(
    viewer.dataSources.dataSourceAdded.addEventListener((_, ds) => watch(ds)),
    viewer.dataSources.dataSourceRemoved.addEventListener((_, ds) => {
      const r = sourceOf.get(ds);
      if (r) clearOverlaySource(r.id);
      tracked.delete(ds);
    }),
  );
  // A layer hides by `ds.show`: the overlay source follows before the frame.
  offs.push(
    scene.preRender.addEventListener(() => {
      for (const ds of tracked) {
        const r = sourceOf.get(ds);
        const on = ds.show !== false;
        if (r.shown === on) continue;
        r.shown = on;
        setOverlaySourceVisible(r.id, on);
      }
    }),
  );

  // Panels: soft keep-out bands, reusing two ids upstream's frozen exclusion
  // list already names (L3 §4). z 7 keeps them soft: a veto (z ≤ 6) could
  // drop a protected rally label.
  const bands = ['left-panel-stack', 'right-context-rail'].map((id) => {
    const b = document.createElement('div');
    b.id = id;
    b.className = 'tt-label-keepout';
    b.setAttribute('aria-hidden', 'true');
    document.body.append(b);
    return b;
  });
  let bandKey = '';
  function placeBands() {
    const a = bounds?.();
    const box = viewer.canvas.getBoundingClientRect();
    const key = a ? `${a.left}|${a.right}|${box.left}|${box.width}` : '';
    if (key === bandKey) return;
    bandKey = key;
    const [l, r] = bands;
    l.hidden = r.hidden = !a;
    if (!a) return;
    l.style.left = `${box.left}px`;
    l.style.width = `${Math.max(0, a.left)}px`;
    r.style.left = `${box.left + a.right}px`;
    r.style.width = `${Math.max(0, box.width - a.right)}px`;
  }

  // The floor instrument (L5 D10): ruler numbers stay put, initials step
  // sideways only, away from the ruler and from this frame's overlay plates.
  let uiRects = 0;
  function paintFloors(frame) {
    const ctx = frame.ctx;
    uiRects = frame.uiRectCount;
    rects = [];
    const a = bounds?.();
    const tags = [];
    for (const ds of tracked) {
      if (ds.show === false) continue;
      const r = sourceOf.get(ds);
      for (const id of r.ids) {
        const pr = getOverlayPaintRect(r.id, id);
        if (!pr) continue;
        rects.push({ x: pr.x, y: pr.y, w: pr.w, h: pr.h });
        // A protected label under a panel is said at the panel's edge
        // (L1 gap 2): it never hides behind the glass.
        const g = r.guard.get(id);
        const cx = pr.x + pr.w / 2;
        if (g && a && (cx < a.left || cx > a.right))
          tags.push({ ...g, y: pr.y, left: cx < a.left });
      }
    }
    floorHits = [];
    paintEdgeTags(ctx, tags, a);
    const cam = scene.camera.positionWC;
    const t = now();
    const items = [];
    const drawn = new Map();
    // A double-buffered layer (people) keeps its old source up until the new
    // one's geometry is ready; its words are ready at once, so only the
    // newest source of a name is read (no doubled, side-stepped initials).
    const newest = new Map();
    for (const ds of tracked) {
      const k = ds.name || sourceOf.get(ds).id;
      const prev = newest.get(k);
      if (!prev || sourceOf.get(ds).n > sourceOf.get(prev).n) newest.set(k, ds);
    }
    for (const ds of tracked) {
      if (ds.show === false) continue;
      if (newest.get(ds.name || sourceOf.get(ds).id) !== ds) continue;
      for (const e of sourceOf.get(ds).texts) {
        const mt = e.mapText;
        if (e.show === false || mt.show === false) continue;
        const pos = e.position?.getValue?.(t);
        if (!pos) continue;
        const dist = Cesium.Cartesian3.distance(cam, pos);
        if (dist < (mt.near ?? 0) || dist > (mt.far ?? Infinity)) continue;
        const win = Cesium.SceneTransforms.worldToWindowCoordinates(scene, pos);
        if (!win) continue;
        const text = typeof mt.text === 'function' ? mt.text() : mt.text;
        ctx.font = mt.font;
        const px = Number(/(\d+(?:\.\d+)?)px/.exec(mt.font)?.[1] || 11);
        const pad = mt.padding || FLOOR_PAD;
        const w = Math.ceil(ctx.measureText(text).width) + pad.x * 2;
        const h = Math.round(px * 1.3) + pad.y * 2;
        const ax = win.x + (mt.offset?.x || 0);
        const ay = win.y + (mt.offset?.y || 0);
        const x =
          mt.align === 'left' ? ax : mt.align === 'right' ? ax - w : ax - w / 2;
        const y =
          mt.baseline === 'bottom'
            ? ay - h
            : mt.baseline === 'top'
              ? ay
              : ay - h / 2;
        items.push({
          id: e.id,
          x,
          y,
          w,
          h,
          fixed: Boolean(mt.fixed),
          axis: mt.axis || 'y',
          priority: mt.priority ?? 5,
        });
        drawn.set(e.id, { e, mt, text, pad });
      }
    }
    if (!items.length) return;
    // Panels and this frame's plates are obstacles.
    if (a)
      for (const it of items) {
        if (it.fixed) continue;
        if (it.x < a.left) it.x = a.left;
        else if (it.x + it.w > a.right) it.x = a.right - it.w;
      }
    const obstacles = rects.map((q, i) => ({
      ...q,
      id: `#plate${i}`,
      fixed: true,
    }));
    const shifts = declutter([...obstacles, ...items]);
    for (const it of items) {
      const sh = shifts.get(it.id);
      if (!sh) continue;
      const { e, mt, text, pad } = drawn.get(it.id);
      const x = it.x + sh.dx;
      const y = it.y + sh.dy;
      ctx.globalAlpha = 1;
      ctx.fillStyle = mt.background || 'rgba(4,12,18,0.92)';
      ctx.beginPath();
      ctx.roundRect?.(x, y, it.w, it.h, 2) ?? ctx.rect(x, y, it.w, it.h);
      ctx.fill();
      ctx.fillStyle = mt.color || '#eef5f3';
      ctx.font = mt.font;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillText(text, x + pad.x, y + it.h / 2 + 0.5);
      floorHits.push({ x, y, w: it.w, h: it.h, e });
    }
  }
  function paintEdgeTags(ctx, tags, a) {
    const s = current;
    ctx.font = `600 ${(12 * s).toFixed(1)}px Inter, ui-sans-serif, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    for (const t of tags) {
      const text = t.left ? `◂ ${t.title}` : `${t.title} ▸`;
      const w = Math.ceil(ctx.measureText(text).width) + 16 * s;
      const h = Math.round(22 * s);
      const x = t.left ? a.left : a.right - w;
      const y = Math.max(4, t.y);
      ctx.fillStyle = 'rgba(4,12,16,0.9)';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = t.accent;
      ctx.fillRect(x, y, 2, h);
      ctx.fillStyle = '#e8f0f4';
      ctx.fillText(text, x + 8 * s, y + h / 2 + 0.5);
      rects.push({ x, y, w, h });
    }
  }
  const lane = registerWorldOverlayPaintLane('tracked', paintFloors, {
    id: 'tt-floors',
    active: true,
  });

  return {
    /** The entity whose label is at this canvas point, or null. */
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
    /** Last frame's painted plates (for the Cesium labels left: the storm). */
    paintRects: () => rects,
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
      for (const ds of tracked) sync(ds);
      placeBands();
    },
    setBounds(fn) {
      bounds = fn || null;
      bandKey = '';
    },
    /** Counts for the smoke test. */
    diagnostics() {
      let labels = 0;
      let texts = 0;
      for (const ds of tracked) {
        const r = sourceOf.get(ds);
        labels += r.ids.length;
        texts += r.texts.length;
      }
      return {
        labels,
        texts,
        floorPainted: floorHits.length,
        painted: rects.length,
        scale: current,
        uiRects,
        bands: bands.map((b) =>
          b.hidden ? null : b.getBoundingClientRect().width,
        ),
      };
    },
    dispose() {
      clearTimeout(flush);
      for (const f of offs) f();
      lane.unregister();
      for (const b of bands) b.remove();
      destroyWorldOverlay();
    },
  };
}
