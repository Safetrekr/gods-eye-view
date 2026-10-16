// Floor numbering prompt (phase 3 Part E, Jesse). When a building's floor
// numbering is not mapped, the operator can say how it numbers its floors.
// The answer is an operator entry, not verified, used only for this trip.
// Phone estimates already carry levels above the lobby, so nothing is
// recomputed: labels are level + ground-floor label.

/**
 * entry = { groundLabel: 0 | 1, topFloor: number | null, at: ISO }.
 * The operator gives the top floor number as on the lift buttons; the floor
 * count is derived (topFloor − ground + 1), so "9" means floors 0–9 or 1–9.
 */
export function validEntry(e) {
  return (
    e &&
    (e.groundLabel === 0 || e.groundLabel === 1) &&
    (e.topFloor === null ||
      e.topFloor === undefined ||
      (Number.isInteger(e.topFloor) &&
        e.topFloor >= e.groundLabel &&
        e.topFloor <= 200))
  );
}

export const levelsOf = (e) =>
  Number.isInteger(e?.topFloor) ? e.topFloor - e.groundLabel + 1 : null;

/**
 * Returns a copy of the snapshot with operator numbering applied to the
 * places that have an entry (bySiteKey: {site_key → entry}). Estimates for
 * those places get labels; mapped places are never overridden.
 */
export function applyOperatorNumbering(snapshot, bySiteKey = {}) {
  const placeEntry = new Map();
  const places = (snapshot.places || []).map((p) => {
    const e = bySiteKey[p.site_key];
    if (!validEntry(e) || p.levels_source === 'osm_levels') return p;
    if (p.levels_above_ground != null && p.levels_source !== 'operator')
      return p;
    placeEntry.set(p.id, e);
    return {
      ...p,
      ground_floor_label: e.groundLabel,
      levels_above_ground: levelsOf(e),
      levels_source: 'operator',
      numbering_entered_at: e.at || null,
    };
  });
  if (!placeEntry.size) return snapshot;
  const participants = snapshot.participants.map((person) => {
    const est = person.floor_estimate;
    const e = est && placeEntry.get(est.place_id);
    if (!e || est.status !== 'estimated') return person;
    const label = (l) => l + e.groundLabel;
    return {
      ...person,
      floor_estimate: {
        ...est,
        ground_floor_label: e.groundLabel,
        label_likely: label(est.level_likely),
        label_low: label(est.level_low),
        label_high: label(est.level_high),
        levels_basis: 'operator',
      },
    };
  });
  return { ...snapshot, places, participants };
}

/** Card line once answered. */
export function numberingNote(e) {
  if (!validEntry(e)) return '';
  return `Floor numbering: ground floor = ${e.groundLabel}${
    Number.isInteger(e.topFloor) ? ` · top floor ${e.topFloor}` : ''
  } · operator entry, not verified`;
}

/**
 * The prompt: pick the ground floor's number, optionally the top floor, then
 * "Use this numbering" (one deliberate confirm). onSave(entry | null).
 */
export function createNumberingForm({ entry = null, onSave }) {
  const root = document.createElement('div');
  // The class carries the answer so the card re-renders when it changes.
  root.className = validEntry(entry)
    ? `tt-numbering set-${entry.groundLabel}-${entry.topFloor ?? 'x'}`
    : 'tt-numbering';
  const render = (editing) => {
    root.replaceChildren();
    if (validEntry(entry) && !editing) {
      const line = document.createElement('div');
      line.className = 'tt-card-line';
      line.textContent = numberingNote(entry);
      const change = document.createElement('button');
      change.type = 'button';
      change.className = 'tt-link';
      change.textContent = 'Change';
      change.addEventListener('click', () => render(true));
      root.append(line, change);
      return;
    }
    const fs = document.createElement('fieldset');
    fs.className = 'tt-numbering-fs';
    const legend = document.createElement('legend');
    legend.textContent = 'How does this building number its floors?';
    fs.append(legend);
    let ground = validEntry(entry) ? entry.groundLabel : null;
    const name = `tt-num-${Math.random().toString(36).slice(2, 7)}`;
    for (const [text, g] of [
      ['Ground floor = 0 (UK / Europe)', 0],
      ['Ground floor = 1 (US)', 1],
      ['Not sure', 'unsure'],
    ]) {
      const lab = document.createElement('label');
      lab.className = 'tt-check';
      const r = document.createElement('input');
      r.type = 'radio';
      r.name = name;
      r.checked = ground === g;
      r.addEventListener('change', () => {
        ground = g;
        use.disabled = false;
      });
      lab.append(r, document.createTextNode(` ${text}`));
      fs.append(lab);
    }
    const lab = document.createElement('label');
    lab.className = 'tt-row';
    lab.textContent = 'Top floor number (as on the lift buttons, optional)';
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.max = '200';
    input.inputMode = 'numeric';
    input.value = entry?.topFloor ?? '';
    lab.append(input);
    const use = document.createElement('button');
    use.type = 'button';
    use.className = 'tt-btn primary';
    use.textContent = 'Use this numbering';
    use.disabled = ground === null;
    use.addEventListener('click', () => {
      if (ground === 'unsure') return onSave(null);
      const n = Number(input.value);
      const topFloor =
        input.value !== '' && Number.isInteger(n) && n >= ground ? n : null;
      onSave({ groundLabel: ground, topFloor, at: new Date().toISOString() });
    });
    const note = document.createElement('div');
    note.className = 'tt-note';
    note.textContent =
      'Operator entry · not verified · used only for this trip. Nothing is sent anywhere.';
    const acts = document.createElement('div');
    acts.className = 'tt-actions';
    acts.append(use);
    root.append(fs, lab, acts, note);
  };
  render(false);
  return root;
}
