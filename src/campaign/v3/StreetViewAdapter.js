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

  async preview(target) {
    const view = this.getStreetView?.();
    if (!view) return { ok: false, reason: 'viewer-unavailable' };
    const moved = await view.moveToAnchor?.({
      lat: target.position?.lat,
      lng: target.position?.lng,
      radius: target.radiusMetres,
      transition: target.transition ?? 'coordinate',
    });
    if (!moved?.ok) return moved ?? { ok: false, reason: 'navigation-failed' };
    view.panorama?.setPov?.({ heading: target.heading ?? 0, pitch: target.pitch ?? 0 });
    return moved;
  }

  survey() {
    const view = this.getStreetView?.();
    const survey = view?.survey?.();
    if (!survey?.position) return null;
    const pov = view.panorama?.getPov?.() ?? {};
    return {
      position: structuredClone(survey.position),
      heading: Number.isFinite(view.heading) ? view.heading : (pov.heading ?? 0),
      pitch: Number.isFinite(pov.pitch) ? pov.pitch : 0,
    };
  }
}
