// Aggregate the complete FIRMS dataset, not the renderer's strongest-N subset.
// Cells are presentation groups of observations, never inferred fire incidents.
export function fireAlertAreas(records) {
  const cells = new Map();
  for (const fire of records) {
    if (
      !Number.isFinite(fire.lat) ||
      !Number.isFinite(fire.lon) ||
      Math.abs(fire.lat) > 90 ||
      Math.abs(fire.lon) > 180 ||
      !Number.isFinite(fire.acqMs) ||
      fire.acqMs <= 0
    )
      continue;
    const x = Math.min(3599, Math.floor((fire.lon + 180) * 10));
    const y = Math.min(1799, Math.floor((fire.lat + 90) * 10));
    const id = `fire-area:${x}:${y}`;
    let cell = cells.get(id);
    if (!cell) {
      cell = {
        id,
        count: 0,
        timeMs: 0,
        coordinates: { lat: fire.lat, lng: fire.lon },
        radiusKm: 0,
      };
      cells.set(id, cell);
    }
    cell.count++;
    cell.timeMs = Math.max(cell.timeMs, fire.acqMs);
    if (cell.count > 1) {
      cell.coordinates = {
        lat: (y + 0.5) / 10 - 90,
        lng: (x + 0.5) / 10 - 180,
      };
      cell.radiusKm = 8; // Conservative half-diagonal of a 0.1° cell.
    }
  }
  return [...cells.values()].sort(
    (a, b) => b.timeMs - a.timeMs || a.id.localeCompare(b.id),
  );
}
