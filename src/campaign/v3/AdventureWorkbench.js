import { validateAdventurePackageDetailed } from './AdventurePackageValidator.js';
import {
  exportAdventurePackage,
  importAdventurePackage,
} from './AdventurePackageSerializer.js';
import { analyzeAdventureGraph } from './AdventureGraph.js';

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
  const { nodes, edges, reachable } = analyzeAdventureGraph(adventurePackage);
  return {
    nodes: nodes.map((node) => ({
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
    this.previewReceipts = new Map();
  }

  update(path, value) {
    setPath(this.package, path, value);
    this.previewReceipts.clear();
    return this.package;
  }

  replace(adventurePackage) {
    this.package = clone(adventurePackage);
    this.previewReceipts.clear();
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
    return {
      story,
      geographic: {
        routes: clone(this.package.geography?.routes ?? []),
      },
    };
  }

  async previewAnchor(nodeId) {
    const node = this.package.graph?.nodes?.find((item) => item.id === nodeId);
    if (!node) throw new Error(`Unknown anchor ${nodeId}`);
    if (!this.streetView?.preview) return { ok: false, reason: 'viewer-unavailable' };
    const result = await this.streetView.preview(clone(node.streetViewTarget));
    if (result?.ok) this.previewReceipts.set(nodeId, {
      mode: result.mode ?? 'official-viewer',
      driftMeters: result.driftMeters ?? null,
    });
    return result;
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

  acceptStreetViewLayout(nodeId, { reviewer, notes, reviewedAt = new Date().toISOString() }) {
    const node = this.package.graph?.nodes?.find((item) => item.id === nodeId);
    if (!node) throw new Error(`Unknown anchor ${nodeId}`);
    if (node.streetViewTarget?.routeStatus !== 'needs-human-acceptance') {
      throw new Error('Preview and calibrate this anchor before human acceptance');
    }
    const receipt = this.previewReceipts.get(nodeId);
    if (!receipt) throw new Error('A successful official Street View preview is required');
    if (!reviewer?.trim() || !notes?.trim()) {
      throw new Error('Reviewer and review notes are required for auditable acceptance');
    }
    node.streetViewTarget.routeStatus = 'verified';
    node.streetViewTarget.reviewEvidence = {
      method: 'official-street-view',
      reviewedAt,
      reviewer: reviewer.trim(),
      notes: notes.trim(),
      previewMode: receipt.mode,
      driftMeters: receipt.driftMeters,
    };
    return clone(node.streetViewTarget);
  }
}
