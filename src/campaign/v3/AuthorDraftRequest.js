export const AUTHOR_DRAFT_LIMITS = Object.freeze({
  briefCharacters: 4000,
  sourceSummaryCharacters: 1200,
  sourceSummaries: 16,
  shortReferenceCharacters: 500,
  shortReferences: 8,
});

export function authorDraftRequestError(value) {
  if (!value || typeof value.brief !== 'object' || Array.isArray(value.brief) ||
      JSON.stringify(value.brief).length > AUTHOR_DRAFT_LIMITS.briefCharacters) {
    return 'invalid-structured-brief';
  }
  if (!Array.isArray(value.sourceSummaries) ||
      value.sourceSummaries.length > AUTHOR_DRAFT_LIMITS.sourceSummaries ||
      value.sourceSummaries.some((item) => typeof item !== 'string' ||
        item.length > AUTHOR_DRAFT_LIMITS.sourceSummaryCharacters)) {
    return 'invalid-source-summaries';
  }
  if (!Array.isArray(value.shortReferences) ||
      value.shortReferences.length > AUTHOR_DRAFT_LIMITS.shortReferences ||
      value.shortReferences.some((item) => typeof item !== 'string' ||
        item.length > AUTHOR_DRAFT_LIMITS.shortReferenceCharacters)) {
    return 'references-must-be-short';
  }
  return null;
}
