import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { readFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const origin = process.env.OPERATIONS_TEST_URL || 'http://127.0.0.1:4173';
const fixtureDir = 'output/operations/camera-fixtures';
mkdirSync(fixtureDir, { recursive: true });
execFileSync('ffmpeg', [
  '-hide_banner',
  '-loglevel',
  'error',
  '-f',
  'lavfi',
  '-i',
  'testsrc=size=320x180:rate=12',
  '-t',
  '3',
  '-pix_fmt',
  'yuv420p',
  '-c:v',
  'libx264',
  '-movflags',
  '+faststart',
  '-y',
  `${fixtureDir}/clip.mp4`,
]);
execFileSync('ffmpeg', [
  '-hide_banner',
  '-loglevel',
  'error',
  '-i',
  `${fixtureDir}/clip.mp4`,
  '-c:v',
  'libx264',
  '-g',
  '12',
  '-hls_time',
  '1',
  '-hls_list_size',
  '0',
  '-hls_segment_filename',
  `${fixtureDir}/segment%d.ts`,
  '-y',
  `${fixtureDir}/playlist.m3u8`,
]);
const browser = await puppeteer.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  let frames = 0;
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = new URL(req.url());
    const path = url.pathname;
    if (path === '/camera-test')
      return void req.respond({
        contentType: 'text/html',
        body: '<html><body><button id="open">Camera</button></body></html>',
      });
    if (path.startsWith('/api/cctv/stream/')) {
      const id = path.split('/').pop();
      const video = id !== 'image';
      return void req.respond({
        contentType: 'application/json',
        body: JSON.stringify({
          provider: 'Synthetic test camera',
          feedType: id === 'hls' ? 'hls' : video ? 'mp4' : 'image',
          playbackKind: id === 'hls' ? 'live' : 'clip',
          frameUrl: '/fixture/frame.png',
          mediaUrl: video
            ? id === 'hls'
              ? '/fixture/playlist.m3u8'
              : `/fixture/${id}.mp4`
            : null,
        }),
      });
    }
    if (path === '/fixture/frame.png') {
      frames++;
      return void req.respond({
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jq8kAAAAASUVORK5CYII=',
          'base64',
        ),
      });
    }
    if (path === '/fixture/broken.mp4')
      return void req.respond({ status: 503 });
    if (path.startsWith('/fixture/'))
      return void req.respond({
        contentType: path.endsWith('.m3u8')
          ? 'application/vnd.apple.mpegurl'
          : path.endsWith('.ts')
            ? 'video/mp2t'
            : 'video/mp4',
        body: readFileSync(`${fixtureDir}/${path.split('/').pop()}`),
      });
    req.continue();
  });
  await page.goto(`${origin}/camera-test`);
  await page.evaluate(async () => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = '/src/operations/operations.css';
    document.head.append(css);
    window.player = (
      await import('/src/operations/cameraPlayer.js')
    ).createCameraPlayer();
    document.querySelector('#open').onclick = () =>
      window.player.open({ id: 'clip', name: 'Playback verification' });
  });
  await page.click('#open');
  await page.waitForFunction(
    () => document.querySelector('video')?.currentTime > 0.3,
  );
  assert.equal(await page.$eval('video', (el) => el.controls), true);
  await page.screenshot({ path: 'output/operations/camera-player-video.png' });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('video'));
  assert.equal(await page.$('video'), null);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'open');
  await page.evaluate(() =>
    window.player.open({ id: 'hls', name: 'HLS playback verification' }),
  );
  await page.waitForFunction(
    () => document.querySelector('video')?.currentTime > 0.3,
  );
  await page.evaluate(() =>
    window.player.open({ id: 'broken', name: 'Unavailable video' }),
  );
  await page.waitForSelector('.ops-camera-stage img');
  assert.match(
    await page.$eval('.ops-camera-explanation', (el) => el.textContent),
    /Video is unavailable/,
  );
  await page.setViewport({ width: 390, height: 844 });
  const box = await page.$eval('dialog', (el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, bottom: r.bottom };
  });
  assert.ok(box.left >= 0 && box.right <= 390 && box.bottom <= 844);
  await page.evaluate(() =>
    window.player.open({ id: 'image', name: 'Snapshot camera' }),
  );
  await page.waitForFunction(
    () => document.querySelector('img')?.naturalWidth > 0,
  );
  const before = frames;
  await page.waitForFunction(() =>
    document
      .querySelector('.ops-camera-status')
      .textContent.includes('Snapshot fetched'),
  );
  await new Promise((resolve) => setTimeout(resolve, 15500));
  assert.ok(frames > before, 'Snapshots refresh while the player is open');
  await page.evaluate(() => window.player.dispose());
  assert.equal(await page.$('dialog'), null);
  assert.deepEqual(errors, []);
  console.log(
    'Camera smoke passed: actual MP4 and HLS playback, controls, Escape/focus, video failure fallback, 15-second snapshot refresh, mobile fit and disposal. Media was synthetic.',
  );
} finally {
  await browser.close();
}
