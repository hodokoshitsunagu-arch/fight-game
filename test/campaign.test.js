import test from 'node:test';
import assert from 'node:assert/strict';

import { settings } from '../src/config/settings.js';
import { DummyField } from '../src/sandbox/DummyField.js';
import { CampaignDirector, STATE } from '../src/campaign/CampaignDirector.js';
import { LEVELS, flattenNodes, unlockedAt, TOTAL_NODES } from '../src/campaign/campaign.js';
import { SCENES } from '../src/config/scenes.js';

/** Stand-in for EnemyManager with just the surface DummyField touches. */
function makeEnemies() {
  return {
    active: [],
    stopSpawning() {},
    clearEnemies() { this.active.length = 0; },
    spawn(position, descriptor) {
      const enemy = { position: position.clone(), descriptor, isDead: false };
      this.active.push(enemy);
      return enemy;
    },
    get aliveCount() { return this.active.filter((e) => !e.isDead).length; }
  };
}

function run(target, seconds, step = 0.1) {
  for (let t = 0; t < seconds; t += step) target.update(step);
}

/* ------------------------------------------------------- finite DummyField */

test('a finite wave sends exactly what it was asked for and no more', () => {
  const enemies = makeEnemies();
  const field = new DummyField(enemies);
  field.getFacing = () => 0;
  field.startWave({ roster: [{ archetype: 'normal', behaviour: 'sentry' }], count: 3 });

  // Long enough for several batch cycles had it been endless.
  run(field, 60);
  assert.equal(enemies.active.length, 3, 'three arrived, and the wave stopped there');
});

test('a wave larger than a batch arrives in groups, and all of it arrives', () => {
  const enemies = makeEnemies();
  const field = new DummyField(enemies);
  field.getFacing = () => 0;
  let total = 0;
  const originalSpawn = enemies.spawn.bind(enemies);
  enemies.spawn = (...args) => { total++; return originalSpawn(...args); };
  field.startWave({ roster: [{ archetype: 'normal', behaviour: 'sentry' }], count: 8 });

  run(field, settings.encounter.openingDelay + 8);
  const first = total;
  assert.ok(first > 0 && first <= settings.encounter.batchSize,
    `${first} out so far — the first group, not all eight`);

  /*
   * Clearing repeatedly, as a player would. The view caps *hold* arrivals
   * rather than dropping them, so the tail of a wave only walks in as room is
   * made — which means "all eight arrive" is a statement about the whole
   * encounter, not about any one moment.
   */
  for (let i = 0; i < 8 && total < 8; i++) {
    enemies.active.length = 0;
    run(field, settings.encounter.restSeconds + 8);
  }
  assert.equal(total, 8, 'the whole wave arrived, across several groups');
  assert.ok(field.batch > 1, 'and it took more than one group to do it');
});

test('clearing a finite wave fires onCleared exactly once', () => {
  const enemies = makeEnemies();
  const field = new DummyField(enemies);
  field.getFacing = () => 0;
  let cleared = 0;
  field.onCleared = () => { cleared++; };
  field.startWave({ roster: [{ archetype: 'normal', behaviour: 'sentry' }], count: 2 });

  run(field, settings.encounter.openingDelay + 4);
  assert.equal(cleared, 0, 'not while they are still standing');

  enemies.active.length = 0;
  run(field, 10);
  assert.equal(cleared, 1, 'once, when the field empties');
});

test('the endless sandbox is untouched by the finite mode', () => {
  const enemies = makeEnemies();
  const field = new DummyField(enemies);
  field.getFacing = () => 0;
  field.start();
  assert.equal(field.quota, Infinity, 'no quota means no end');

  // Population is capped by design, so growth is the wrong measure — what free
  // play guarantees is that batches keep coming.
  for (let i = 0; i < 6; i++) {
    run(field, 20);
    enemies.active.length = 0;
  }
  assert.ok(field.batch > 3, `${field.batch} batches and still going`);
  assert.equal(field.phase !== 'cleared', true, 'free play never reports itself finished');
});

/* --------------------------------------------------------- campaign content */

test('every node is authored, not generated', () => {
  const flat = flattenNodes();
  assert.equal(flat.length, TOTAL_NODES);
  for (const node of flat) {
    assert.equal(node.roster.length, node.count,
      `${node.location.sceneId} node ${node.nodeIndex}: roster matches the count`);
    assert.ok(node.hint && node.beat, 'every node teaches something and says something');
  }
});

test('every location in the campaign is a scene that actually exists', () => {
  const ids = new Set(SCENES.map((s) => s.id));
  const used = LEVELS.flatMap((l) => l.locations.map((x) => x.sceneId));
  for (const id of used) assert.ok(ids.has(id), `${id} is a verified scene`);
  assert.equal(new Set(used).size, SCENES.length, 'and all ten are used, each once');
});

test('counts and variety both rise across the five levels', () => {
  const totals = LEVELS.map((l) =>
    l.locations.flatMap((x) => x.nodes).reduce((a, n) => a + n.count, 0));
  for (let i = 1; i < totals.length; i++) {
    assert.ok(totals[i] > totals[i - 1], `level ${i + 1} is bigger than level ${i}`);
  }

  const kinds = LEVELS.map((l) => new Set(
    l.locations.flatMap((x) => x.nodes).flatMap((n) => n.roster.map((r) => r.archetype))).size);
  assert.deepEqual(kinds, [...kinds].sort((a, b) => a - b), 'archetype variety never goes backwards');
  assert.equal(kinds[0], 1, 'level one is one kind of thing');
  assert.equal(kinds.at(-1), 4, 'level five uses all four');
});

test('spells unlock two at a time and cover the whole roster', () => {
  const all = LEVELS.flatMap((l) => l.unlocks);
  assert.equal(new Set(all).size, all.length, 'nothing is unlocked twice');
  assert.ok(unlockedAt(0).length < unlockedAt(4).length, 'the list grows');
  for (const element of ['ice', 'thunder', 'meteor', 'beam', 'snare', 'glacier',
    'void', 'phoenix', 'singularity', 'worldtree']) {
    assert.ok(all.includes(element), `${element} is taught somewhere`);
  }
});

/* ------------------------------------------------------------ the director */

function makeDirector(overrides = {}) {
  const enemies = makeEnemies();
  const field = new DummyField(enemies);
  field.getFacing = () => 0;
  const shard = {
    placed: 0, cleared: 0, active: false,
    place() { this.placed++; this.active = true; },
    clear() { this.cleared++; this.active = false; },
    update() {}
  };
  const streetView = {
    steps: [], moves: [],
    stepRelative(deg) { this.steps.push(deg); return true; },
    availableDirections: () => ({ forward: true, right: true, back: true, left: true }),
    moveTo(lat, lng) { this.moves.push({ lat, lng }); return true; }
  };
  // The app boots at Times Square, which is where node 0 is — so a fresh start
  // should cost no `moveTo` at all. Modelling that here is what makes the move
  // counts below mean "a border was crossed".
  const world = { sceneId: 'times-square' };
  const director = new CampaignDirector({
    dummies: field, shard, streetView, scenes: SCENES, getFacing: () => 0,
    getCurrentSceneId: () => world.sceneId, ...overrides
  });
  director.onLocationChange = (scene) => { if (scene) world.sceneId = scene.id; };
  return { director, field, enemies, shard, streetView, world };
}

/**
 * Play one node to completion: clear the wave, take the shard, and let the
 * director settle into whatever comes next.
 *
 * Written as bounded loops rather than fixed durations because both ends are
 * genuinely variable — a node may hold arrivals behind the view cap, and the
 * step that follows may be a walk or a chapter card.
 */
function clearNode({ director, field, enemies, shard }) {
  for (let i = 0; i < 200 && director.state !== STATE.FIGHTING; i++) director.update(0.1);
  assert.equal(director.state, STATE.FIGHTING, 'a fight is on');

  for (let i = 0; i < 40 && director.state === STATE.FIGHTING; i++) {
    run(field, 6);
    enemies.active.length = 0;
    run(field, 1);
    director.update(0.1);
  }
  assert.equal(director.state, STATE.SEARCHING, 'the shard is up');

  shard.onCollect();
  for (let i = 0; i < 400
    && director.state !== STATE.FIGHTING && director.state !== STATE.DONE; i++) {
    director.update(0.1);
  }
}

test('the shard appears only after the last enemy falls', () => {
  const ctx = makeDirector();
  const { director, field, enemies, shard } = ctx;
  director.start({ resume: false });
  run(director, settings.campaign.introSeconds + 0.5);
  assert.equal(director.state, STATE.FIGHTING);

  run(field, settings.encounter.openingDelay + 5);
  assert.ok(enemies.active.length > 0, 'they are out');
  assert.equal(shard.placed, 0, 'and nothing to pick up while they are');

  enemies.active.length = 0;
  run(field, 2);
  director.update(0.1);
  assert.equal(shard.placed, 1, 'now');
  assert.equal(director.state, STATE.SEARCHING);
});

test('not collecting the shard means not advancing', () => {
  const ctx = makeDirector();
  ctx.director.start({ resume: false });
  run(ctx.director, settings.campaign.introSeconds + 0.5);
  run(ctx.field, settings.encounter.openingDelay + 20);
  ctx.enemies.active.length = 0;
  run(ctx.field, 2);
  ctx.director.update(0.1);

  run(ctx.director, 30);
  assert.equal(ctx.director.state, STATE.SEARCHING, 'it waits indefinitely');
  assert.equal(ctx.director.index, 0, 'and the node has not changed');
  assert.equal(ctx.streetView.steps.length, 0, 'nothing walked anywhere');
});

test('collecting it advances exactly one node, by walking the street', () => {
  const ctx = makeDirector();
  ctx.director.start({ resume: false });
  clearNode(ctx);

  assert.equal(ctx.director.index, 1, 'one node on');
  assert.equal(ctx.streetView.steps.length, 1, 'one step taken');
  assert.equal(ctx.streetView.steps[0], 0, 'forward, where the player was looking');
  assert.equal(ctx.streetView.moves.length, 0, 'and no country was crossed');
});

test('the last node of a location crosses to the next country instead of stepping', () => {
  const ctx = makeDirector();
  ctx.director.start({ resume: false });
  // Times Square has two nodes; the second is the last of that location.
  clearNode(ctx);
  clearNode(ctx);

  assert.equal(ctx.streetView.steps.length, 1, 'only the within-location step');
  assert.equal(ctx.streetView.moves.length, 1, 'the location boundary is a jump');
  assert.equal(ctx.director.index, 2);
  assert.equal(ctx.director.node.location.sceneId, 'shibuya');
});

test('a step blocked in every direction does not strand the campaign', () => {
  const ctx = makeDirector();
  ctx.streetView.stepRelative = () => false;
  ctx.streetView.availableDirections = () => ({ forward: false, right: false, back: false, left: false });
  ctx.director.start({ resume: false });
  clearNode(ctx);

  // The panorama did not move, but the node did — a level that cannot be left
  // because a link is missing is worse than one that advances in place.
  assert.equal(ctx.director.index, 1, 'progress continues regardless');
  assert.equal(ctx.director.state, STATE.FIGHTING, 'and the next fight starts');
});

test('unlocks follow the level the player is actually on', () => {
  const ctx = makeDirector();
  const seen = [];
  ctx.director.onUnlocks = (list) => seen.push(list.length);
  ctx.director.start({ resume: false });
  assert.deepEqual(ctx.director.unlocked, ['ice', 'thunder'], 'level one casts two spells');
  assert.ok(seen.length > 0, 'and App was told');
});

test('remaining counts what is still to come, not just what is standing', () => {
  const ctx = makeDirector();
  ctx.director.start({ resume: false });
  run(ctx.director, settings.campaign.introSeconds + 0.5);
  // Before anything has walked in, the whole wave is still ahead.
  assert.equal(ctx.director._remaining(), ctx.director.node.count);
});

test('the campaign ends after the last node', () => {
  const ctx = makeDirector();
  ctx.director.start({ resume: false });
  ctx.director.index = TOTAL_NODES - 1;
  ctx.director._enterNode({ arriving: false });
  clearNode(ctx);
  assert.equal(ctx.director.state, STATE.DONE);
});

test('free roam can be left and the campaign resumed where it stood', () => {
  const ctx = makeDirector();
  ctx.director.start({ resume: false });
  clearNode(ctx);
  clearNode(ctx);
  assert.equal(ctx.director.node.location.sceneId, 'shibuya', 'the campaign moved on');

  // The player wanders off to Athens by hand.
  ctx.director.stop();
  ctx.world.sceneId = 'acropolis';
  assert.equal(ctx.director.state, STATE.IDLE);

  const movesBefore = ctx.streetView.moves.length;
  ctx.director.resume();
  assert.equal(ctx.streetView.moves.length, movesBefore + 1,
    'resuming pays for one move, back to where the campaign was');
  assert.equal(ctx.world.sceneId, 'shibuya', 'and the world follows');
  assert.equal(ctx.director.index, 2, 'the node is exactly the one that was left');
});

test('resuming in place costs nothing', () => {
  const ctx = makeDirector();
  ctx.director.start({ resume: false });
  const moves = ctx.streetView.moves.length;
  assert.equal(moves, 0, 'booting at the first node is already in the right place');

  ctx.director.stop();
  ctx.director.resume();
  assert.equal(ctx.streetView.moves.length, 0, 'and no billed request was made');
});
