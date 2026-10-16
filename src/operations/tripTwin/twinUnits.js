// Operator-chosen ground units. Grid spacing gives scale; contours give relief.
export const UNIT = Object.freeze({
  m: {
    label: 'm',
    toM: 1,
    grid: [10, 25, 50, 100],
    gridDefault: 50,
    contour: [1, 2, 5],
    contourDefault: 2,
  },
  ft: {
    label: 'ft',
    toM: 0.3048,
    grid: [50, 100, 250, 500],
    gridDefault: 250,
    contour: [5, 10, 20],
    contourDefault: 10,
  },
  yd: {
    label: 'yd',
    toM: 0.9144,
    grid: [25, 50, 100],
    gridDefault: 50,
    contour: [2, 5, 10],
    contourDefault: 2,
  },
});

export function formatLength(meters, unit, { signed = false } = {}) {
  const u = UNIT[unit] || UNIT.m;
  const v = meters / u.toM;
  const r = Math.abs(v) >= 10 ? Math.round(v) : Math.round(v * 10) / 10;
  return `${signed && r > 0 ? '+' : ''}${r === 0 ? 0 : r} ${u.label}`;
}

export function groundLine({ grid, contours, spacing, contour, unit }) {
  const u = UNIT[unit] || UNIT.m;
  const parts = [];
  if (grid)
    parts.push(
      `Grid: ${spacing} ${u.label} · bold lines ${spacing * 5} ${u.label}`,
    );
  if (contours)
    parts.push(
      `Elevation contours every ${contour} ${u.label}, relative to hotel street level`,
    );
  return parts.join(' · ') || 'Grid and elevation off';
}
