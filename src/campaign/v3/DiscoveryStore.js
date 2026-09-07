export const DISCOVERY_STORAGE_KEY = 'relic.campaign.v3.discovery';

function emptyRecord(adventurePackage) {
  return {
    version: 1,
    packageId: adventurePackage.id,
    packageVersion: adventurePackage.version,
    completedCaseIds: [],
    endingIds: [],
    cultureCards: [],
  };
}

function defaultStorage() {
  try { return globalThis.localStorage; } catch { return null; }
}

export class DiscoveryStore {
  constructor(storage = defaultStorage()) {
    this.storage = storage;
  }

  load(adventurePackage) {
    const empty = emptyRecord(adventurePackage);
    try {
      const value = JSON.parse(this.storage?.getItem?.(DISCOVERY_STORAGE_KEY) ?? 'null');
      if (value?.version !== 1 || value.packageId !== adventurePackage.id ||
          value.packageVersion !== adventurePackage.version) return empty;
      const cases = new Set(adventurePackage.cases.map((item) => item.id));
      const endings = new Set(adventurePackage.endings.map((item) => item.id));
      return {
        ...empty,
        completedCaseIds: (value.completedCaseIds ?? []).filter((id) => cases.has(id)),
        endingIds: (value.endingIds ?? []).filter((id) => endings.has(id)),
        cultureCards: (value.cultureCards ?? []).filter((card) =>
          card?.id && endings.has(card.endingId)
        ).map((card) => ({ id: card.id, endingId: card.endingId })),
      };
    } catch {
      return empty;
    }
  }

  apply(effect, adventurePackage = null) {
    if (effect?.type !== 'persist-discovery') return false;
    const packageShape = adventurePackage ?? {
      id: effect.packageId,
      version: effect.packageVersion,
      cases: [{ id: effect.caseId }],
      endings: [{ id: effect.endingId }],
    };
    const record = this.load(packageShape);
    record.completedCaseIds = [...new Set([...record.completedCaseIds, effect.caseId])];
    record.endingIds = [...new Set([...record.endingIds, effect.endingId])];
    if (!record.cultureCards.some((card) => card.id === effect.cultureCard.id)) {
      record.cultureCards.push({ ...effect.cultureCard });
    }
    try {
      this.storage?.setItem?.(DISCOVERY_STORAGE_KEY, JSON.stringify(record));
      return Boolean(this.storage?.setItem);
    } catch {
      return false;
    }
  }
}
