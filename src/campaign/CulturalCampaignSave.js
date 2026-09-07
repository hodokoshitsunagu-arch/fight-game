import { CITY_CHAPTERS, CULTURAL_CAMPAIGN_VERSION } from './cityChapters.js';
import { LEVELS, flattenNodes } from './campaign.js';

export const CULTURAL_SAVE_KEY = 'relic.campaign.v2.progress';
export const LEGACY_SAVE_KEY = 'relic.campaign.progress';

export function freshCulturalProgress(chapters = CITY_CHAPTERS) {
  const first = chapters[0];
  return {
    version: CULTURAL_CAMPAIGN_VERSION,
    chapterId: first?.id ?? null,
    anchorId: first?.anchors?.[0]?.id ?? null,
    completedChapters: [],
    choices: {},
    mastery: 0,
    hintsUsed: 0,
    relicFragments: 0
  };
}

function safeParse(value) {
  if (!value || typeof value !== 'string') return null;
  try { return JSON.parse(value); } catch { return null; }
}

function defaultStorage() {
  try { return globalThis.localStorage; } catch { return null; }
}

function normalizeChoices(value, chapters) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const normalized = {};
  for (const chapter of chapters) {
    const saved = value[chapter.id];
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) continue;
    const dialogueAnchors = chapter.anchors.filter((anchor) => anchor.interaction.type === 'dialogue');
    const anchor = dialogueAnchors.find((item) => item.id === saved.anchorId) ?? dialogueAnchors[0];
    const choice = anchor?.interaction.choices?.find((item) => item.id === saved.choiceId);
    if (!anchor || !choice) continue;
    normalized[chapter.id] = {
      anchorId: anchor.id,
      choiceId: choice.id,
      effect: choice.effect,
    };
  }
  return normalized;
}

export function normalizeCulturalProgress(value, chapters = CITY_CHAPTERS) {
  const fallback = freshCulturalProgress(chapters);
  if (!value || value.version !== CULTURAL_CAMPAIGN_VERSION) return fallback;

  const savedChapterIndex = chapters.findIndex((chapter) => chapter.id === value.chapterId);
  const chapterIndex = Math.max(0, savedChapterIndex);
  const chapter = chapters[chapterIndex];
  const anchor = savedChapterIndex < 0
    ? chapter.anchors[0]
    : chapter.anchors.find((item) => item.id === value.anchorId) ?? chapter.anchors[0];
  const validChapterIds = new Set(chapters.map((item) => item.id));

  return {
    ...fallback,
    chapterId: chapter.id,
    anchorId: anchor.id,
    completedChapters: Array.isArray(value.completedChapters)
      ? [...new Set(value.completedChapters.filter((id) => validChapterIds.has(id) && id !== chapter.id))]
      : [],
    choices: normalizeChoices(value.choices, chapters),
    mastery: Math.max(0, Number(value.mastery) || 0),
    hintsUsed: Math.max(0, Number(value.hintsUsed) || 0),
    relicFragments: Math.max(0, Number(value.relicFragments) || 0)
  };
}

/**
 * Move a v1 node save to the beginning of the city containing that node.
 * Completed cities stay complete and the old shard count remains visible as a
 * lifetime collection total. Starting the current city from its first anchor
 * avoids pretending the new interaction sequence maps one-to-one to old fights.
 */
export function migrateLegacyProgress(value, chapters = CITY_CHAPTERS, levels = LEVELS) {
  const migrated = freshCulturalProgress(chapters);
  if (!value || !Number.isFinite(Number(value.index))) return migrated;

  const oldNodes = flattenNodes(levels);
  const oldIndex = Math.min(Math.max(0, Math.floor(Number(value.index))), Math.max(0, oldNodes.length - 1));
  const sceneId = oldNodes[oldIndex]?.location?.sceneId;
  const chapterIndex = Math.max(0, chapters.findIndex((chapter) => chapter.sceneId === sceneId));
  const chapter = chapters[chapterIndex] ?? chapters[0];

  migrated.chapterId = chapter?.id ?? null;
  migrated.anchorId = chapter?.anchors?.[0]?.id ?? null;
  migrated.completedChapters = chapters.slice(0, chapterIndex).map((item) => item.id);
  migrated.relicFragments = Math.max(0, Number(value.shards) || 0);
  return migrated;
}

export function loadCulturalProgress(storage, chapters = CITY_CHAPTERS) {
  try {
    const target = storage === undefined ? defaultStorage() : storage;
    const current = safeParse(target?.getItem?.(CULTURAL_SAVE_KEY));
    if (current) return normalizeCulturalProgress(current, chapters);
    const legacy = safeParse(target?.getItem?.(LEGACY_SAVE_KEY));
    return legacy ? migrateLegacyProgress(legacy, chapters) : freshCulturalProgress(chapters);
  } catch {
    return freshCulturalProgress(chapters);
  }
}

export function saveCulturalProgress(progress, storage, chapters = CITY_CHAPTERS) {
  try {
    const target = storage === undefined ? defaultStorage() : storage;
    if (!target?.setItem) return false;
    target.setItem(CULTURAL_SAVE_KEY, JSON.stringify(normalizeCulturalProgress(progress, chapters)));
    return true;
  } catch {
    return false;
  }
}

export function clearCulturalProgress(storage) {
  try {
    const target = storage === undefined ? defaultStorage() : storage;
    if (!target?.removeItem) return false;
    target.removeItem(CULTURAL_SAVE_KEY);
    return true;
  } catch {
    return false;
  }
}
