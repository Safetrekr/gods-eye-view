import test from 'node:test';
import assert from 'node:assert/strict';
import { currentSide, lookHeadingFrom, rotated, SIDES } from './twinCompass.js';

test('view from a side = stand there and look across', () => {
  assert.deepEqual(
    SIDES.map((s) => [s.key, lookHeadingFrom(s.from)]),
    [
      ['N', 180],
      ['E', 270],
      ['S', 0],
      ['W', 90],
    ],
  );
});

test('current side follows the camera heading', () => {
  assert.equal(currentSide(0).key, 'S', 'looking north = standing south');
  assert.equal(currentSide(180).key, 'N');
  assert.equal(currentSide(265).key, 'E');
  assert.equal(currentSide(-80).key, 'E');
  assert.equal(currentSide(100).key, 'W');
});

test(', and . turn the view by 90°', () => {
  assert.equal(rotated(10, 1), 100);
  assert.equal(rotated(10, -1), 280);
});

test('caption says where you stand and where you look', async () => {
  const { compassCaption } = await import('./twinCompass.js');
  assert.equal(compassCaption(0), 'Viewing from S · looking N');
  assert.equal(compassCaption(180), 'Viewing from N · looking S');
  assert.equal(compassCaption(270), 'Viewing from E · looking W');
});

test('plan view: the caption says which way is up (screens/55-S2-PLAN)', async () => {
  const { planCaption } = await import('./twinCompass.js');
  assert.equal(planCaption(0), 'Plan view · north up');
  assert.equal(planCaption(357), 'Plan view · north up');
  assert.equal(planCaption(45), 'Plan view · up is NE');
  assert.equal(planCaption(180), 'Plan view · up is S');
});
