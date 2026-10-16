// Phase 6: weather over time — MET steps, precipitation type, timeline kinds.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bannedWordHits } from './twinData.js';
import {
  intensity,
  metSteps,
  precipKind,
  precipRowText,
  relText,
  stepAt,
  timeKind,
} from './twinWeatherTime.js';

const met = JSON.parse(
  readFileSync(
    new URL(
      '../../../scripts/fixtures/trip-twin/weather.met.sample.json',
      import.meta.url,
    ),
  ),
);
const H = 3600e3;

test('MET timeseries → hourly then 6-hourly steps, mm/h comparable', () => {
  const steps = metSteps(met);
  assert.equal(steps.length, 89);
  assert.equal(steps[0].stepH, 1);
  const six = steps.find((s) => s.stepH === 6);
  assert.ok(six, 'later steps are 6-hourly');
  assert.ok(
    steps.every((s, i) => !i || s.t > steps[i - 1].t),
    'sorted',
  );
  assert.ok(Number.isFinite(steps[0].tempC));
  assert.ok('low' in steps[0].cloud && 'fogPct' in steps[0]);
});

test('stepAt covers its period and never stretches past the end', () => {
  const steps = metSteps(met);
  const t0 = steps[0].t;
  assert.equal(stepAt(steps, t0 + 30 * 60e3), steps[0]);
  assert.equal(stepAt(steps, t0 - 1), null, 'before the first step');
  const last = steps[steps.length - 1];
  assert.equal(stepAt(steps, last.t + (last.stepH || 1) * H + 1), null);
});

test('precipitation type: symbol first, temperature only near freezing', () => {
  assert.equal(
    precipKind({ symbol: 'lightsnow', precipMmH: 0.4, tempC: 3 }),
    'snow',
  );
  assert.equal(
    precipKind({ symbol: 'sleet', precipMmH: 1, tempC: 1 }),
    'sleet',
  );
  assert.equal(
    precipKind({ symbol: 'heavyrainshowers_day', precipMmH: 6, tempC: 12 }),
    'rain',
  );
  assert.equal(
    precipKind({ symbol: 'cloudy', precipMmH: 0.3, tempC: -2 }),
    'snow',
  );
  assert.equal(precipKind({ symbol: 'cloudy', precipMmH: 0, tempC: -2 }), null);
  assert.equal(precipKind(null), null);
});

test('intensity bands; snow water counts more', () => {
  assert.equal(intensity(0.5).band, 'light');
  assert.equal(intensity(4).band, 'moderate');
  assert.equal(intensity(9).band, 'heavy');
  assert.equal(intensity(1, 'snow').band, 'moderate');
});

test('timeline kinds and relative times', () => {
  const now = Date.UTC(2026, 9, 16, 21, 0);
  const o = { now, modelUntil: now + 18 * H, siteUntil: now + 48 * H };
  assert.equal(timeKind(now - 30 * 60e3, o), 'observed');
  assert.equal(timeKind(now - 3 * H, o), 'none');
  assert.equal(timeKind(now + H, o), 'model');
  assert.equal(timeKind(now + 20 * H, o), 'site');
  assert.equal(
    timeKind(now + 20 * H, { now, siteUntil: now + 48 * H }),
    'site',
  );
  assert.equal(timeKind(now + 60 * H, o), 'none');
  assert.equal(relText(now + 105 * 60e3, now), '+1 h 45 min');
  assert.equal(relText(now - 55 * 60e3, now), '−55 min');
  assert.equal(relText(now + 2 * H, now), '+2 h');
  assert.equal(relText(now, now), 'now');
});

test('row text: says when the radar shows none; never banned words', () => {
  const step = { precipMmH: 1.2, symbol: 'lightrain', tempC: 9 };
  const radarNone = precipRowText({
    step,
    kind: 'rain',
    radar: { covered: false, label: 'radar' },
    at: '21:00',
  });
  assert.equal(radarNone, 'Forecast rain · none on radar over the site now');
  const siteOnly = precipRowText({
    step,
    kind: 'rain',
    radar: null,
    at: '21:00',
  });
  assert.match(siteOnly, /not a map$/);
  assert.match(precipRowText({ simulated: 'snow' }), /^SIMULATED snow/);
  assert.deepEqual(bannedWordHits([radarNone, siteOnly].join(' ')), []);
});

test('map frames: snapped times, pinned model runs, honest ranges', async () => {
  const { timeSources } = await import('./twinWeatherTime.js');
  const now = Date.UTC(2026, 9, 16, 14, 57);
  const bbox = [-97.8, 30.2, -97.6, 30.3];
  const us = timeSources('us');
  const past = us.observed.url(bbox, Date.UTC(2026, 9, 16, 14, 37));
  assert.match(past, /n0q-t\.cgi/);
  assert.match(
    past,
    /TIME=2026-10-16T14%3A35%3A00Z/,
    'snapped to the 5-min grid',
  );
  const run = Date.UTC(2026, 9, 16, 13);
  const fut = us.model.url(bbox, Date.UTC(2026, 9, 16, 16, 20), { run });
  assert.match(fut, /LAYERS=refd-t/);
  assert.match(fut, /hour=13/);
  assert.match(fut, /f=0195/, '3 h 15 min after the 13Z run');
  assert.equal(us.model.until(now, { run }), run + 18 * 3600e3);
  assert.equal(
    us.observed.parseLatest({ meta: { valid: '2026-10-16T15:10:00Z' } }),
    Date.UTC(2026, 9, 16, 15, 10),
    'IEM nests the time under meta',
  );
  assert.equal(us.observed.parseLatest({}), null, 'never NaN');
  assert.equal(us.model.parseRun({ model_init_utc: 'x' }), null);
  const eu = timeSources('eu');
  assert.equal(
    eu.observed.until(now),
    now - 65 * 60e3,
    'satellite lags ~65 min',
  );
  assert.equal(
    eu.model.run(now),
    Date.UTC(2026, 9, 16, 6),
    'a fully loaded run',
  );
  const dwd = eu.model.url(bbox, Date.UTC(2026, 9, 16, 17, 20), {
    run: Date.UTC(2026, 9, 16, 6),
  });
  assert.match(
    dwd,
    /TIME=2026-10-16T18%3A00%3A00.000Z/,
    'the hour ending after t',
  );
  assert.match(dwd, /DIM_REFERENCE_TIME=2026-10-16T06/);
});
