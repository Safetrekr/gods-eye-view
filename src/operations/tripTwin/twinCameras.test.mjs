import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cameraAgency,
  cameraName,
  cameraLines,
  rankCameras,
  noCameraLine,
  agoWords,
  kindWord,
} from './twinCameras.js';
import {
  cameraKind,
  createTrafficCameras,
  fixtureCameras,
  trimCamera,
} from '../../../server/tripTwin/cameraProxy.js';

const HOTEL = { lat: 30.26218, lon: -97.73832, words: 'the hotel' };
const cam = (over) => ({
  id: 'c1',
  name: 'CESAR CHAVEZ ST / RED RIVER ST',
  pack: 'austin',
  provider: 'City of Austin',
  lat: 30.2618,
  lon: -97.7378,
  d: 63,
  kind: 'still',
  heading: null,
  license: 'City of Austin Open Data Terms',
  ...over,
});

test('names, agencies and kinds', () => {
  assert.equal(
    cameraName('CESAR CHAVEZ ST / RED RIVER ST'),
    'Cesar Chavez St / Red River St',
  );
  assert.equal(
    cameraName('CESAR CHAVEZ ST / 35 SVRD'),
    'Cesar Chavez St / 35 SVRD',
  );
  assert.equal(
    cameraName('Baylis Rd/Westminster Bridge Rd'),
    'Baylis Rd/Westminster Bridge Rd',
  );
  assert.equal(cameraAgency({ pack: 'austin' }), 'AUSTIN');
  assert.equal(
    cameraName('MOPAC (FOUR SEASONS - EAST)'),
    'Mopac (Four Seasons - East)',
  );
  assert.equal(cameraName('100 BLK TRINITY ST'), '100 Block Trinity St');
  assert.equal(cameraAgency({ pack: 'tfl' }), 'TFL');
  assert.equal(cameraAgency({ pack: 'caltrans-d4' }), 'CALTRANS');
  assert.equal(cameraKind('image'), 'still');
  assert.equal(cameraKind('mp4'), 'clip');
  assert.equal(cameraKind('hls'), 'live');
  assert.equal(kindWord('clip'), 'Video clip');
});

test('a heading only when upstream trusts it', () => {
  const here = { lat: 30.26218, lon: -97.73832 };
  const low = trimCamera(
    {
      id: 'a',
      lat: 30.262,
      lon: -97.738,
      headingDeg: 315,
      headingConfidence: 'low',
      feedType: 'image',
    },
    here,
  );
  const high = trimCamera(
    {
      id: 'b',
      lat: 30.262,
      lon: -97.738,
      headingDeg: 90,
      headingConfidence: 'high',
      feedType: 'image',
    },
    here,
  );
  assert.equal(low.heading, null);
  assert.equal(high.heading, 90);
});

test('words: where, direction only when trusted, the time line, never "live"', () => {
  const l = cameraLines({ camera: cam(), target: HOTEL, unit: 'ft' });
  assert.equal(l.kicker, 'TRAFFIC CAMERA · AUSTIN · STILL');
  assert.equal(
    l.credit,
    'Image: City of Austin (Transportation & Public Works) · Open Data Terms',
  );
  assert.equal(l.name, 'Cesar Chavez St / Red River St');
  assert.match(l.where, /^210 ft SE of the hotel · direction not known$/);
  assert.match(
    l.time,
    /^The time on the picture is the camera’s own, not the trip clock/,
  );
  assert.equal(l.foot, 'Public road camera · not a view of the group');
  assert.doesNotMatch(JSON.stringify(l), /live/i);
  const t = cameraLines({
    camera: cam({ heading: 315 }),
    target: HOTEL,
    unit: 'ft',
  });
  assert.match(t.where, /pointed NW$/);
});

test('states: failed with and without a last image; unchanged after 10 min', () => {
  const now = 10_000_000;
  assert.equal(
    cameraLines({ camera: cam(), target: HOTEL, state: 'failed', now }).note,
    'Not answering right now · trying again',
  );
  assert.equal(
    cameraLines({
      camera: cam(),
      target: HOTEL,
      state: 'failed',
      frame: { fetchedAt: now - 3 * 60e3 },
      now,
    }).note,
    'Not refreshing · last image fetched 3 min ago',
  );
  assert.equal(
    cameraLines({
      camera: cam(),
      target: HOTEL,
      frame: { fetchedAt: now, sameSince: now - 12 * 60e3 },
      now,
    }).note,
    'Picture unchanged for 12 min',
  );
  assert.equal(
    cameraLines({
      camera: cam(),
      target: HOTEL,
      frame: { fetchedAt: now, sameSince: now - 60e3 },
      now,
    }).note,
    null,
  );
  assert.equal(
    noCameraLine({ status: 'ok', nearestM: 900, cameras: [] }, { unit: 'ft' }),
    'No traffic camera within 0.3 mi',
  );
  assert.equal(
    noCameraLine(
      { status: 'ok', nearestM: 900, trimmed: true, cameras: [] },
      { unit: 'ft' },
    ),
    'No traffic camera within 0.3 mi among those loaded',
  );
  assert.equal(
    noCameraLine({ status: 'ok', nearestM: 121000, cameras: [] }),
    'No traffic camera source covers this city in Trip Twin',
  );
  assert.equal(
    noCameraLine({ status: 'unavailable', cameras: [] }),
    'Traffic camera list unavailable right now · not checked',
  );
  assert.equal(agoWords(30e3), 'under a minute ago');
});

test('rank: nearest first, a trusted camera facing the place within 150 m first, at most 5', () => {
  const list = [
    cam({ id: 'near', d: 60 }),
    cam({ id: 'facing', d: 140, lat: 30.2614, lon: -97.7383, heading: 0 }),
    ...Array.from({ length: 6 }, (_, i) => cam({ id: `far${i}`, d: 300 + i })),
  ];
  const r = rankCameras(list, HOTEL);
  assert.equal(r.length, 5);
  assert.deepEqual(
    r.slice(0, 2).map((c) => c.id),
    ['facing', 'near'],
  );
});

test('proxy fixtures: Austin stills, a London clip, nothing in Washington; frames never use the network', async () => {
  assert.equal(fixtureCameras({ lat: 38.8969, lon: -77.0108 }).length, 0);
  assert.equal(fixtureCameras({ lat: 51.498, lon: -0.113 })[0].feedType, 'mp4');
  const s = createTrafficCameras({
    fixture: true,
    upstream: () => assert.fail('no network'),
  });
  const near = await s.near(30.26218, -97.73832, 500);
  assert.equal(near.status, 'ok');
  assert.deepEqual(
    near.cameras.map((c) => c.kind),
    ['still', 'still'],
  );
  assert.ok(near.cameras[0].d <= near.cameras[1].d);
  const f = await s.frame(near.cameras[0].id);
  assert.ok(f.jpg.length > 1000);
  await assert.rejects(s.frame('../etc'), { status: 400 });
  await assert.rejects(s.frame('real-1'), { status: 404 });
});

test('proxy: one fetch for the room; Street View or a drawing is never relayed; unknown ids are 404', async () => {
  let frames = 0;
  const jpeg = Buffer.from(
    await (
      await import('sharp')
    )
      .default({
        create: { width: 64, height: 48, channels: 3, background: '#556' },
      })
      .jpeg()
      .toBuffer(),
  );
  const upstream = async (p) => {
    if (p === '/api/cctv/sources')
      return new Response(
        JSON.stringify({
          sources: [
            {
              id: 'a1',
              name: 'A',
              lat: 30.2619,
              lon: -97.7379,
              feedType: 'image',
              pack: 'austin',
            },
            {
              id: 'sv',
              name: 'B',
              lat: 30.2619,
              lon: -97.7379,
              feedType: 'image',
              pack: 'austin',
            },
          ],
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    frames++;
    const src = p.includes('/sv') ? 'streetview' : 'upstream-image';
    return new Response(jpeg, {
      headers: { 'content-type': 'image/jpeg', 'x-cctv-source': src },
    });
  };
  const s = createTrafficCameras({ upstream });
  await Promise.all(Array.from({ length: 7 }, () => s.frame('a1')));
  assert.equal(frames, 1);
  await assert.rejects(s.frame('sv'), { status: 502 });
  await assert.rejects(s.frame('nope'), { status: 404 });
});

test('an old or stale-marked frame is never shown as current', () => {
  const now = 10_000_000;
  const old = cameraLines({
    camera: cam(),
    target: HOTEL,
    frame: { fetchedAt: now - 3 * 60e3, sameSince: now - 20 * 60e3 },
    now,
  });
  assert.equal(old.state, 'failed');
  assert.equal(old.note, 'Not refreshing · last image fetched 3 min ago');
  const marked = cameraLines({
    camera: cam(),
    target: HOTEL,
    frame: { fetchedAt: now, sameSince: now, stale: true },
    now,
  });
  assert.equal(marked.state, 'failed');
});
