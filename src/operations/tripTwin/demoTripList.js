// The three sample trips (phase 10), as plain data: the trip picker, the
// describer and Fitzroy's catalog read them without loading the Advance
// model (review/fitzroy-commands F20: no Cesium in the voice path). Pure.
export const DEMO_TRIPS = Object.freeze([
  {
    id: 'trip-choir-austin',
    title: 'Spring choir tour',
    org: 'Riverside Choir',
    orgShort: 'RC',
    city: 'austin',
    scenario: 'baseline',
  },
  {
    id: 'trip-band-dc',
    title: 'Jazz band trip',
    org: 'Lincoln High Jazz Band',
    orgShort: 'LJ',
    city: 'dc',
    scenario: 'b',
  },
  {
    id: 'trip-youth-london',
    title: 'Youth choir tour',
    org: 'St Anne’s Youth Choir',
    orgShort: 'SA',
    city: 'london',
    scenario: 'a',
    // Demo C, the arrival at Heathrow T5 (Jesse, 29 Oct 2026): picked at
    // launch with ?scenario=c, never the trip's default.
    demos: ['c'],
  },
]);

export const tripById = (id) =>
  DEMO_TRIPS.find((t) => t.id === id) || DEMO_TRIPS[0];
export const tripForCity = (cityKey) =>
  DEMO_TRIPS.find((t) => t.city === cityKey) || DEMO_TRIPS[0];

/** True for a trip's extra demo scenario ('c'), never a default one. */
export const isTripDemo = (key) =>
  Boolean(key) && DEMO_TRIPS.some((t) => t.demos?.includes(key));

/**
 * The scenario a trip shows: its extra demo when that demo was picked
 * (`pick`, from ?scenario= or ?demo=), else its own default. Every surface
 * (the twin, the walls, the remote, the trip tiles) asks this, so a picked
 * Demo C is the London trip everywhere.
 */
export const scenarioForTrip = (trip, pick = null) =>
  pick && trip?.demos?.includes(pick) ? pick : trip?.scenario;
