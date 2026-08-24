import test from 'node:test';
import assert from 'node:assert/strict';

import { settings, ELEMENT_META } from '../src/config/settings.js';
import { buildLexicon, fieldsForAxis, colourFields, TRIGGER, AXIS } from '../src/voice/grammar.js';
import { IntentParser } from '../src/voice/IntentParser.js';
import { resolve } from '../src/voice/CastOverrides.js';

const ELEMENTS = Object.keys(ELEMENT_META);

/* ------------------------------------------------------------------ */
/* Grammar                                                             */
/* ------------------------------------------------------------------ */

test('every ability has a trigger token and they are mutually distinct', () => {
  const seen = new Map();
  for (const element of ELEMENTS) {
    const token = TRIGGER[element];
    assert.ok(token, `${element} has a trigger token`);
    assert.equal(seen.has(token), false, `"${token}" is claimed only by ${element}`);
    seen.set(token, element);
  }
});

test('a trigger token resolves to exactly one ability', () => {
  const { spells } = buildLexicon('en-US');
  for (const element of ELEMENTS) {
    assert.equal(spells.get(TRIGGER[element]), element);
  }
});

test('frost and storm never cross-fire', () => {
  const { spells } = buildLexicon('en-US');
  assert.equal(spells.get('frost'), 'ice');
  assert.equal(spells.get('storm'), 'thunder');
  // "lance" is shared by both names and must therefore claim neither.
  assert.equal(spells.get('lance'), undefined, '"lance" is ambiguous and unmapped');
});

test('every ability exposes at least one field on the scale and duration axes', () => {
  for (const element of ELEMENTS) {
    const block = settings[element];
    assert.ok(fieldsForAxis(block, AXIS.SCALE).length > 0, `${element} has scale fields`);
    assert.ok(fieldsForAxis(block, AXIS.DURATION).length > 0, `${element} has duration fields`);
    assert.ok(colourFields(block).length > 0, `${element} has colour fields`);
  }
});

test('axis matchers never select a protected field', () => {
  for (const element of ELEMENTS) {
    const block = settings[element];
    for (const axis of [AXIS.SCALE, AXIS.TEMPO, AXIS.DURATION, AXIS.INTENSITY]) {
      const fields = fieldsForAxis(block, axis);
      assert.equal(fields.includes('cooldown'), false, `${element}/${axis} spares cooldown`);
      assert.equal(fields.includes('minRange'), false, `${element}/${axis} spares minRange`);
    }
  }
});

/* ------------------------------------------------------------------ */
/* Parser                                                              */
/* ------------------------------------------------------------------ */

function capture(parser) {
  const events = { spells: [], modifiers: [] };
  parser.on('spell', (element, carried) => events.spells.push({ element, carried }));
  parser.on('modifier', (m) => events.modifiers.push(m.word));
  return events;
}

test('a bare spell name fires once', () => {
  const parser = new IntentParser();
  const events = capture(parser);
  parser.feed('frost lance', 1);
  assert.deepEqual(events.spells.map((s) => s.element), ['ice']);
});

test('repeated interim transcripts do not re-fire or re-apply', () => {
  const parser = new IntentParser();
  const events = capture(parser);
  // Exactly how Chrome delivers it: the same sentence, growing.
  parser.feed('greater', 1);
  parser.feed('greater frost', 1);
  parser.feed('greater frost lance', 1);
  parser.feed('greater frost lance', 1);
  assert.equal(events.spells.length, 1, 'one cast');
  assert.deepEqual(events.spells[0].carried.map((m) => m.word), ['greater'],
    'the leading modifier arrives with the spell');
  assert.deepEqual(events.modifiers, [], 'and is not also delivered as a late modifier');
});

test('modifiers spoken after the spell name arrive as mid-flight mutations', () => {
  const parser = new IntentParser();
  const events = capture(parser);
  parser.feed('frost', 1);
  assert.equal(events.spells.length, 1, 'fires on the distinguishing token, mid-sentence');
  parser.feed('frost lance crimson', 1);
  assert.deepEqual(events.modifiers, ['crimson']);
});

test('unrecognised speech fires nothing', () => {
  const parser = new IntentParser();
  const events = capture(parser);
  parser.feed('what time is it', 1);
  parser.feed('can you pass me the salt', 1);
  assert.equal(events.spells.length, 0);
  assert.equal(events.modifiers.length, 0);
});

test('low-confidence input is ignored', () => {
  const parser = new IntentParser();
  const events = capture(parser);
  parser.feed('frost lance', settings.voice.confidence - 0.01);
  assert.equal(events.spells.length, 0);
});

test('Chinese transcripts resolve without word boundaries', () => {
  const parser = new IntentParser('zh-CN');
  const events = capture(parser);
  parser.feed('巨大冰霜长枪', 1);
  assert.equal(events.spells.length, 1);
  assert.equal(events.spells[0].element, 'ice');
  assert.deepEqual(events.spells[0].carried.map((m) => m.word), ['巨大']);
});

/* ------------------------------------------------------------------ */
/* Override resolution                                                 */
/* ------------------------------------------------------------------ */

test('greater scales scale-axis fields and nothing else', () => {
  const patch = resolve('ice', [{ axis: AXIS.SCALE, dir: 1, word: 'greater' }]);
  assert.ok(patch.height > settings.ice.height, 'height grew');
  assert.ok(patch.width > settings.ice.width, 'width grew');
  assert.equal(patch.cooldown, undefined, 'cooldown untouched');
  assert.equal(patch.lifetime, undefined, 'duration untouched');
});

test('a patch only ever contains fields the block really has', () => {
  for (const element of ELEMENTS) {
    const patch = resolve(element, [
      { axis: AXIS.SCALE, dir: 1 },
      { axis: AXIS.TEMPO, dir: 1 },
      { axis: AXIS.DURATION, dir: 1 },
      { axis: AXIS.INTENSITY, dir: 1 },
      { axis: AXIS.COLOUR, hue: 0 }
    ]);
    for (const key of Object.keys(patch)) {
      assert.ok(key in settings[element], `${element}.${key} exists on the block`);
      assert.equal(typeof patch[key], typeof settings[element][key], `${element}.${key} keeps its type`);
    }
  }
});

test('counts stay whole and positive', () => {
  const patch = resolve('ice', [{ axis: AXIS.SCALE, dir: -1 }]);
  if ('spikeCount' in patch) {
    assert.equal(Number.isInteger(patch.spikeCount), true);
    assert.ok(patch.spikeCount >= 1);
  }
});

test('no field is pushed beyond its clamp range', () => {
  const cfg = settings.voice;
  const patch = resolve('ice', Array.from({ length: 8 }, () => ({ axis: AXIS.SCALE, dir: 1 })));
  for (const [key, value] of Object.entries(patch)) {
    if (typeof value !== 'number') continue;
    assert.ok(value <= settings.ice[key] * cfg.clampHigh + 1e-6, `${key} within clampHigh`);
  }
});

test('colour rotates the palette instead of flattening it', () => {
  const patch = resolve('ice', [{ axis: AXIS.COLOUR, hue: 0, word: 'crimson' }]);
  const changed = Object.keys(patch);
  assert.ok(changed.length > 1, 'several colour fields moved');
  const values = new Set(changed.map((k) => patch[k]));
  assert.ok(values.size > 1, 'they did not all collapse to one colour');
  for (const key of changed) {
    assert.match(patch[key], /^#[0-9a-f]{6}$/i, `${key} is still a hex colour`);
  }
});

test('resolving does not mutate the shared settings block', () => {
  const before = JSON.stringify(settings.ice);
  resolve('ice', [
    { axis: AXIS.SCALE, dir: 1 },
    { axis: AXIS.COLOUR, hue: 140 },
    { axis: AXIS.INTENSITY, dir: 1 }
  ]);
  assert.equal(JSON.stringify(settings.ice), before);
});

test('modifiers compose onto an existing patch for mid-flight merges', () => {
  const first = resolve('ice', [{ axis: AXIS.SCALE, dir: 1 }]);
  const second = resolve('ice', [{ axis: AXIS.COLOUR, hue: 0 }], first);
  assert.equal(second.height, first.height, 'the earlier modifier survived');
  assert.ok(Object.keys(second).length > Object.keys(first).length, 'and the colour was added');
});
