import { distanceMeters } from '../../utils/geo.js';

function headingDifference(a, b) {
  return Math.abs(((a - b + 540) % 360) - 180);
}

function evaluate(effect, observation) {
  const target = effect.target;
  if (!observation?.position) return { ok: false, reason: 'viewer-unavailable', matched: [] };
  const inRange = distanceMeters(observation.position, target.position) <= target.radiusMetres;
  const onHeading = headingDifference(observation.heading ?? 0, target.heading) <= target.headingTolerance;
  const matched = [inRange ? 'range' : null, onHeading ? 'heading' : null].filter(Boolean);
  return {
    ok: inRange && onHeading,
    reason: inRange ? (onHeading ? null : 'heading-mismatch') : 'out-of-range',
    matched,
  };
}

export class FakeStreetViewAdapter {
  constructor({ observations = [] } = {}) {
    this.observations = [...observations];
  }

  navigate(effect) {
    const result = evaluate(effect, this.observations.shift());
    return {
      type: 'adapter-result',
      effectId: effect.id,
      adapter: 'street-view',
      ...result,
    };
  }
}

export class StreetViewAdapter {
  constructor(getStreetView) {
    this.getStreetView = getStreetView;
  }

  async navigate(effect) {
    const view = this.getStreetView?.();
    if (!view) {
      return {
        type: 'adapter-result', effectId: effect.id, adapter: 'street-view',
        ok: false, reason: 'viewer-unavailable', matched: [],
      };
    }
    try {
      const target = effect.target;
      const moved = await view.moveToAnchor?.({
        id: effect.nodeId,
        lat: target.position.lat,
        lng: target.position.lng,
        radius: target.radiusMetres,
        transition: 'coordinate',
      });
      if (!moved?.ok) {
        return {
          type: 'adapter-result', effectId: effect.id, adapter: 'street-view',
          ok: false, reason: moved?.reason ?? 'navigation-failed', matched: [],
        };
      }
      const survey = view.survey?.();
      const result = evaluate(effect, {
        position: survey?.position,
        heading: view.heading ?? survey?.heading ?? 0,
      });
      return {
        type: 'adapter-result', effectId: effect.id, adapter: 'street-view',
        ...result,
      };
    } catch (error) {
      return {
        type: 'adapter-result', effectId: effect.id, adapter: 'street-view',
        ok: false, reason: error?.message ?? 'navigation-failed', matched: [],
      };
    }
  }
}
