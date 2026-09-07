import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bearingDegrees,
  distanceMeters,
  STREET_VIEW_NATIVE_NAVIGATION,
  StreetViewBackdrop
} from '../src/world/StreetViewBackdrop.js';

test('anchor distance is zero in place and approximately one latitude degree', () => {
  assert.equal(distanceMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 0 }), 0);
  assert.ok(Math.abs(distanceMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 }) - 111195) < 100);
});

test('anchor bearing follows the four cardinal directions', () => {
  assert.equal(Math.round(bearingDegrees({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })), 0);
  assert.equal(Math.round(bearingDegrees({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })), 90);
  assert.equal(Math.round(bearingDegrees({ lat: 0, lng: 0 }, { lat: -1, lng: 0 })), 180);
  assert.equal(Math.round(bearingDegrees({ lat: 0, lng: 0 }, { lat: 0, lng: -1 })), 270);
});

test('native Street View directional links and click-to-go remain enabled', () => {
  assert.deepEqual(STREET_VIEW_NATIVE_NAVIGATION, {
    linksControl: true,
    clickToGo: true
  });
});

test('anchor navigation falls back to coordinates when the link graph fails', async () => {
  const view = Object.create(StreetViewBackdrop.prototype);
  view.ready = true;
  view.panorama = {};
  view.survey = () => ({ position: { lat: 0, lng: 0 } });
  view._stepTowards = async () => false;
  view.moveTo = async () => true;
  const result = await view.moveToAnchor({
    lat: 1, lng: 1, radius: 100, transition: 'walk', walkSteps: 2
  }, { fromAnchor: { lat: 0, lng: 0 } });
  assert.equal(result.mode, 'coordinate-fallback');
  // The stubbed viewer did not actually move, so drift is still reported and
  // the director can explain the degraded transition instead of claiming it.
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'coordinate-drift');
});

test('anchor navigation reports unavailable viewers as structured failure', async () => {
  const view = Object.create(StreetViewBackdrop.prototype);
  view.ready = false;
  view.panorama = null;
  assert.deepEqual(await view.moveToAnchor({ lat: 1, lng: 1, radius: 100 }), {
    ok: false, mode: 'degraded', reason: 'street-view-unavailable'
  });
});
