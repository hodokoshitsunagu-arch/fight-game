const DATE = /^\d{4}-\d{2}-\d{2}$/;

function targetErrors(node) {
  const target = node.streetViewTarget;
  if (!target || !Number.isFinite(target.position?.lat) || !Number.isFinite(target.position?.lng)) {
    return [`node ${node.id} has no semantic Street View position`];
  }
  const errors = [];
  if (!Number.isFinite(target.radiusMetres) || target.radiusMetres <= 0) {
    errors.push(`node ${node.id} has an invalid Street View range`);
  }
  if (!Number.isFinite(target.heading) || !Number.isFinite(target.headingTolerance)) {
    errors.push(`node ${node.id} has an invalid Street View heading`);
  }
  if ('pano' in target || 'panoramaId' in target) {
    errors.push(`node ${node.id} persists a prohibited panorama id`);
  }
  return errors;
}

export function validateAdventurePackage(adventurePackage, { level = 'development' } = {}) {
  const errors = [];
  if (adventurePackage?.schemaVersion !== 1) errors.push('unsupported package schema version');
  if (!adventurePackage?.id || !adventurePackage?.version) errors.push('package id and version are required');

  const nodes = adventurePackage?.graph?.nodes ?? [];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const sourceIds = new Set((adventurePackage?.sources ?? []).map((source) => source.id));
  const evidenceIds = new Set((adventurePackage?.evidence ?? []).map((item) => item.id));
  if (nodeIds.size !== nodes.length) errors.push('anchor ids must be unique');
  if (!nodeIds.has(adventurePackage?.graph?.startNodeId)) errors.push('graph start node is missing');

  for (const source of adventurePackage?.sources ?? []) {
    if (!source.id || !source.institution || !source.title ||
        !source.url?.startsWith('https://') || !DATE.test(source.verified ?? '')) {
      errors.push(`source ${source.id ?? '<missing>'} is incomplete`);
    }
  }
  for (const evidence of adventurePackage?.evidence ?? []) {
    if (!evidence.sourceRefs?.length || evidence.sourceRefs.some((id) => !sourceIds.has(id))) {
      errors.push(`evidence ${evidence.id} has invalid source references`);
    }
  }
  for (const node of nodes) {
    errors.push(...targetErrors(node));
    if (!node.fact || !node.fantasy) errors.push(`node ${node.id} must separate fact and fantasy`);
    if (!node.sourceRefs?.length || node.sourceRefs.some((id) => !sourceIds.has(id))) {
      errors.push(`node ${node.id} has invalid source references`);
    }
    if (!node.interaction?.actions?.length) errors.push(`node ${node.id} has no semantic input`);
    if (!node.fallback?.id) errors.push(`node ${node.id} has no deterministic fallback`);
    for (const id of [
      ...(node.interaction?.requiresEvidence ?? []),
      ...(node.interaction?.grantsEvidence ?? []),
    ]) {
      if (!evidenceIds.has(id)) errors.push(`node ${node.id} references unknown evidence ${id}`);
    }
  }
  for (const edge of adventurePackage?.graph?.edges ?? []) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) errors.push('graph edge references an unknown node');
  }

  if (level === 'production') {
    if (nodes.length !== 36) errors.push('production packages require exactly 36 anchors');
    if (adventurePackage?.status !== 'release') errors.push('production packages must have release status');
  } else if (level !== 'development') {
    errors.push(`unknown validation level ${level}`);
  }
  return errors;
}
