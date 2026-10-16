// Path editor (phase 4 Part B; review/phase4 fixes). Operator action only:
// the camera never moves by itself; every reroute follows a click. Typing in
// a field is never taken over by shortcuts; nothing is discarded or saved
// without a deliberate step.
import { formatDistance } from './twinData.js';
import {
  AVOID_RADII,
  AVOID_REASONS,
  areaLabel,
  defaultName,
  insertWaypoint,
  newId,
  pathChecks,
  requestPath,
  savedPathRecord,
  timeText,
} from './twinCustomPaths.js';

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const btn = (cls, text, onClick, key, title = '') => {
  const b = el('button', cls, text);
  b.type = 'button';
  if (key) b.dataset.focusKey = key;
  if (title) b.title = title;
  b.addEventListener('click', onClick);
  return b;
};
const fmt = (p) => `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`;
const inField = (t) => Boolean(t?.closest?.('input, select, textarea'));
// View keys keep working while editing; keys that change selection or mode
// are quiet until the path is saved or discarded.
const VIEW_KEYS = new Set([
  '1',
  '2',
  '3',
  ',',
  '.',
  'n',
  'N',
  'f',
  'F',
  'z',
  'Z',
  'l',
  'L',
  'd',
  'D',
  '?',
  'g',
  'G',
  'e',
  'E',
  'Tab',
  ' ',
  // Needs-attention keys keep working in Live (review/phase4 H7).
  'a',
  'A',
  '[',
  ']',
]);
const BLOCKING = new Set(['avoid', 'avoid_endpoint', 'reach']);

/**
 * deps = { twin, layer(), panel, banner, store, persist(), hazards(),
 *   days: () => [{day, label}], siteKeysFor(points), stamp(), isDark(day),
 *   onCrumb(text), onClose(saved) }.
 */
export function createPathEditor(deps) {
  let edit = null;
  let result = null;
  let flags = [];
  let status = 'idle';
  let error = '';
  let arming = null; // null | 'area' | {center}
  let areaDraft = { radius: '100', reason: 'construction', note: '' };
  let addedAreaIds = [];
  let dirty = false;
  let confirmDiscard = false;
  let confirmSave = false;
  let removeConfirm = null;
  let notice = '';
  let abort = null;
  let timer = null;

  const areasInUse = () => deps.store.areas;

  function draw() {
    const layer = deps.layer();
    if (!layer || !edit) return;
    layer.drawEdit({
      points: edit.points,
      geometry: result?.geometry || edit.points,
      fromLabel: edit.fromLabel,
      toLabel: edit.toLabel,
      areas: areasInUse(),
    });
    layer.drawAreas(areasInUse(), { show: true });
  }

  function changed() {
    dirty = true;
    confirmSave = false;
    confirmDiscard = false;
  }

  function reroute() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      abort?.abort();
      abort = new AbortController();
      const signal = abort.signal;
      status = 'loading';
      render();
      try {
        result = await requestPath(
          { points: edit.points, profile: edit.profile, areas: areasInUse() },
          { signal },
        );
        if (signal.aborted) return;
        flags = pathChecks(result, {
          points: edit.points,
          areas: areasInUse(),
          hazards: deps.hazards(),
          dark: deps.isDark(edit.day),
          day: edit.day,
          hazardsStatus: deps.hazardsStatus?.(),
          profile: edit.profile,
        });
        status = 'ready';
      } catch (e) {
        if (signal.aborted) return;
        status = 'error';
        error = String(e?.message || e);
        result = null;
        flags = [];
      }
      draw();
      // Typing in a field: update only the result and Save (keep the caret).
      const active = document.activeElement;
      if (
        deps.panel.contains(active) &&
        active.matches('input[type=text], textarea')
      ) {
        setBanner();
        deps.panel.querySelector('.tt-edit-result')?.replaceWith(buildResult());
        const save = deps.panel.querySelector('[data-focus-key="save"]');
        if (save) save.disabled = !result || edit.fromPerson;
        return;
      }
      render();
    }, 250);
  }

  function setBanner() {
    const b = deps.banner;
    b.hidden = !edit;
    if (!edit) return;
    b.classList.toggle('warn', confirmDiscard || Boolean(notice));
    b.textContent = notice
      ? notice
      : confirmDiscard
        ? `DISCARD THIS PATH${addedAreaIds.length ? ` AND THE ${addedAreaIds.length} AVOID-AREA${addedAreaIds.length > 1 ? 'S' : ''} YOU ADDED` : ''}? Esc again to discard · click anywhere to keep editing`
        : arming === 'area'
          ? 'PLACING AVOID-AREA · click the map for its centre · Esc stops placing'
          : arming
            ? 'AVOID-AREA · choose its size and reason in the panel'
            : 'EDITING PATH · click map: add waypoint · click a number: remove · X: avoid-area · Esc: discard';
  }

  /** Re-render keeping focus, caret and scroll (review/phase4). */
  function render() {
    setBanner();
    const p = deps.panel;
    p.hidden = !edit;
    if (!edit) return;
    const active = document.activeElement;
    const focusKey = p.contains(active) ? active.dataset.focusKey : null;
    const caret =
      active && 'selectionStart' in active ? active.selectionStart : null;
    const scroll = p.scrollTop;
    p.replaceChildren(...build());
    p.scrollTop = scroll;
    if (focusKey) {
      const n = p.querySelector(`[data-focus-key="${focusKey}"]`);
      n?.focus();
      if (n && caret != null && 'setSelectionRange' in n)
        try {
          n.setSelectionRange(caret, caret);
        } catch {
          /* number inputs */
        }
    }
  }

  /** The result block (rebuilt alone while the operator types). */
  function buildResult() {
    const res = el('div', 'tt-edit-result');
    res.setAttribute('aria-live', 'polite');
    if (status === 'loading')
      res.append(
        el(
          'div',
          'tt-note',
          result ? 'Asking the router again…' : 'Asking the router…',
        ),
      );
    if (status === 'error')
      res.append(
        el(
          'div',
          'tt-edit-flag',
          `No path from the router (${error}). Remove the last waypoint, or try again.`,
        ),
        btn('tt-link', 'Try again', () => reroute(), 'retry'),
      );
    if (result && status !== 'error') {
      res.append(
        el(
          'div',
          'tt-edit-sum',
          `${formatDistance(result.distanceM)} · ${timeText(result, edit.profile)}`,
        ),
        el(
          'div',
          'tt-dim tt-edit-engine',
          result.engine === 'valhalla'
            ? `Suggested by Valhalla (FOSSGIS) · unverified${areasInUse().length ? ' · routed around the avoid-areas it could' : ''}`
            : `Suggested by OSRM (fallback) · unverified · avoid-areas checked, not applied${result.fallbackReason ? ` — ${result.fallbackReason}` : ''}`,
        ),
      );
      for (const f of flags)
        res.append(el('div', f.warn ? 'tt-edit-flag' : 'tt-edit-info', f.text));
      if (!flags.length)
        res.append(
          el(
            'div',
            'tt-dim',
            'No checks raised (not a verification of the path)',
          ),
        );
      res.append(
        btn(
          'tt-link',
          'Frame path',
          () => deps.twin.frameGeometry(result.geometry),
          'frame',
        ),
      );
    }
    return res;
  }

  function build() {
    const head = el(
      'div',
      'tt-kicker',
      edit.savedId
        ? 'SAVED PATH · EDITING · saving clears its review'
        : 'NEW PATH · NOT SAVED',
    );
    const name = el('input', 'tt-edit-name');
    name.type = 'text';
    name.value = edit.name;
    name.dataset.focusKey = 'name';
    name.setAttribute('aria-label', 'Path name');
    name.addEventListener('input', () => {
      edit.name = name.value;
      dirty = true;
    });
    const ends = el(
      'div',
      'tt-card-line',
      `From ${edit.fromLabel} → to ${edit.toLabel}`,
    );
    const mode = el('div', 'tt-route-seg mode');
    for (const [k, t] of [
      ['foot', 'Walk'],
      ['car', 'Drive'],
    ]) {
      const b = btn(
        `tt-tb${edit.profile === k ? ' on' : ''}`,
        t,
        () => {
          if (edit.profile === k) return;
          edit.profile = k;
          changed();
          reroute();
          render();
        },
        `mode:${k}`,
      );
      b.setAttribute('aria-pressed', String(edit.profile === k));
      mode.append(b);
    }
    const res = buildResult();
    // Waypoints.
    const wps = el('section', 'tt-edit-sec');
    wps.append(
      el('div', 'tt-kicker', `WAYPOINTS · ${edit.points.length - 2} of 10`),
    );
    if (edit.points.length === 2)
      wps.append(
        el(
          'div',
          'tt-note',
          'Click the map to add one; the router is asked again after each change.',
        ),
      );
    const ul = el('ol', 'tt-edit-list');
    edit.points.slice(1, -1).forEach((wp, j) => {
      const i = j + 1;
      const li = el('li');
      li.append(el('span', 'num', `${i} · ${fmt(wp)}`));
      const move = (d) => {
        const k = i + d;
        if (k < 1 || k > edit.points.length - 2) return;
        const pts = [...edit.points];
        [pts[i], pts[k]] = [pts[k], pts[i]];
        edit.points = pts;
        changed();
        reroute();
        draw();
        render();
      };
      li.append(
        btn('tt-x', '↑', () => move(-1), `up:${i}`, `Waypoint ${i} earlier`),
        btn('tt-x', '↓', () => move(1), `down:${i}`, `Waypoint ${i} later`),
        btn(
          'tt-x',
          '×',
          () => removeWaypoint(i),
          `rm:${i}`,
          `Remove waypoint ${i}`,
        ),
      );
      ul.append(li);
    });
    wps.append(ul);
    // Avoid-areas (trip-wide).
    const av = el('section', 'tt-edit-sec');
    av.append(
      el(
        'div',
        'tt-kicker',
        `AVOID-AREAS ON THIS TRIP · ${areasInUse().length}`,
      ),
    );
    const al = el('ul', 'tt-edit-list');
    for (const a of areasInUse()) {
      const li = el('li');
      const confirm = removeConfirm === a.id;
      li.append(
        el('span', '', areaLabel(a)),
        btn(
          confirm ? 'tt-link danger' : 'tt-x',
          confirm ? 'Remove from the whole trip?' : '×',
          () => {
            if (confirm) removeArea(a.id);
            else {
              removeConfirm = a.id;
              render();
            }
          },
          `area:${a.id}`,
          'Remove avoid-area (whole trip)',
        ),
      );
      al.append(li);
    }
    av.append(al);
    if (arming && arming !== 'area') av.append(areaForm(arming.center));
    else
      av.append(
        btn(
          'tt-btn',
          arming === 'area'
            ? 'Click the map for the centre…'
            : 'Add avoid-area (X)',
          () => {
            arming = arming === 'area' ? null : 'area';
            render();
          },
          'arm',
        ),
      );
    // Day + notes.
    const day = el('label', 'tt-row', 'Day');
    const sel = el('select');
    sel.dataset.focusKey = 'day';
    sel.append(new Option('Any day', ''));
    for (const d of deps.days()) sel.append(new Option(d.label, String(d.day)));
    sel.value = edit.day == null ? '' : String(edit.day);
    sel.addEventListener('change', () => {
      edit.day = sel.value ? Number(sel.value) : null;
      changed();
      if (result) reroute();
    });
    day.append(sel);
    const notes = el('textarea', 'tt-adv-notes');
    notes.dataset.focusKey = 'notes';
    notes.placeholder = 'Notes (why this path, what was checked)';
    notes.value = edit.notes;
    notes.addEventListener('input', () => {
      edit.notes = notes.value;
      dirty = true;
    });
    const blocking = flags.filter((f) => BLOCKING.has(f.key));
    const acts = el('div', 'tt-actions');
    const save = btn(
      `tt-btn ${confirmSave ? 'danger' : 'primary'}`,
      confirmSave
        ? `Save anyway — ${blocking.map((f) => (f.key === 'reach' ? 'does not reach' : 'enters an avoid-area')).join(', ')}`
        : 'Save path',
      () => saveEdit(),
      'save',
    );
    // A path from a traveler's position is live-only: never stored (H4).
    save.disabled = !result || status === 'loading' || edit.fromPerson;
    acts.append(
      save,
      btn('tt-btn', 'Discard', () => discard(), 'discard'),
    );
    return [
      head,
      name,
      ends,
      mode,
      res,
      wps,
      av,
      day,
      notes,
      acts,
      ...(edit.fromPerson
        ? [
            el(
              'div',
              'tt-edit-info',
              'Starts at a traveler’s position: shown live only, not saved. Plan from a site or a place to save a path.',
            ),
          ]
        : []),
      el(
        'div',
        'tt-note',
        'Kept in this browser for this trip (prototype). A saved path stays a suggestion until someone reviews it; a review is a check, not an approval.',
      ),
    ];
  }

  function areaForm(center) {
    const f = el('div', 'tt-edit-area');
    const r = el('select');
    r.dataset.focusKey = 'area-r';
    for (const m of AVOID_RADII) r.append(new Option(`${m} m`, String(m)));
    r.value = areaDraft.radius;
    r.addEventListener('change', () => {
      areaDraft.radius = r.value;
      previewArea(center);
    });
    const why = el('select');
    why.dataset.focusKey = 'area-why';
    for (const [k, t] of AVOID_REASONS) why.append(new Option(t, k));
    why.value = areaDraft.reason;
    why.addEventListener('change', () => (areaDraft.reason = why.value));
    const note = el('input');
    note.type = 'text';
    note.dataset.focusKey = 'area-note';
    note.placeholder = 'Note (needed for Other)';
    note.value = areaDraft.note;
    note.addEventListener('input', () => (areaDraft.note = note.value));
    const lr = el('label', 'tt-row', 'Size');
    lr.append(r);
    const lw = el('label', 'tt-row', 'Reason');
    lw.append(why);
    f.append(
      el('div', 'tt-dim', `Centre ${fmt(center)}`),
      lr,
      lw,
      note,
      btn(
        'tt-btn primary',
        'Add avoid-area',
        () => {
          if (areaDraft.reason === 'other' && !areaDraft.note.trim()) {
            note.focus();
            note.placeholder = 'Say what to avoid (needed for Other)';
            return;
          }
          const id = newId('area');
          deps.store.areas.push({
            id,
            center,
            radiusM: Number(areaDraft.radius),
            reason: areaDraft.reason,
            note: areaDraft.note.trim(),
            addedBy: deps.stamp(),
          });
          addedAreaIds.push(id);
          deps.persist();
          areaDraft = { ...areaDraft, note: '' };
          arming = null;
          changed();
          reroute();
          draw();
          render();
        },
        'area-add',
      ),
      btn(
        'tt-link',
        'Cancel',
        () => {
          arming = null;
          draw();
          render();
        },
        'area-cancel',
      ),
    );
    return f;
  }

  /** Show the area being sized before it is added. */
  function previewArea(center) {
    deps.layer()?.drawAreas(
      [
        ...areasInUse(),
        {
          id: 'preview',
          center,
          radiusM: Number(areaDraft.radius),
          reason: areaDraft.reason,
          note: 'not added yet',
        },
      ],
      { show: true },
    );
  }

  function removeWaypoint(i) {
    edit.points = edit.points.filter((_, k) => k !== i);
    changed();
    reroute();
    draw();
    render();
  }
  function removeArea(id) {
    deps.store.areas = deps.store.areas.filter((a) => a.id !== id);
    addedAreaIds = addedAreaIds.filter((x) => x !== id);
    removeConfirm = null;
    deps.persist();
    changed();
    reroute();
    draw();
    render();
  }

  function onPick({ entityId, ground }) {
    if (confirmDiscard || notice) {
      confirmDiscard = false;
      notice = '';
      render();
      return;
    }
    const wp = /^twin-wp:(\d+)$/.exec(entityId || '');
    if (wp && !arming) return removeWaypoint(Number(wp[1]));
    if (!ground) return;
    if (arming === 'area') {
      arming = { center: ground };
      previewArea(ground);
      render();
      setTimeout(
        () => deps.panel.querySelector('[data-focus-key="area-r"]')?.focus(),
        0,
      );
      return;
    }
    if (arming) return;
    if (edit.points.length >= 12) {
      notice = 'At most 10 waypoints — remove one first';
      render();
      return;
    }
    edit.points = insertWaypoint(edit.points, ground);
    changed();
    reroute();
    draw();
    render();
  }

  function saveEdit() {
    if (!result || status === 'loading' || edit.fromPerson) return;
    const blocking = flags.filter((f) => BLOCKING.has(f.key));
    if (blocking.length && !confirmSave) {
      confirmSave = true;
      render();
      return;
    }
    const rec = savedPathRecord(
      {
        ...edit,
        name: edit.name.trim() || defaultName(edit),
        areas: areasInUse(),
      },
      result,
      { stamp: deps.stamp(), siteKeys: deps.siteKeysFor(edit.points) },
    );
    const i = deps.store.paths.findIndex((p) => p.id === rec.id);
    // An edit is a new version: any earlier review no longer applies.
    if (i >= 0) deps.store.paths[i] = { ...rec, reviewedBy: null };
    else deps.store.paths.push(rec);
    addedAreaIds = []; // kept: they belong to the saved plan now
    deps.persist();
    close(rec);
  }

  function discard() {
    // Areas added during this edit go with it (they were part of this plan).
    if (addedAreaIds.length) {
      deps.store.areas = deps.store.areas.filter(
        (a) => !addedAreaIds.includes(a.id),
      );
      deps.persist();
    }
    close();
  }

  function close(saved = null) {
    abort?.abort();
    clearTimeout(timer);
    edit = null;
    result = null;
    flags = [];
    status = 'idle';
    arming = null;
    addedAreaIds = [];
    dirty = false;
    confirmDiscard = false;
    confirmSave = false;
    removeConfirm = null;
    notice = '';
    deps.twin.setPickHandler(null);
    deps.layer()?.clearEdit();
    document.body.classList.remove('tt-editing');
    render();
    deps.onClose(saved);
  }

  return {
    get active() {
      return Boolean(edit);
    },
    get dirty() {
      return Boolean(edit) && dirty;
    },
    /** Tell the operator why an action waits (switch mode/site, exit). */
    blockIfDirty(what) {
      if (!edit || !dirty) {
        if (edit) close();
        return false;
      }
      notice = `Save or discard the path before you ${what} (Esc to discard)`;
      render();
      return true;
    },
    /** start({from, to, fromLabel, toLabel, profile, day, points?, saved?}) */
    start(o) {
      if (edit && dirty) {
        notice = 'Save or discard the path you are editing first';
        render();
        return;
      }
      if (edit) close();
      edit = {
        savedId: o.saved?.id || null,
        name: o.saved?.name || defaultName(o),
        day: o.saved?.day ?? o.day ?? null,
        profile: o.saved?.profile || o.profile || 'foot',
        points: o.saved?.points || o.points || [o.from, o.to],
        fromLabel: o.saved?.fromLabel || o.fromLabel,
        toLabel: o.saved?.toLabel || o.toLabel,
        notes: o.saved?.notes || '',
        fromPerson: Boolean(o.fromPerson),
      };
      dirty = !o.saved?.id; // a duplicate or a new plan is unsaved work
      deps.twin.setPickHandler(onPick);
      document.body.classList.add('tt-editing');
      deps.onCrumb(
        edit.savedId ? `› Saved path: ${edit.name}` : '› New path (not saved)',
      );
      reroute();
      draw();
      render();
    },
    /**
     * Keys while editing. Returns true when handled (caller prevents the
     * default). Typing in a field is never intercepted except Esc (leave it).
     */
    handleKey(e) {
      if (!edit) return false;
      const k = e.key;
      if (inField(e.target)) {
        if (k === 'Escape') {
          e.target.blur();
          return true;
        }
        return false;
      }
      if (k === 'Escape') {
        if (notice) notice = '';
        else if (removeConfirm) removeConfirm = null;
        else if (confirmSave) confirmSave = false;
        else if (arming) {
          arming = null;
          draw();
        } else if (!dirty || confirmDiscard) return (discard(), true);
        else confirmDiscard = true;
        render();
        return true;
      }
      if (confirmDiscard) {
        confirmDiscard = false;
        render();
      }
      if (k === 'x' || k === 'X') {
        arming = arming === 'area' ? null : 'area';
        render();
        return true;
      }
      if (k === 'Enter') {
        // Only from the map / page: a focused button gets its own click.
        if (e.target === document.body || e.target?.tagName === 'CANVAS') {
          saveEdit();
          return true;
        }
        return false;
      }
      if ((k === 'Backspace' || k === 'Delete') && edit.points.length > 2) {
        removeWaypoint(edit.points.length - 2);
        return true;
      }
      if (VIEW_KEYS.has(k)) return false;
      return true; // selection / mode keys wait until the path is closed
    },
    cancel: () => discard(),
  };
}
