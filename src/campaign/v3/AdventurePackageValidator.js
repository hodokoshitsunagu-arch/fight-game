import { analyzeAdventureGraph } from './AdventureGraph.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SEGMENTS = new Set(['shared-opening', 'case', 'final-reasoning']);
const TRANSITIONS = new Set(['coordinate', 'walk', 'narrative']);
const FALLBACK_MODES = new Set([
  'continue-with-authored-context',
  'skip-with-authored-summary',
  'retry-then-continue',
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
    const review = target.reviewEvidence;
    if (review?.method !== 'official-street-view' || !review.reviewer || !review.notes ||
        !Number.isFinite(Date.parse(review.reviewedAt ?? ''))) {
      diagnostics.push(diagnostic(
        'street-view.review-evidence.missing', `${path}.streetViewTarget.reviewEvidence`,
        `node ${node.id} has no auditable official Street View review evidence`,
      ));
    }
  }
  return diagnostics;
}

function isForbiddenStreetViewKey(key) {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return normalized === 'pano' || normalized.includes('panorama') ||
    (normalized.includes('pixel') && normalized.includes('hotspot')) ||
    (normalized.includes('streetview') &&
      (normalized.includes('image') || normalized.includes('imagery'))) ||
    normalized.includes('googleimagery');
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
  const criteria = adventurePackage.releaseCriteria;
  if (!criteria || !Number.isInteger(criteria.anchorCount) || !criteria.segmentCounts ||
      !criteria.caseAnchorCounts) {
    return [diagnostic('route.policy.missing', '$.releaseCriteria',
      'production packages require a city-specific, reviewable route-shape policy')];
  }
  const counts = nodes.reduce((result, node) => {
    result[node.segment] = (result[node.segment] ?? 0) + 1;
    return result;
  }, {});
  if (nodes.length !== criteria.anchorCount) diagnostics.push(diagnostic(
    'route.anchor-count', '$.graph.nodes',
    `production package requires exactly ${criteria.anchorCount} anchors`,
  ));
  for (const [segment, expected] of Object.entries(criteria.segmentCounts)) {
    if (counts[segment] !== expected) diagnostics.push(diagnostic(
      'route.segment-shape', '$.graph.nodes',
      `production route shape requires ${expected} ${segment} anchors`,
    ));
  }
  for (const [caseId, expected] of Object.entries(criteria.caseAnchorCounts)) {
    const count = nodes.filter((node) => node.caseId === caseId).length;
    if (count !== expected) diagnostics.push(diagnostic(
      'route.case-shape', '$.graph.nodes', `case ${caseId} requires exactly ${expected} anchors`,
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
    if (isForbiddenStreetViewKey(key)) diagnostics.push(diagnostic(
      'street-view.forbidden-field', path,
      `${path} persists prohibited Google imagery, panorama, or pixel data`,
    ));
    const reviews = value?.reviews;
    if (production && key === 'provenance' && value?.kind === 'ai-draft' && (
      value.reviewStatus !== 'human-accepted' || value.humanEdited !== true ||
      !reviews || !['facts', 'copyrightSimilarity', 'culture', 'gameplay']
        .every((gate) => reviews[gate] === true)
    )) {
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

  const outgoing = new Map();
  for (const edge of edges) {
    const values = outgoing.get(edge.from) ?? [];
    values.push(edge);
    outgoing.set(edge.from, values);
  }
  for (const node of nodes) {
    const branches = outgoing.get(node.id) ?? [];
    if (branches.length < 2) continue;
    const actionIds = new Set(node.interaction?.actions?.map((action) => action.id) ?? []);
    const branchActions = branches.map((edge) => edge.actionId).filter(Boolean);
    if (branchActions.length !== branches.length || new Set(branchActions).size !== branches.length ||
        branchActions.some((actionId) => !actionIds.has(actionId))) {
      diagnostics.push(diagnostic('graph.branch.invalid', '$.graph.edges',
        `node ${node.id} branches must map unique semantic action ids to every outgoing edge`));
    }
  }

  for (const [index, route] of (adventurePackage?.geography?.routes ?? []).entries()) {
    if (!nodeIds.has(route.from) || !nodeIds.has(route.to) ||
        !TRANSITIONS.has(route.transition) || !route.routeStatus) {
      diagnostics.push(diagnostic('geography.route.invalid', `$.geography.routes.${index}`,
        'geographic route references or semantics are invalid'));
    }
    if (production && route.routeStatus !== 'verified') diagnostics.push(diagnostic(
      'geography.route.pending', `$.geography.routes.${index}.routeStatus`,
      'geographic route still requires human Street View acceptance'));
  }
  if (production && nodes.length > 1 && !(adventurePackage?.geography?.routes?.length)) {
    diagnostics.push(diagnostic('geography.routes.missing', '$.geography.routes',
      'production packages require an independently authored geographic route view'));
  }

  const { reachable, canReachFinal } = analyzeAdventureGraph(adventurePackage);
  for (const node of nodes) {
    if (!reachable.has(node.id)) diagnostics.push(diagnostic(
      'graph.unreachable', '$.graph.nodes', `node ${node.id} is unreachable from the story start`,
    ));
  }
  for (const node of nodes) {
    if (reachable.has(node.id) && !canReachFinal.has(node.id)) diagnostics.push(diagnostic(
      'graph.ending-unreachable', '$.graph.nodes', `node ${node.id} cannot reach a final reasoning node`,
    ));
  }
  if (!endings.length) diagnostics.push(diagnostic(
    'ending.missing', '$.endings', 'package has no ending',
  ));
  const endingIds = new Set(endings.map((ending) => ending.id));
  for (const item of adventurePackage?.cases ?? []) {
    if (!endingIds.has(item.endingId)) diagnostics.push(diagnostic(
      'case.ending.invalid', '$.cases', `case ${item.id} references an unknown ending`,
    ));
  }
  for (const [index, ending] of endings.entries()) {
    if (!ending.id || !ending.requiresEvidence?.length || !ending.cultureCard?.id) {
      diagnostics.push(diagnostic('ending.incomplete', `$.endings.${index}`,
        `ending ${ending.id ?? '<missing>'} is incomplete for the runtime`));
    }
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
