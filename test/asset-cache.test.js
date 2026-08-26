import test from 'node:test';
import assert from 'node:assert/strict';

import {
  readAsset,
  writeAsset,
  assetCacheStats,
  clearAssetCache
} from '../src/loaders/AssetCache.js';

/**
 * The cache's most important property is that it cannot break booting.
 *
 * Storage is one of the least reliable things a browser offers: private windows
 * refuse it outright, quota runs out mid-write, a user clears site data between
 * two calls. Every one of those has to degrade to a plain network load. Node has
 * no `indexedDB` at all, which makes it the exact environment those paths were
 * written for — these run against the real "storage is unavailable" branch
 * rather than a mock of it.
 */

test('reading without storage returns a miss instead of throwing', async () => {
  assert.equal(typeof indexedDB, 'undefined', 'precondition: no storage here');
  assert.equal(await readAsset('./models/anything.fbx'), null);
});

test('writing without storage reports failure instead of throwing', async () => {
  const bytes = new Uint8Array([1, 2, 3]).buffer;
  assert.equal(await writeAsset('./models/anything.fbx', bytes), false);
});

test('stats say so rather than pretending to be empty', async () => {
  const stats = await assetCacheStats();
  // `available: false` and `count: 0` mean different things — one is "no cache
  // here", the other is "a cache, holding nothing" — and a readout that
  // conflated them would report a broken cache as a cold one.
  assert.equal(stats.available, false);
  assert.equal(stats.count, 0);
  assert.equal(stats.bytes, 0);
});

test('clearing without storage is a no-op, not an error', async () => {
  assert.equal(await clearAssetCache(), false);
});

test('a failed write still leaves the caller able to read', async () => {
  // The sequence a quota failure produces: write refused, read misses, load
  // carries on over the network. None of it may throw.
  await writeAsset('./a.fbx', new Uint8Array(8).buffer);
  assert.equal(await readAsset('./a.fbx'), null);
  await clearAssetCache();
  assert.equal(await readAsset('./a.fbx'), null);
});

test('repeated calls do not wedge on the memoised open attempt', async () => {
  // The database handle is memoised, so a first failure must not poison every
  // later call into a rejected promise.
  for (let i = 0; i < 3; i++) {
    assert.equal(await readAsset(`./repeat-${i}.fbx`), null);
    assert.equal((await assetCacheStats()).available, false);
  }
});
