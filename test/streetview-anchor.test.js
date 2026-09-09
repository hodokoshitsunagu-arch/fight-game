import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bearingDegrees,
  distanceMeters,
  STREET_VIEW_NATIVE_NAVIGATION,
  StreetViewBackdrop
} from '../src/world/StreetViewBackdrop.js';
import { StreetViewAdapter } from '../src/campaign/v3/StreetViewAdapter.js';

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

test('navigator buttons change the official viewer POV', () => {
  const povWrites = [];
  const view = Object.create(StreetViewBackdrop.prototype);
  view.ready = true;
  view.panorama = {
    getPov: () => ({ heading: 20, pitch: -7 }),
    setPov: (pov) => povWrites.push(pov),
  };

  assert.equal(view.applyNavigatorCommand('turn-right'), true);
  assert.deepEqual(povWrites, [{ heading: 50, pitch: -7 }]);
  assert.equal(view.heading, 50);
});

test('a frame sync preserves official viewer drag heading and pitch in adventure ownership', () => {
  const povWrites = [];
  const view = Object.create(StreetViewBackdrop.prototype);
  view.ready = true;
  view.povOwner = 'street-view';
  view._heading = 0;
  view._pitch = 0;
  view._zoom = 1;
  view.panorama = {
    getPov: () => ({ heading: 73, pitch: -12 }),
    getZoom: () => 1,
    setPov: (pov) => povWrites.push(pov),
    setZoom: () => {},
  };

  view.sync({
    matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
    fov: 60,
  });

  assert.deepEqual(povWrites, []);
  assert.equal(view.heading, 73);
  assert.equal(view._pitch, -12);
});

test('combat alone locks official interaction and exploration restores dragging', () => {
  const options = [];
  const view = Object.create(StreetViewBackdrop.prototype);
  view.element = { dataset: {} };
  view.viewers = [{ setOptions: (value) => options.push(value) }];
  const adapter = new StreetViewAdapter(() => view);

  adapter.setLocked({ locked: false, managedNavigation: true });
  assert.equal(options.at(-1).draggable, true);
  assert.equal(view.povOwner, 'street-view');

  adapter.setLocked({ locked: true, managedNavigation: false });
  assert.equal(options.at(-1).draggable, false);
  assert.equal(view.povOwner, 'street-view');

  adapter.setLocked({ locked: false, managedNavigation: true });
  assert.equal(options.at(-1).draggable, true);
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
