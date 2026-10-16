// Screen-space label declutter (phase 2/3 deferred: fire station vs rally
// point, initials vs the floor ruler). Labels keep their place on the map and
// only slide up or down until they no longer overprint a label placed before
// them. Fixed labels (the floor ruler) never move; they are obstacles.
import * as Cesium from 'cesium';

const STEP = 16;
const TRIES = [0, -1, 1, -2, 2, -3, 3, -4];
// Floor-tied labels (axis 'x') keep their height and step sideways, away
// from the ruler, so they never point at the wrong floor (review/phase5b).
const XSTEP = 22;
const XTRIES = [0, 1, 2, 3, 4, 5];

const overlaps = (a, b) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * items: [{id, x, y, w, h, fixed, priority}] as screen boxes at their base
 * offset (x, y = top left; axis 'x' slides sideways only). Fixed items are
 * placed first, then by priority (lower first), then top to bottom. Returns
 * Map id → {dx, dy}, or null when every slot overlaps (hide that label).
 */
export function declutter(items) {
  const order = [...items].sort(
    (a, b) =>
      Number(b.fixed) - Number(a.fixed) ||
      (a.priority ?? 5) - (b.priority ?? 5) ||
      a.y - b.y,
  );
  const placed = [];
  const out = new Map();
  for (const it of order) {
    // null = no free slot: the label is hidden rather than overprinting.
    let shift = it.fixed ? { dx: 0, dy: 0 } : null;
    if (!it.fixed) {
      const tries =
        it.axis === 'x'
          ? XTRIES.map((k) => ({ dx: k * XSTEP, dy: 0 }))
          : TRIES.map((k) => ({ dx: 0, dy: k * STEP }));
      for (const t of tries) {
        const box = { ...it, x: it.x + t.dx, y: it.y + t.dy };
        if (!placed.some((p) => overlaps(box, p))) {
          shift = t;
          break;
        }
      }
    }
    if (shift) placed.push({ ...it, x: it.x + shift.dx, y: it.y + shift.dy });
    out.set(it.id, shift);
  }
  return out;
}

/** Rough label box from its text (Inter / mono at 10–12 px). */
export function labelSize(text, font = '') {
  const px = Number(/(\d+)px/.exec(font)?.[1] || 11);
  const lines = String(text || '').split('\n');
  const longest = Math.max(...lines.map((l) => l.length));
  return {
    w: Math.ceil(longest * px * 0.58) + 10,
    h: lines.length * Math.round(px * 1.35) + 6,
  };
}

/**
 * Wire the declutter to a viewer: every label entity in every data source
 * takes part; entities with `declutterFixed` set are obstacles. Runs when the
 * camera moves and when the label set changes, at most every 120 ms.
 */
export function createDeclutter(viewer, { bounds = null } = {}) {
  const base = new WeakMap(); // entity → its own pixelOffset
  const hidden = new WeakSet(); // labels this declutter hid
  let timer = 0;
  let last = 0;
  const now = () => Cesium.JulianDate.now();
  function run() {
    timer = 0;
    last = performance.now();
    if (viewer.isDestroyed()) return;
    const scene = viewer.scene;
    const cam = scene.camera.positionWC;
    const t = now();
    const items = [];
    const ents = new Map();
    const sources = [];
    for (let i = 0; i < viewer.dataSources.length; i += 1)
      sources.push(viewer.dataSources.get(i));
    sources.push({ entities: viewer.entities, show: true });
    for (const ds of sources) {
      if (ds.show === false) continue;
      for (const e of ds.entities.values) {
        // Map glyphs (declutterGlyph = size in px) are fixed obstacles, so no
        // label covers a place marker.
        if (e.declutterGlyph && e.show !== false) {
          const gp = e.position?.getValue?.(t);
          const gw =
            gp && Cesium.SceneTransforms.worldToWindowCoordinates(scene, gp);
          if (gw) {
            const sz = e.declutterGlyph;
            items.push({
              id: `${e.id}#glyph`,
              x: gw.x - sz / 2,
              y: gw.y - sz / 2,
              w: sz,
              h: sz,
              fixed: true,
            });
          }
        }
        const lb = e.label;
        if (
          !lb ||
          e.show === false ||
          (lb.show?.getValue?.(t) === false && !hidden.has(e))
        )
          continue;
        const pos = e.position?.getValue?.(t);
        if (!pos) continue;
        const ddc = lb.distanceDisplayCondition?.getValue?.(t);
        const dist = Cesium.Cartesian3.distance(cam, pos);
        if (ddc && (dist < ddc.near || dist > ddc.far)) continue;
        const win = Cesium.SceneTransforms.worldToWindowCoordinates(scene, pos);
        if (!win) continue;
        if (!base.has(e))
          base.set(
            e,
            lb.pixelOffset?.getValue?.(t)?.clone?.() ||
              new Cesium.Cartesian2(0, 0),
          );
        const off = base.get(e);
        const text = lb.text?.getValue?.(t);
        const { w, h } = labelSize(text, lb.font?.getValue?.(t));
        const ho = lb.horizontalOrigin?.getValue?.(t);
        const vo = lb.verticalOrigin?.getValue?.(t);
        const ax = win.x + off.x;
        const ay = win.y + off.y;
        const x =
          ho === Cesium.HorizontalOrigin.LEFT
            ? ax
            : ho === Cesium.HorizontalOrigin.RIGHT
              ? ax - w
              : ax - w / 2;
        const y =
          vo === Cesium.VerticalOrigin.BOTTOM
            ? ay - h
            : vo === Cesium.VerticalOrigin.TOP
              ? ay
              : ay - h / 2;
        const id = e.id;
        items.push({
          id,
          x,
          y,
          w,
          h,
          fixed: Boolean(e.declutterFixed),
          axis: e.declutterAxis || 'y',
          priority: e.declutterPriority ?? 5,
        });
        ents.set(id, e);
      }
    }
    // Panels are obstacles: labels slide sideways into the free area first.
    const fb = bounds?.();
    if (fb)
      for (const it of items) {
        if (it.fixed) continue;
        it.dx = 0;
        if (it.x < fb.left) it.dx = fb.left - it.x;
        else if (it.x + it.w > fb.right) it.dx = fb.right - it.w - it.x;
        it.x += it.dx;
      }
    if (fb)
      for (const [x, w] of [
        [-10000, fb.left + 10000],
        [fb.right, 10000],
      ])
        items.push({
          id: `#panel${x}`,
          x,
          y: -10000,
          w,
          h: 20000,
          fixed: true,
        });
    const dxOf = new Map(items.map((it) => [it.id, it.dx || 0]));
    const shifts = declutter(items);
    let changed = false;
    for (const [id, sh] of shifts) {
      const e = ents.get(id);
      if (!e) continue; // glyph and panel obstacles
      const off = base.get(e);
      const hide = sh === null;
      const dy = sh?.dy ?? 0;
      if (hide !== hidden.has(e)) {
        e.label.show = !hide;
        if (hide) hidden.add(e);
        else hidden.delete(e);
        changed = true;
      }
      if (hide) continue;
      const nx = off.x + dxOf.get(id) + sh.dx;
      const cur = e.label.pixelOffset?.getValue?.(t);
      if (!cur || cur.x !== nx || cur.y !== off.y + dy) {
        e.label.pixelOffset = new Cesium.Cartesian2(nx, off.y + dy);
        changed = true;
      }
    }
    if (changed) scene.requestRender();
  }
  const schedule = () => {
    if (timer) return;
    const wait = Math.max(0, 120 - (performance.now() - last));
    timer = setTimeout(run, wait);
  };
  const cam = viewer.scene.camera;
  cam.percentageChanged = Math.min(cam.percentageChanged, 0.05);
  const offCam = cam.changed.addEventListener(schedule);
  const offEnd = cam.moveEnd.addEventListener(schedule);
  const offs = [];
  const watch = (col) =>
    offs.push(col.collectionChanged.addEventListener(schedule));
  watch(viewer.entities);
  for (let i = 0; i < viewer.dataSources.length; i += 1)
    watch(viewer.dataSources.get(i).entities);
  const offAdd = viewer.dataSources.dataSourceAdded.addEventListener(
    (_, ds) => {
      watch(ds.entities);
      schedule();
    },
  );
  schedule();
  return {
    schedule,
    dispose() {
      clearTimeout(timer);
      offCam();
      offEnd();
      offAdd();
      for (const f of offs) f();
    },
  };
}
