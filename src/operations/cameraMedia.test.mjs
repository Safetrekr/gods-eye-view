import test from 'node:test';
import assert from 'node:assert/strict';
import {
  officialCameraVideo,
  resolveCameraMedia,
  rewriteCameraPlaylist,
} from '../../server/providers/camera-media.js';
import {
  issueProviderSession,
  validProviderSession,
  clearProviderSession,
} from '../../server/standalone/providerSession.js';

test('public video URLs are restricted to official providers', () => {
  assert.equal(
    officialCameraVideo(
      'https://wzmedia.dot.ca.gov/D7/CCTV-196.stream/playlist.m3u8',
      'caltrans',
    ).feedType,
    'hls',
  );
  assert.equal(
    officialCameraVideo(
      'https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00001.06502.mp4',
      'tfl',
    ).playbackKind,
    'clip',
  );
  for (const url of [
    'https://evil.example/D7/playlist.m3u8',
    'http://wzmedia.dot.ca.gov/D7/playlist.m3u8',
    'https://user@wzmedia.dot.ca.gov/D7/playlist.m3u8',
  ])
    assert.equal(officialCameraVideo(url, 'caltrans'), null);
});

test('HLS variants, maps, encryption keys and segments stay in registered camera directory', () => {
  const source = 'https://wzmedia.dot.ca.gov/D7/camera.stream/playlist.m3u8';
  const result = rewriteCameraPlaylist(
    '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\nvariant/chunklist.m3u8\n',
    source,
    source,
    'camera',
  );
  assert.ok(result.includes('/api/cctv/media/camera?asset='));
  assert.ok(result.includes('init.mp4'));
  assert.ok(result.includes('key.bin'));
  assert.equal(
    resolveCameraMedia(source, 'variant/segment.ts').pathname,
    '/D7/camera.stream/variant/segment.ts',
  );
  for (const path of [
    'https://evil.example/video.ts',
    '//127.0.0.1/secret',
    '../other.stream/file.ts',
    '%2e%2e/private.ts',
    'https://user:pass@wzmedia.dot.ca.gov/D7/camera.stream/x.ts',
  ])
    assert.throws(() => resolveCameraMedia(source, path));
  assert.throws(() =>
    rewriteCameraPlaylist('Not a playlist', source, source, 'camera'),
  );
});

test('provider cookie expires, rejects tampering, and clears on logout', () => {
  let cookie;
  const res = {
    setHeader: (_, value) => {
      cookie = value;
    },
  };
  const secret = 'synthetic-test-secret-with-32-characters';
  issueProviderSession(res, secret, 1000000);
  assert.equal(validProviderSession(cookie, secret, 1000000), true);
  assert.equal(validProviderSession(cookie, secret, 1300000), false);
  assert.equal(
    validProviderSession(
      cookie,
      'another-test-secret-with-32-characters',
      1000000,
    ),
    false,
  );
  assert.equal(
    validProviderSession(cookie.replace('1300.', '1400.'), secret, 1000000),
    false,
  );
  assert.equal(validProviderSession(cookie, '', 1000000), false);
  assert.match(cookie, /HttpOnly; Secure; SameSite=Strict/);
  clearProviderSession(res);
  assert.match(cookie, /Max-Age=0/);
  assert.equal(validProviderSession(cookie, secret, 1000000), false);
});
