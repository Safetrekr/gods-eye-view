import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tripTwinDemoSnapshot } from './demoTripTwin.js';
import { sitesForCity } from './twinSites.js';
import { bannedWordHits } from './twinData.js';
import {
  briefText,
  forecastAt,
  localClock,
  siteBrief,
  sunTimes,
  tripEvents,
  zonedToEpoch,
} from './twinAdvance.js';

const pois = (k) =>
  JSON.parse(
    readFileSync(
      new URL(
        `../../../scripts/fixtures/trip-twin/${k}.pois.json`,
        import.meta.url,
      ),
    ),
  ).pois;

test('event times are wall-clock times in the site time zone', () => {
  const e = zonedToEpoch('2026-10-17', '19:00', 'America/Chicago');
  assert.equal(new Date(e).toISOString(), '2026-10-18T00:00:00.000Z');
  assert.equal(localClock(e, 'America/Chicago'), '19:00');
  const l = zonedToEpoch('2026-10-17', '19:30', 'Europe/London');
  assert.equal(new Date(l).toISOString(), '2026-10-17T18:30:00.000Z');
});

test('sunset in Austin mid-October is just before 19:00 local', () => {
  const { set } = sunTimes('2026-10-17', 30.26, -97.75);
  const hm = localClock(set, 'America/Chicago');
  assert.ok(hm >= '18:45' && hm <= '19:05', hm);
});

test('trip events: arrival then itinerary, in time order', () => {
  const s = tripTwinDemoSnapshot('austin', 'baseline', { elapsed: 0 });
  const ev = tripEvents(s, sitesForCity('austin'), 'America/Chicago');
  assert.deepEqual(
    ev.map((e) => [e.day, e.title]),
    [
      [1, 'Arrive · Fairmont Austin'],
      [2, 'Concert · Long Center'],
      [3, 'Visit · Texas Capitol'],
    ],
  );
});

test('site brief: services, rally status, numbering, light; copy text is safe', () => {
  const s = tripTwinDemoSnapshot('austin', 'baseline', {
    elapsed: 0,
    pois: pois('austin'),
    poisBySite: {
      'austin-long-center': pois('austin-long-center'),
      'austin-capitol': pois('austin-capitol'),
    },
  });
  const sites = sitesForCity('austin');
  const ev = tripEvents(s, sites, 'America/Chicago');
  const visit = ev.find((e) => e.siteKey === 'austin-capitol');
  const met = JSON.parse(
    readFileSync(
      new URL(
        '../../../scripts/fixtures/trip-twin/weather.met.sample.json',
        import.meta.url,
      ),
    ),
  );
  const b = siteBrief({
    site: sites[2],
    hotel: sites[0],
    event: visit,
    snapshot: s,
    pois: pois('austin-capitol'),
    metJson: met,
    alerts: [],
    numbering: { mapped: true },
    timeZone: 'America/Chicago',
  });
  const by = Object.fromEntries(b.items.map((i) => [i.key, i]));
  assert.match(by.from_hotel.text, /straight line .* street path not checked$/);
  assert.match(
    by.hospital.text,
    / · \d[\d.]* k?m [NESW]{1,2} straight line · .* · not verified$/,
  );
  assert.match(
    by.rally.text,
    /draft · not approved$/,
    'day visit rally is a draft',
  );
  assert.equal(by.rally.warn, true);
  assert.match(
    by.light.text,
    /^Daylight at 10:00 · sunset \d\d:\d\d · ends 12:00 in daylight$/,
  );
  assert.ok(by.forecast.text.length > 0);
  const text = briefText([b], {
    trip: 'Spring choir tour (sample)',
    day: 3,
    asOf: '22:10',
    alertSource: 'NWS',
  });
  assert.match(
    text,
    /^DRAFT FOR REVIEW · Advance brief · Spring choir tour \(sample\) · Day 3 · as of 22:10\n/,
  );
  assert.match(text, /no traveler positions/);
  assert.match(text, /Not an approval/);
  assert.match(text, /\[not reviewed\]/);
  assert.deepEqual(bannedWordHits(text), []);
});

test('forecast lookup ignores steps far from the event', () => {
  const met = JSON.parse(
    readFileSync(
      new URL(
        '../../../scripts/fixtures/trip-twin/weather.met.sample.json',
        import.meta.url,
      ),
    ),
  );
  const t0 = Date.parse(met.properties.timeseries[0].time);
  assert.ok(forecastAt(met, t0 + 30 * 60000));
  assert.equal(forecastAt(met, t0 - 3 * 86400000), null);
});

test('site brief: an airport arrival is a coach transfer, never a walk', async () => {
  const { siteConfig } = await import('./twinSites.js');
  const { tripTwinDemoSnapshot } = await import('./demoTripTwin.js');
  const snapshot = tripTwinDemoSnapshot('london', 'c', { now: 0, elapsed: 0 });
  const b = siteBrief({
    site: siteConfig('london-heathrow-t5'),
    hotel: siteConfig('london'),
    event: null,
    snapshot,
    pois: [],
    numbering: { mapped: false, operator: null },
    timeZone: 'Europe/London',
  });
  const from = b.items.find((it) => it.key === 'from_hotel');
  assert.match(from.text, /straight line · group transfer by coach/);
  assert.doesNotMatch(from.text, /walk/);
});
