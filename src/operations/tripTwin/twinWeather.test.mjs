import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseMeteoAlarmAtom } from '../../../server/tripTwin/weatherProxy.js';
import { bannedWordHits } from './twinData.js';
import {
  boxAround,
  conditionText,
  exposureException,
  heldLightning,
  lightningException,
  parseNwsAlerts,
  rainBand,
  rainPace,
  simulatedStrikes,
  summarizeMet,
  weatherChip,
  weatherSources,
  wmsUrl,
} from './twinWeather.js';

const sample = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`../../../scripts/fixtures/trip-twin/${name}`, import.meta.url),
    ),
  );
const austin = { lat: 30.2672, lon: -97.7431 };

test('MET Norway sample: summary picks the current hourly step', () => {
  const met = sample('weather.met.sample.json');
  const first = met.properties.timeseries[0];
  const s = summarizeMet(met, Date.parse(first.time) + 60e3);
  assert.equal(s.validTime, first.time);
  assert.equal(s.tempC, first.data.instant.details.air_temperature);
  assert.ok(Number.isFinite(s.cloud.low));
  assert.equal(
    weatherChip(s, { useF: true, clock: '19:00' }),
    `Now · ${Math.round((s.tempC * 9) / 5 + 32)} °F · ${s.condition} · forecast 19:00 · MET Norway`,
  );
  // Simulated rain is never credited to MET Norway.
  const sim = weatherChip(
    { ...s, condition: 'moderate rain' },
    { simulated: true },
  );
  assert.match(sim, /^SIM · .* · SIMULATED moderate rain · prototype/);
  assert.equal(weatherChip(null), 'Weather unavailable');
});

test('symbol codes become plain words', () => {
  assert.equal(conditionText('lightrainshowers_night'), 'light rain showers');
  assert.equal(conditionText('rainandthunder'), 'thunder');
  assert.equal(conditionText('clearsky_day'), 'clear');
  assert.equal(conditionText('partlycloudy_night'), 'partly cloudy');
});

test('NWS alerts sample parses to the official slot', () => {
  const alerts = parseNwsAlerts(sample('weather.nws.sample.json'));
  assert.ok(alerts.length >= 1);
  assert.equal(alerts[0].source, 'NWS');
  assert.ok(alerts[0].event);
});

test('MeteoAlarm Atom: entries with CAP fields', () => {
  const xml = `<feed><entry><title>Yellow wind warning</title><cap:event>Yellow Wind Warning</cap:event><cap:severity>Moderate</cap:severity><cap:areaDesc>London &amp; South East England</cap:areaDesc><cap:expires>2026-10-17T18:00:00+00:00</cap:expires></entry></feed>`;
  const [e] = parseMeteoAlarmAtom(xml);
  assert.equal(e.event, 'Yellow Wind Warning');
  assert.match(e.area, /London/);
});

test('sources by region: London has no 24 h totals (licence unverified)', () => {
  assert.equal(weatherSources('eu').totals, null);
  assert.match(
    weatherSources('us').precip.base,
    /mesonet\.agron\.iastate\.edu/,
  );
  const url = wmsUrl('https://x/wms', 'a:b', boxAround(austin));
  assert.match(url, /SRS=EPSG%3A4326/);
  assert.match(url, /LAYERS=a%3Ab/);
});

test('EX-WX-01: simulated strike 6.2 km from a gathering in use → watch text', () => {
  const g = [{ label: 'the hotel assembly point', point: austin, count: 16 }];
  const ex = lightningException(simulatedStrikes(austin), g, {
    simulated: true,
  });
  assert.ok(ex);
  assert.match(
    ex.text,
    /^SIMULATED lightning 6\.2 km SW of the hotel assembly point, 4 min ago — 16 people outdoors there$/,
  );
  assert.deepEqual(bannedWordHits(ex.text), []);
  assert.doesNotMatch(ex.text, /all clear|safe/i);
  // No one gathered outdoors: no exception.
  assert.equal(lightningException(simulatedStrikes(austin), []), null);
  // Strikes beyond 10 km only: no exception.
  assert.equal(lightningException([simulatedStrikes(austin)[2]], g), null);
});

test('EX-WX-02: exposure is incident-only information, never advice', () => {
  const cold = { apparentC: 2, precipMmH: 0 };
  assert.equal(exposureException(cold, 4, 30), null, 'fewer than 5 outside');
  assert.equal(exposureException(cold, 16, 10), null, 'under 20 min');
  assert.equal(
    exposureException(cold, 16, 25, { useF: true }).text,
    '16 people outside — about 25 min since the report · feels like 36 °F — information, not advice',
  );
  assert.equal(
    exposureException({ apparentC: 18, precipMmH: 4.2 }, 6, 20, {
      simulated: true,
    }).text,
    '6 people outside — about 20 min since the report · SIMULATED moderate rain — information, not advice',
  );
  assert.equal(
    exposureException({ apparentC: 18, precipMmH: 1 }, 16, 30),
    null,
  );
});

test('rain bands and walk-time allowance', () => {
  assert.equal(rainBand(0), null);
  assert.equal(rainBand(1), 'light');
  assert.equal(rainBand(4.2), 'moderate');
  assert.equal(rainBand(9), 'heavy');
  assert.equal(rainPace({ precipMmH: 1 }), null);
  assert.deepEqual(rainPace({ precipMmH: 4.2 }), {
    band: 'moderate',
    pct: 25,
    factor: 1.25,
    simulated: false,
  });
  assert.equal(
    rainPace({ precipMmH: 4.2 }, { simulated: true }).simulated,
    true,
  );
});

test('density raster is called a grid cell, never a strike; 30-min hold', () => {
  const g = [{ label: 'the hotel assembly point', point: austin, count: 16 }];
  const cell = { ...simulatedStrikes(austin)[0], ageMin: undefined };
  const ex = lightningException([cell], g, { gridKm: 8 });
  assert.match(
    ex.text,
    /^Lightning detected \(8 km grid cell\) within 6\.2 km SW of the hotel assembly point — 16 people outdoors there$/,
  );
  assert.doesNotMatch(ex.text, /strike/i);
  const t0 = Date.parse('2026-10-16T01:00:00Z');
  const held = heldLightning({ ex, at: t0 }, t0 + 20 * 60000, '20:00');
  assert.match(
    held.text,
    /last detected 20:00; holding 30 min after the last detection$/,
  );
  assert.equal(heldLightning({ ex, at: t0 }, t0 + 31 * 60000, '20:00'), null);
});
