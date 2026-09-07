import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CITY_CHAPTERS,
  INTERACTION_SEQUENCE,
  TOTAL_CULTURAL_ANCHORS,
  sourcesForAnchor,
  unlockedForChapter,
  validateCityChapters
} from '../src/campaign/cityChapters.js';
import {
  CULTURAL_SAVE_KEY,
  LEGACY_SAVE_KEY,
  freshCulturalProgress,
  loadCulturalProgress,
  migrateLegacyProgress,
  normalizeCulturalProgress,
  saveCulturalProgress
} from '../src/campaign/CulturalCampaignSave.js';
import { gradeInteraction, hintFor, navigationBrief } from '../src/campaign/InteractionRegistry.js';
import { CULTURAL_STATE, CulturalCampaignDirector } from '../src/campaign/CulturalCampaignDirector.js';

class MemoryStorage {
  constructor(entries = {}) { this.data = new Map(Object.entries(entries)); }
  getItem(key) { return this.data.get(key) ?? null; }
  setItem(key, value) { this.data.set(key, value); }
  removeItem(key) { this.data.delete(key); }
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('v2 content is ten ordered cities with eighty unique, traceable anchors', () => {
  assert.equal(validateCityChapters().length, 0);
  assert.equal(CITY_CHAPTERS.length, 10);
  assert.equal(TOTAL_CULTURAL_ANCHORS, 80);
  assert.equal(new Set(CITY_CHAPTERS.flatMap((chapter) => chapter.anchors.map((anchor) => anchor.id))).size, 80);
  for (const chapter of CITY_CHAPTERS) {
    assert.equal(chapter.anchors.length, 8);
    assert.deepEqual(chapter.anchors.map((anchor) => anchor.interaction.type), INTERACTION_SEQUENCE);
    assert.ok(!('phrases' in chapter));
    assert.ok(!('language' in chapter));
    assert.ok(chapter.anchors.every((anchor) => anchor.interaction.type !== 'language'));
    assert.ok(chapter.sources.every((source) => source.url.startsWith('https://')));
    assert.ok(chapter.sources.every((source) => /^\d{4}-\d{2}-\d{2}$/.test(source.verified)));
    assert.ok(chapter.anchors.every((anchor) => sourcesForAnchor(chapter, anchor).length > 0));
    assert.ok(chapter.anchors.every((anchor) => anchor.routeStatus === 'needs-live-check'));
    assert.ok(chapter.anchors
      .filter((anchor) => ['combat', 'boss'].includes(anchor.interaction.type))
      .every((anchor) => anchor.interaction.count <= 2 && anchor.interaction.followUp?.type));
  }
});

test('content validation rejects missing, unknown, and incomplete fact source references', () => {
  const missingRef = structuredClone(CITY_CHAPTERS);
  missingRef[0].anchors[0].sourceRefs = [];
  assert.ok(validateCityChapters(missingRef).some((error) => /missing source refs/.test(error)));

  const unknownRef = structuredClone(CITY_CHAPTERS);
  unknownRef[0].anchors[0].sourceRefs = ['retired-source'];
  assert.ok(validateCityChapters(unknownRef).some((error) => /unknown source ref retired-source/.test(error)));

  const incompleteSource = structuredClone(CITY_CHAPTERS);
  incompleteSource[0].sources[0].verified = '';
  assert.ok(validateCityChapters(incompleteSource).some((error) => /invalid source/.test(error)));

  for (const sourcePatch of [
    { institution: '   ' },
    { url: 'https://' },
    { verified: '2026-99-99' },
  ]) {
    const invalidSource = structuredClone(CITY_CHAPTERS);
    Object.assign(invalidSource[0].sources[0], sourcePatch);
    assert.ok(validateCityChapters(invalidSource).some((error) => /invalid source/.test(error)));
  }
});

test('a historical claim resolves only the sources named by its anchor', () => {
  const chapter = structuredClone(CITY_CHAPTERS[0]);
  const secondSource = { ...chapter.sources[0], id: 'second-source', title: 'Second source' };
  chapter.sources.push(secondSource);
  chapter.anchors[0].sourceRefs = [secondSource.id];
  assert.deepEqual(sourcesForAnchor(chapter, chapter.anchors[0]), [secondSource]);
});

test('unreviewed cultural figures resolve to abstract anomalies in combat data and text', () => {
  for (const chapter of CITY_CHAPTERS.filter((item) => item.legend.status !== 'reviewed-fictionalised')) {
    for (const anchor of chapter.anchors.filter((item) => ['combat', 'boss'].includes(item.interaction.type))) {
      const { interaction } = anchor;
      assert.equal(interaction.anomaly.kind, 'abstract');
      assert.equal(interaction.legend, interaction.anomaly.label);
      assert.ok(!interaction.prompt.includes(chapter.legend.description));
      assert.ok(interaction.followUp.choices.every((choice) => !choice.includes(chapter.legend.description)));
    }
  }
});

test('the existing two-cities-per-tier spell curve is preserved', () => {
  assert.equal(unlockedForChapter(0).length, 2);
  assert.equal(unlockedForChapter(1).length, 2);
  assert.equal(unlockedForChapter(2).length, 4);
  assert.equal(unlockedForChapter(9).length, 12);
});

test('legacy saves migrate to the first anchor of their current city', () => {
  const migrated = migrateLegacyProgress({ index: 9, shards: 9 });
  const chapter = CITY_CHAPTERS.find((item) => item.id === migrated.chapterId);
  assert.equal(migrated.version, 2);
  assert.equal(migrated.anchorId, chapter.anchors[0].id);
  assert.equal(migrated.relicFragments, 9);
  assert.ok(migrated.completedChapters.every((id) => CITY_CHAPTERS.indexOf(chapter) > CITY_CHAPTERS.findIndex((item) => item.id === id)));
});

test('v2 persistence survives unavailable storage and takes precedence over v1', () => {
  assert.doesNotThrow(() => loadCulturalProgress({ getItem() { throw new Error('blocked'); } }));
  assert.equal(saveCulturalProgress({}, { setItem() { throw new Error('full'); } }), false);

  const storage = new MemoryStorage({ [LEGACY_SAVE_KEY]: JSON.stringify({ index: 4, shards: 3 }) });
  const migrated = loadCulturalProgress(storage);
  saveCulturalProgress({ ...migrated, mastery: 7 }, storage);
  assert.equal(JSON.parse(storage.getItem(CULTURAL_SAVE_KEY)).mastery, 7);
  assert.equal(loadCulturalProgress(storage).mastery, 7);
  assert.ok(!('languageProgress' in loadCulturalProgress(storage)));
});

test('a throwing localStorage getter is non-blocking at every persistence entry point', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() { throw new Error('storage access denied'); },
  });
  try {
    assert.doesNotThrow(() => loadCulturalProgress());
    assert.equal(saveCulturalProgress(freshCulturalProgress()), false);
    assert.doesNotThrow(() => new CulturalCampaignDirector());
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  }
});

test('v2 choices are deeply copied and obsolete content ids fall back deterministically', () => {
  const chapter = CITY_CHAPTERS[0];
  const dialogue = chapter.anchors.find((anchor) => anchor.interaction.type === 'dialogue');
  const input = {
    ...freshCulturalProgress(),
    chapterId: chapter.id,
    anchorId: 'retired-anchor',
    completedChapters: ['retired-chapter', CITY_CHAPTERS[1].id],
    choices: {
      [chapter.id]: {
        anchorId: dialogue.id,
        choiceId: dialogue.interaction.choices[0].id,
        effect: 'retired-effect',
      },
      'retired-chapter': { anchorId: 'gone', choiceId: 'gone', effect: 'gone' },
    },
  };

  const normalized = normalizeCulturalProgress(input);
  assert.equal(normalized.anchorId, chapter.anchors[0].id);
  assert.deepEqual(normalized.completedChapters, [CITY_CHAPTERS[1].id]);
  assert.deepEqual(normalized.choices, {
    [chapter.id]: {
      anchorId: dialogue.id,
      choiceId: dialogue.interaction.choices[0].id,
      effect: dialogue.interaction.choices[0].effect,
    },
  });
  assert.notEqual(normalized.choices[chapter.id], input.choices[chapter.id]);
  input.choices[chapter.id].choiceId = 'mutated-after-normalize';
  assert.equal(normalized.choices[chapter.id].choiceId, dialogue.interaction.choices[0].id);

  input.choices[chapter.id].choiceId = 'retired-choice';
  assert.deepEqual(normalizeCulturalProgress(input).choices, {});

  const retiredChapter = {
    ...input,
    chapterId: 'retired-chapter',
    mastery: 7,
    relicFragments: 9,
    choices: {
      [chapter.id]: {
        anchorId: dialogue.id,
        choiceId: dialogue.interaction.choices[0].id,
      },
    },
  };
  const chapterFallback = normalizeCulturalProgress(retiredChapter);
  assert.equal(chapterFallback.chapterId, CITY_CHAPTERS[0].id);
  assert.equal(chapterFallback.anchorId, CITY_CHAPTERS[0].anchors[0].id);
  assert.equal(chapterFallback.mastery, 7);
  assert.equal(chapterFallback.relicFragments, 9);
  assert.equal(chapterFallback.choices[chapter.id].choiceId, dialogue.interaction.choices[0].id);
});

test('the registry accepts dialogue branches and deterministically grades tasks', () => {
  const dialogue = CITY_CHAPTERS[0].anchors[1].interaction;
  assert.deepEqual(gradeInteraction(dialogue, 'listen'), {
    accepted: true, correct: true, choiceId: 'listen', effect: 'insight'
  });
  const quiz = CITY_CHAPTERS[0].anchors[4].interaction;
  assert.equal(gradeInteraction(quiz, '0').correct, true);
  assert.equal(gradeInteraction(quiz, '1').correct, false);
  assert.match(hintFor(quiz, 3, 'fact'), /已解除阻塞/);
});

test('every transition names its movement and the next task before navigation', () => {
  for (const chapter of CITY_CHAPTERS) {
    chapter.anchors.forEach((anchor, index) => {
      const brief = navigationBrief(anchor, index ? chapter.anchors[index - 1] : null);
      assert.match(brief.movement, new RegExp(anchor.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.match(brief.nextTask, /^下一步：/);
      assert.ok(brief.nextTask.includes(anchor.interaction.prompt));
      if (anchor.transition === 'walk' && index) assert.match(brief.movement, /街景链接/);
      else assert.match(brief.movement, /抵达|转场/);
    });
  }
});

test('navigation failure enters the interaction instead of stranding the chapter', async () => {
  const hud = { setLevel() {}, setProgress() {}, setObjective() {}, setHint() {}, showCard() {}, hideCard() {} };
  const director = new CulturalCampaignDirector({
    scenes: [], hud,
    storage: new MemoryStorage(),
    streetView: { async moveToAnchor() { return { ok: false, reason: 'no-link' }; } }
  });
  director.start({ resume: false });
  await flush();
  assert.equal(director.state, CULTURAL_STATE.INTRO);
  director.update(99);
  assert.equal(director.state, CULTURAL_STATE.INTERACTING);
  assert.equal(director.submit('collect'), true);
  assert.equal(director.state, CULTURAL_STATE.RESOLVING);
});

test('three wrong answers reveal the answer and never lock a chapter', async () => {
  const source = CITY_CHAPTERS[0];
  const chapter = { ...source, anchors: [{ ...source.anchors[4], order: 1 }] };
  const hints = [];
  const director = new CulturalCampaignDirector({
    chapters: [chapter], storage: new MemoryStorage(),
    hud: {
      setLevel() {}, setProgress() {}, setObjective() {}, showCard() {}, hideCard() {}, showBeat() {},
      setHint(value) { hints.push(value); }, flashHint() {}
    },
    streetView: { async moveToAnchor() { return { ok: true, mode: 'coordinate' }; } }
  });
  director.start({ resume: false });
  await flush();
  director.update(99);
  director.submit('1');
  director.submit('1');
  director.submit('1');
  assert.equal(director.state, CULTURAL_STATE.RESOLVING);
  assert.equal(director.progressData.hintsUsed, 3);
  assert.match(hints.at(-1), /已解除阻塞/);
});

test('a chapter-local listening choice reduces the later elite wave', () => {
  const chapter = CITY_CHAPTERS[0];
  const waves = [];
  const director = new CulturalCampaignDirector({
    dummies: { startWave(wave) { waves.push(wave); } },
    chapters: [chapter], storage: new MemoryStorage(),
    hud: { setObjective() {}, setHint() {}, hideCard() {} }
  });
  director.chapterIndex = 0;
  director.anchorIndex = 6;
  director.progressData.choices[chapter.id] = { effect: 'insight' };
  director._beginInteraction();
  assert.equal(waves[0].count, chapter.anchors[6].interaction.count - 1);
  assert.equal(director.state, CULTURAL_STATE.COMBAT);
});

test('combat can be safely skipped but its location puzzle still gates advancement', async () => {
  let stopped = 0;
  const chapter = CITY_CHAPTERS[0];
  const director = new CulturalCampaignDirector({
    dummies: { startWave() {}, stop() { stopped++; }, enemies: { aliveCount: 2 }, pending: [], quota: 0 },
    chapters: [chapter], storage: new MemoryStorage(),
    hud: { setObjective() {}, setHint() {}, hideCard() {}, showBeat() {} }
  });
  director.anchorIndex = 2;
  director._beginInteraction();
  const mastery = director.progressData.mastery;
  assert.equal(director.skipCombat(), true);
  assert.equal(stopped, 1);
  assert.equal(director.progressData.mastery, mastery);
  assert.equal(director.progressData.hintsUsed, 1);
  assert.equal(director.state, CULTURAL_STATE.INTERACTING);
  assert.equal(director.anchorIndex, 2);
  assert.equal(director.submit('0'), true);
  assert.equal(director.progressData.mastery, mastery + 1);
  assert.equal(director.state, CULTURAL_STATE.RESOLVING);
  director.update(99);
  await flush();
  assert.equal(director.anchorIndex, 3);
});

test('resuming from free roam stops its endless wave before non-combat UI', async () => {
  let stopped = 0;
  const director = new CulturalCampaignDirector({
    dummies: { stop() { stopped++; } },
    storage: new MemoryStorage(),
    streetView: { async moveToAnchor() { return { ok: true, mode: 'coordinate' }; } },
    hud: { setLevel() {}, setProgress() {}, setObjective() {}, setHint() {}, showCard() {} }
  });
  director.resume();
  await flush();
  assert.equal(stopped, 1);
  assert.equal(director.state, CULTURAL_STATE.INTRO);
});

test('both dialogue branches converge at the next city after anchor eight', () => {
  for (const effect of ['insight', 'momentum']) {
    const director = new CulturalCampaignDirector({ storage: new MemoryStorage() });
    director.chapterIndex = 0;
    director.anchorIndex = 7;
    director.progressData.choices['new-york'] = { effect };
    director._advance();
    assert.equal(director.chapter.id, 'tokyo');
    assert.equal(director.anchorIndex, 0);
    assert.equal(director.state, CULTURAL_STATE.CROSSING);
    assert.ok(director.progressData.completedChapters.includes('new-york'));
  }
});
