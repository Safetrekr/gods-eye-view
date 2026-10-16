// Prototype hotels (03 §4.1). Real public buildings; all people are fictional.
// anchors: computed from each hotel's OSM footprint (deepest inside point, a
// point 6–10 m inside the wall, and an outdoor assembly point ~55 m from the
// wall with no building on it). Used to place the fictional cast.
export const TWIN_CITIES = Object.freeze({
  austin: {
    key: 'austin',
    anchors: {
      inside: { lat: 30.262126, lon: -97.738205 },
      insideClearanceM: 39.7,
      edge: { lat: 30.262414, lon: -97.73806 },
      assembly: { lat: 30.262937, lon: -97.737864 },
    },
    osm: 'way/134786106',
    label: 'Fairmont Austin',
    center: { lat: 30.26218, lon: -97.73832 },
    timezone: 'America/Chicago',
    groundFloorLabel: 1,
    levels: 37,
    floorHeightM: 3.3,
  },
  dc: {
    key: 'dc',
    anchors: {
      inside: { lat: 38.896927, lon: -77.01058 },
      insideClearanceM: 30.7,
      edge: { lat: 38.896702, lon: -77.010754 },
      assembly: { lat: 38.896148, lon: -77.010757 },
    },
    osm: 'way/48040879',
    label: 'Hilton Washington DC Capitol Hill',
    center: { lat: 38.8969, lon: -77.0108 },
    timezone: 'America/New_York',
    groundFloorLabel: 1,
    levels: 14,
    floorHeightM: 3.63,
  },
  london: {
    key: 'london',
    anchors: {
      inside: { lat: 51.49817, lon: -0.113437 },
      insideClearanceM: 21.3,
      edge: { lat: 51.498341, lon: -0.113509 },
      assembly: { lat: 51.498666, lon: -0.114233 },
    },
    osm: 'way/491692833',
    label: 'Park Plaza London Waterloo',
    center: { lat: 51.49817, lon: -0.11335 },
    timezone: 'Europe/London',
    groundFloorLabel: 0,
    levels: null, // not mapped in OSM: floor numbering not verified
    floorHeightM: null,
  },
});
