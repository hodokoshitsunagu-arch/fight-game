import test from 'node:test';
import assert from 'node:assert/strict';
import { measureViewport, pointerNdc } from '../src/core/Viewport.js';

test('viewport measurement follows the canvas CSS box instead of window dimensions', () => {
  const canvas = {
    getBoundingClientRect: () => ({ left: 12, top: 24, width: 390, height: 844 })
  };
  assert.deepEqual(measureViewport(canvas, { innerWidth: 980, innerHeight: 1600 }), {
    left: 12, top: 24, width: 390, height: 844
  });
});

test('pointer coordinates use the exact canvas box', () => {
  const canvas = {
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 400, height: 800 })
  };
  assert.deepEqual(pointerNdc({ clientX: 210, clientY: 420 }, canvas), { x: 0, y: 0 });
  assert.deepEqual(pointerNdc({ clientX: 10, clientY: 20 }, canvas), { x: -1, y: 1 });
  assert.deepEqual(pointerNdc({ clientX: 410, clientY: 820 }, canvas), { x: 1, y: -1 });
});
