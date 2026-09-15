export const DEFAULT_WORLD_LAYERS = [
  'flights',
  'military',
  'satellites',
  'ais-live-vessels',
  'traffic',
  'local-firms',
  'earthquakes',
  'cctv',
];

// Load independent feeds after the trip view appears. A provider outage must
// not prevent the other layers or the private trip view from opening.
export function enableDefaultWorldLayers(manager, signal) {
  return Promise.allSettled(
    DEFAULT_WORLD_LAYERS.map((id) =>
      manager.setEnabled(id, true, { origin: 'programmatic', signal }),
    ),
  );
}
