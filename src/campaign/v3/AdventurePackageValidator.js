const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SEGMENTS = new Set(['shared-opening', 'case', 'final-reasoning']);
const TRANSITIONS = new Set(['coordinate', 'walk', 'narrative']);
const FALLBACK_MODES = new Set([
  'continue-with-authored-context',
  'skip-with-authored-summary',
  'retry-then-continue',
]);
const FORBIDDEN_STREET_VIEW_KEYS = new Set([
  'pano', 'panoramaId', 'pixelHotspot', 'pixelHotspots', 'googleImagery',
]);

function diagnostic(code, path, message) {
  return { code, path, message };
}

function scan(value, visit, path = '$') {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => scan(item, visit, `${path}.${index}`));
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    visit(key, item, `${path}.${key}`);
    scan(item, visit, `${path}.${key}`);
  }
}

function targetDiagnostics(node, path, { production }) {
  const target = node.streetViewTarget;
  if (!target || !Number.isFinite(target.position?.lat) || !Number.isFinite(target.position?.lng)) {
    return [diagnostic('street-view.position.invalid', `${path}.streetViewTarget.position`,
      `node ${node.id} has no semantic Street View position`)];
  }
  const diagnostics = [];
  if (!Number.isFinite(target.radiusMetres) || target.radiusMetres <= 0) {
    diagnostics.push(diagnostic('street-view.range.invalid', `${path}.streetViewTarget.radiusMetres`,
      `node ${node.id} has an invalid Street View range`));
  }
  if (!Number.isFinite(target.heading) || !Number.isFinite(target.headingTolerance)) {
    diagnostics.push(diagnostic('street-view.heading.invalid', `${path}.streetViewTarget.heading`,
      `node ${node.id} has an invalid Street View heading`));
  }
  if (production) {
    if (!Number.isFinite(target.pitch) || !Number.isFinite(target.pitchTolerance)) {
      diagnostics.push(diagnostic('street-view.pitch.invalid', `${path}.streetViewTarget.pitch`,
        `node ${node.id} has an invalid Street View pitch calibration`));
    }
    if (!target.roadRelationship) diagnostics.push(diagnostic(
      'street-view.road-relationship.missing', `${path}.streetViewTarget.roadRelationship`,
      `node ${node.id} has no authored road relationship`,
    ));
    if (!TRANSITIONS.has(target.transition)) diagnostics.push(diagnostic(
      'street-view.transition.invalid', `${path}.streetViewTarget.transition`,
      `node ${node.id} has an invalid transition behavior`,
    ));
    if (target.routeStatus !== 'verified') diagnostics.push(diagnostic(
      'street-view.acceptance.pending', `${path}.streetViewTarget.routeStatus`,
      `node ${node.id} still requires human Street View acceptance`,
    ));
  }
  return diagnostics;
}

function reachableFrom(startNodeId, edges) {
  const next = new Map();
  for (const edge of edges) {
    const destinations = next.get(edge.from) ?? [];
    destinations.push(edge.to);
    next.set(edge.from, destinations);
  }
  const seen = new Set();
  const pending = startNodeId ? [startNodeId] : [];
  while (pending.length) {
    const nodeId = pending.pop();
    if (seen.has(nodeId)) continue;
    seen.add(nodeId);
    pending.push(...(next.get(nodeId) ?? []));
  }
  return seen;
}

function canReachFinal(nodes, edges) {
  const finalIds = new Set(nodes
    .filter((node) => node.segment === 'final-reasoning')
    .map((node) => node.id));
  const previous = new Map();
  for (const edge of edges) {
    const origins = previous.get(edge.to) ?? [];
    origins.push(edge.from);
    previous.set(edge.to, origins);
  }
  const seen = new Set();
  const pending = [...finalIds];
  while (pending.length) {
    const nodeId = pending.pop();
    if (seen.has(nodeId)) continue;
    seen.add(nodeId);
    pending.push(...(previous.get(nodeId) ?? []));
  }
  return seen;
}

function participantDiagnostics(rules, { production }) {
  if (!rules) return production
    ? [diagnostic('participants.invalid', '$.participantRules',
        'production packages require participant rules')]
    : [];
  const diagnostics = [];
  if (!Number.isInteger(rules.min) || !Number.isInteger(rules.max) ||
      rules.min !== 1 || rules.max !== 4) {
    diagnostics.push(diagnostic('participants.invalid', '$.participantRules',
      'participant rules must support exactly 1–4 participants'));
  }
  if (production) {
    const roles = new Set(rules.combatRoles ?? []);
    if (roles.size !== 4 || ![1, 2, 3].every((count) => rules.roleAssignments?.[count])) {
      diagnostics.push(diagnostic('participants.roles.invalid', '$.participantRules.combatRoles',
        'participant rules must define four combat roles and 1–3 player role assignments'));
    }
    if (rules.voting?.visibility !== 'public' || !rules.voting?.tieBreak?.length) {
      diagnostics.push(diagnostic('participants.voting.invalid', '$.participantRules.voting',
        'participant rules must define public voting and deterministic tie breaks'));
    }
  }
  return diagnostics;
}

function routeShapeDiagnostics(adventurePackage, nodes) {
  const diagnostics = [];
  const counts = nodes.reduce((result, node) => {
    result[node.segment] = (result[node.segment] ?? 0) + 1;
    return result;
  }, {});
  if (nodes.length !== 36) diagnostics.push(diagnostic(
    'route.anchor-count', '$.graph.nodes', 'production packages require exactly 36 anchors',
  ));
  if (counts['shared-opening'] !== 3 || counts.case !== 30 || counts['final-reasoning'] !== 3) {
    diagnostics.push(diagnostic('route.segment-shape', '$.graph.nodes',
      'production route shape requires 3 shared-opening, 30 case, and 3 final-reasoning anchors'));
  }
  if ((adventurePackage.cases ?? []).length !== 3) diagnostics.push(diagnostic(
    'route.case-count', '$.cases', 'production packages require exactly three cases',
  ));
  for (const item of adventurePackage.cases ?? []) {
    const count = nodes.filter((node) => node.caseId === item.id).length;
    if (count !== 10) diagnostics.push(diagnostic(
      'route.case-shape', '$.graph.nodes', `case ${item.id} requires exactly 10 anchors`,
    ));
  }
  return diagnostics;
}

export function validateAdventurePackageDetailed(adventurePackage, { level = 'development' } = {}) {
  const diagnostics = [];
  const production = level === 'production';
  if (!['development', 'production'].includes(level)) {
    return [diagnostic('profile.unknown', '$', `unknown validation level ${level}`)];
  }
  if (adventurePackage?.schemaVersion !== 1) diagnostics.push(diagnostic(
    'schema.unsupported', '$.schemaVersion', 'unsupported package schema version',
  ));
  if (!adventurePackage?.id || !adventurePackage?.version) diagnostics.push(diagnostic(
    'package.identity.missing', '$', 'package id and version are required',
  ));

  scan(adventurePackage, (key, value, path) => {
    if (FORBIDDEN_STREET_VIEW_KEYS.has(key)) diagnostics.push(diagnostic(
      'street-view.forbidden-field', path,
      `${path} persists prohibited Google imagery, panorama, or pixel data`,
    ));
    if (production && key === 'provenance' && value?.kind === 'ai-draft' &&
        (value.reviewStatus !== 'human-accepted' || value.humanEdited !== true)) {
      diagnostics.push(diagnostic('ai.unreviewed', path,
        `${path} contains an AI draft that has not been accepted by a human`));
    }
  });

  const nodes = adventurePackage?.graph?.nodes ?? [];
  const edges = adventurePackage?.graph?.edges ?? [];
  const endings = adventurePackage?.endings ?? [];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const caseIds = new Set((adventurePackage?.cases ?? []).map((item) => item.id));
  const sourceIds = new Set((adventurePackage?.sources ?? []).map((source) => source.id));
  const evidenceIds = new Set((adventurePackage?.evidence ?? []).map((item) => item.id));
  if (nodeIds.size !== nodes.length) diagnostics.push(diagnostic(
    'graph.node-id.duplicate', '$.graph.nodes', 'anchor ids must be unique',
  ));
  if (!nodeIds.has(adventurePackage?.graph?.startNodeId)) diagnostics.push(diagnostic(
    'graph.start.missing', '$.graph.startNodeId', 'graph start node is missing',
  ));

  for (const [index, source] of (adventurePackage?.sources ?? []).entries()) {
    if (!source.id || !source.institution || !source.title ||
        !source.url?.startsWith('https://') || !DATE.test(source.verified ?? '')) {
      diagnostics.push(diagnostic('source.incomplete', `$.sources.${index}`,
        `source ${source.id ?? '<missing>'} is incomplete`));
    }
  }
  for (const [index, evidence] of (adventurePackage?.evidence ?? []).entries()) {
    if (!evidence.sourceRefs?.length || evidence.sourceRefs.some((id) => !sourceIds.has(id))) {
      diagnostics.push(diagnostic('reference.source.unknown', `$.evidence.${index}.sourceRefs`,
        `evidence ${evidence.id} has invalid source references`));
    }
  }
  for (const [index, node] of nodes.entries()) {
    const path = `$.graph.nodes.${index}`;
    diagnostics.push(...targetDiagnostics(node, path, { production }));
    if (!SEGMENTS.has(node.segment)) diagnostics.push(diagnostic(
      'graph.segment.invalid', `${path}.segment`, `node ${node.id} has an invalid story segment`,
    ));
    if (node.segment === 'case' && !caseIds.has(node.caseId)) diagnostics.push(diagnostic(
      'reference.case.unknown', `${path}.caseId`, `node ${node.id} references an unknown case`,
    ));
    if (!node.fact || !node.fantasy) diagnostics.push(diagnostic(
      'content.fact-fantasy.missing', path, `node ${node.id} must separate fact and fantasy`,
    ));
    if (!node.sourceRefs?.length || node.sourceRefs.some((id) => !sourceIds.has(id))) {
      diagnostics.push(diagnostic('reference.source.unknown', `${path}.sourceRefs`,
        `node ${node.id} has invalid source references`));
    }
    if (!node.interaction?.actions?.length) diagnostics.push(diagnostic(
      'interaction.missing', `${path}.interaction`, `node ${node.id} has no semantic input`,
    ));
    if (node.interaction?.type === 'combat' && node.interaction.enemyCount > 2) {
      diagnostics.push(diagnostic('combat.too-many-enemies', `${path}.interaction.enemyCount`,
        `node ${node.id} exceeds the two-enemy combat limit`));
    }
    if (production && node.interaction?.type === 'combat' &&
        node.interaction.opponentKind !== 'abstract-anomaly') {
      diagnostics.push(diagnostic('culture.enemy-treatment.unsafe', `${path}.interaction.opponentKind`,
        `node ${node.id} combat must use an abstract anomaly, not a real cultural group`));
    }
    if (!node.fallback?.id) diagnostics.push(diagnostic(
      'fallback.missing', `${path}.fallback`, `node ${node.id} has no deterministic fallback`,
    ));
    const fallbackCanBlock = node.fallback?.id && (
      !FALLBACK_MODES.has(node.fallback.mode) ||
      node.fallback.unblocks === false ||
      (production && node.fallback.unblocks !== true)
    );
    if (fallbackCanBlock) {
      diagnostics.push(diagnostic('fallback.blocking', `${path}.fallback`,
        `node ${node.id} does not guarantee deterministic unblocking`));
    }
    if (node.culturalStatus === 'blocked') diagnostics.push(diagnostic(
      'culture.unsafe', `${path}.culturalStatus`,
      `node ${node.id} is blocked by cultural review`,
    ));
    else if (production && node.culturalStatus !== 'approved') diagnostics.push(diagnostic(
      'culture.review.pending', `${path}.culturalStatus`,
      `node ${node.id} has not passed human cultural review`,
    ));
    for (const id of [
      ...(node.interaction?.requiresEvidence ?? []),
      ...(node.interaction?.grantsEvidence ?? []),
    ]) {
      if (!evidenceIds.has(id)) diagnostics.push(diagnostic(
        'reference.evidence.unknown', `${path}.interaction`,
        `node ${node.id} references unknown evidence ${id}`,
      ));
    }
  }
  for (const [index, edge] of edges.entries()) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) diagnostics.push(diagnostic(
      'graph.edge.invalid', `$.graph.edges.${index}`, 'graph edge references an unknown node',
    ));
  }

  const reachable = reachableFrom(adventurePackage?.graph?.startNodeId, edges);
  for (const node of nodes) {
    if (!reachable.has(node.id)) diagnostics.push(diagnostic(
      'graph.unreachable', '$.graph.nodes', `node ${node.id} is unreachable from the story start`,
    ));
  }
  const reachesFinal = canReachFinal(nodes, edges);
  for (const node of nodes) {
    if (reachable.has(node.id) && !reachesFinal.has(node.id)) diagnostics.push(diagnostic(
      'graph.ending-unreachable', '$.graph.nodes', `node ${node.id} cannot reach a final reasoning node`,
    ));
  }
  if (!endings.length) diagnostics.push(diagnostic(
    'ending.missing', '$.endings', 'package has no ending',
  ));
  for (const [index, ending] of endings.entries()) {
    if (!caseIds.has(ending.caseId) ||
        (ending.requiresEvidence ?? []).some((id) => !evidenceIds.has(id))) {
      diagnostics.push(diagnostic('ending.reference.invalid', `$.endings.${index}`,
        `ending ${ending.id} has invalid case or evidence references`));
    }
  }

  diagnostics.push(...participantDiagnostics(adventurePackage?.participantRules, { production }));
  if (production) {
    diagnostics.push(...routeShapeDiagnostics(adventurePackage, nodes));
    if (adventurePackage?.status !== 'release') diagnostics.push(diagnostic(
      'package.status.invalid', '$.status', 'production packages must have release status',
    ));
  }
  return diagnostics;
}

export function validateAdventurePackage(adventurePackage, options = {}) {
  return validateAdventurePackageDetailed(adventurePackage, options).map((item) => item.message);
}
