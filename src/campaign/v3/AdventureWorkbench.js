import { validateAdventurePackageDetailed } from './AdventurePackageValidator.js';
import {
  exportAdventurePackage,
  importAdventurePackage,
} from './AdventurePackageSerializer.js';

function clone(value) {
  return structuredClone(value);
}

function setPath(target, path, value) {
  const parts = path.split('.');
  const final = parts.pop();
  let current = target;
  for (const part of parts) {
    if (current[part] == null) current[part] = {};
    current = current[part];
  }
  current[final] = clone(value);
}

function storyRelationships(adventurePackage) {
  const edges = adventurePackage.graph?.edges ?? [];
  const outgoing = new Map();
  for (const edge of edges) {
    const values = outgoing.get(edge.from) ?? [];
    values.push(edge.to);
    outgoing.set(edge.from, values);
  }
  const reachable = new Set();
  const pending = adventurePackage.graph?.startNodeId
    ? [adventurePackage.graph.startNodeId]
    : [];
  while (pending.length) {
    const id = pending.pop();
    if (reachable.has(id)) continue;
    reachable.add(id);
    pending.push(...(outgoing.get(id) ?? []));
  }
  return {
    nodes: (adventurePackage.graph?.nodes ?? []).map((node) => ({
      id: node.id,
      title: node.title,
      segment: node.segment,
      caseId: node.caseId ?? null,
      reachable: reachable.has(node.id),
    })),
    edges: clone(edges),
  };
}

export class AdventureWorkbench {
  constructor(adventurePackage, { streetView = null } = {}) {
    this.package = clone(adventurePackage);
    this.streetView = streetView;
  }

  update(path, value) {
    setPath(this.package, path, value);
    return this.package;
  }

  replace(adventurePackage) {
    this.package = clone(adventurePackage);
    return this.package;
  }

  import(text) {
    return this.replace(importAdventurePackage(text));
  }

  export() {
    return exportAdventurePackage(this.package);
  }

  validate(level = 'development') {
    return validateAdventurePackageDetailed(this.package, { level });
  }

  relationships() {
    const story = storyRelationships(this.package);
    const byId = new Map((this.package.graph?.nodes ?? []).map((node) => [node.id, node]));
    return {
      story,
      geographic: {
        routes: story.edges.map((edge) => {
          const from = byId.get(edge.from);
          return {
            from: edge.from,
            to: edge.to,
            transition: from?.streetViewTarget?.transition ?? 'coordinate',
            routeStatus: from?.streetViewTarget?.routeStatus ?? 'needs-live-check',
          };
        }),
      },
    };
  }

  async previewAnchor(nodeId) {
    const node = this.package.graph?.nodes?.find((item) => item.id === nodeId);
    if (!node) throw new Error(`Unknown anchor ${nodeId}`);
    if (!this.streetView?.preview) return { ok: false, reason: 'viewer-unavailable' };
    return this.streetView.preview(clone(node.streetViewTarget));
  }

  calibrateAnchor(nodeId, options) {
    const node = this.package.graph?.nodes?.find((item) => item.id === nodeId);
    if (!node) throw new Error(`Unknown anchor ${nodeId}`);
    const observation = this.streetView?.survey?.();
    if (!observation?.position) throw new Error('Official Street View survey is unavailable');
    node.streetViewTarget = {
      position: clone(observation.position),
      radiusMetres: options.radiusMetres,
      heading: Number.isFinite(observation.heading) ? observation.heading : 0,
      headingTolerance: options.headingTolerance,
      pitch: Number.isFinite(observation.pitch) ? observation.pitch : 0,
      pitchTolerance: options.pitchTolerance,
      roadRelationship: options.roadRelationship,
      transition: options.transition,
      routeStatus: 'needs-human-acceptance',
    };
    return clone(node.streetViewTarget);
  }

  acceptStreetViewLayout(nodeId) {
    const node = this.package.graph?.nodes?.find((item) => item.id === nodeId);
    if (!node) throw new Error(`Unknown anchor ${nodeId}`);
    if (node.streetViewTarget?.routeStatus !== 'needs-human-acceptance') {
      throw new Error('Preview and calibrate this anchor before human acceptance');
    }
    node.streetViewTarget.routeStatus = 'verified';
    return clone(node.streetViewTarget);
  }
}
