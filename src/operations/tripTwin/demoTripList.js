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
  },
]);

export const tripById = (id) =>
  DEMO_TRIPS.find((t) => t.id === id) || DEMO_TRIPS[0];
export const tripForCity = (cityKey) =>
  DEMO_TRIPS.find((t) => t.city === cityKey) || DEMO_TRIPS[0];
