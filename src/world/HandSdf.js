import { Vector3 } from 'three';

/**
 * HandSdf.js — the hand as a signed distance field, used to blend the sweep.
 *
 * Not to *build* the mesh. That was the first plan and it was measured out of
 * contention: at a triangle budget a phone can afford, marching cubes cannot
 * resolve the 2.7mm gap between adjacent fingers, so which pairs fuse depends
 * on where the grid phase lands. See the note at the top of `HandMesh`.
 *
 * What an implicit surface is genuinely good at is the thing a sweep is bad at:
 * *joins*. Two tubes meeting at an angle have a crease where their surfaces
 * cross; a smooth-minimum union has a fillet. So the sweep keeps its job — it
 * owns the topology, the UVs, the tangents and the skin weights, all of which
 * marching cubes would have thrown away — and the field is used only to push
 * the vertices it already placed onto a rounder surface.
 *
 * The two agree everywhere except at the joins, by construction: every bone
 * contributes a round cone with exactly the radii the sweep used, so along the
 * middle of a phalanx the projection moves a vertex by nothing at all. What it
 * moves is the knuckles, the web between two fingers whose cones are close, and
 * the flare where a digit enters the palm.
 */

/**
 * Quadratic smooth minimum.
 *
 * `k` is the blend radius in metres, and it is the whole tuning story: too
 * small and the joins stay creased, too large and the fingers weld into a
 * mitten. The gap between adjacent proximal phalanges is 1.8mm at its
 * narrowest, so `k` has to stay well under that or this reintroduces exactly
 * the fusing that ruled marching cubes out.
 */
function smin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

const _pa = new Vector3();
const _ba = new Vector3();
const _x = new Vector3();

/**
 * Signed distance to a round cone — a cone capped with a sphere at each end.
 *
 * The exact primitive the sweep draws: a tapered tube from radius `r1` at `a`
 * to `r2` at `b`. Anything else here would make the projection move vertices
 * that are already in the right place.
 *
 * After Inigo Quilez's closed form; the branches pick which of the three
 * regions — near the small cap, the large cap, or the conical flank — the
 * point falls in.
 */
function roundCone(p, a, b, r1, r2) {
  _ba.copy(b).sub(a);
  const l2 = _ba.lengthSq();
  const rr = r1 - r2;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;

  _pa.copy(p).sub(a);
  const y = _pa.dot(_ba);
  const z = y - l2;
  _x.copy(_pa).multiplyScalar(l2).addScaledVector(_ba, -y);
  const x2 = _x.lengthSq();
  const y2 = y * y * l2;
  const z2 = z * z * l2;

  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}

const _q = new Vector3();

/** Signed distance to a box with rounded corners. */
function roundBox(p, centre, half, radius) {
  _q.set(
    Math.abs(p.x - centre.x) - half.x,
    Math.abs(p.y - centre.y) - half.y,
    Math.abs(p.z - centre.z) - half.z
  );
  const outside = Math.hypot(Math.max(_q.x, 0), Math.max(_q.y, 0), Math.max(_q.z, 0));
  const inside = Math.min(Math.max(_q.x, Math.max(_q.y, _q.z)), 0);
  return outside + inside - radius;
}

/**
 * Collect the field's primitives from the rig, in the same space the sweep
 * emitted its vertices into — which is to say off the bones' rest-pose world
 * matrices, exactly as `HandMesh` does.
 */
export function buildField(rig, skeleton) {
  const cones = [];
  for (const { chain } of skeleton.chains) {
    for (const bone of chain) {
      const spec = bone.userData.spec;
      const world = bone.matrixWorld;
      cones.push({
        a: new Vector3(0, 0, 0).applyMatrix4(world),
        b: new Vector3(0, 0, -spec.length).applyMatrix4(world),
        r1: spec.radius,
        r2: spec.tipRadius
      });
    }
  }

  /*
   * The palm, as a rounded box.
   *
   * Deliberately approximate. The swept palm is a lofted ellipse whose
   * cross-section varies station by station and has a thenar bulge on one side,
   * and there is no closed-form distance to that. It does not need one: no palm
   * vertex is projected, so this shape exists only to give the digits something
   * to flare into where they enter it.
   */
  const { depth, width, thickness } = rig.palm;
  const palm = {
    centre: new Vector3(0, 0, -depth * 0.5),
    half: new Vector3(width * 0.5 - 0.006, thickness * 0.5 - 0.006, depth * 0.5 - 0.006),
    radius: 0.006
  };

  /*
   * A bounding sphere per cone, so a query can reject most of them with one
   * dot product. 17 primitives every evaluation is affordable but not free,
   * and this pass makes tens of thousands of evaluations.
   */
  for (const cone of cones) {
    cone.centre = cone.a.clone().add(cone.b).multiplyScalar(0.5);
    cone.bound = cone.a.distanceTo(cone.b) * 0.5 + Math.max(cone.r1, cone.r2);
  }

  return { cones, palm };
}

/**
 * Distance to the whole hand.
 *
 * Seventeen primitives, most of them rejected on a bounding sphere before the
 * closed form runs. This is called tens of thousands of times at construction
 * and nowhere afterwards; anything more elaborate would be more code than the
 * thing it accelerates.
 */
export function distance(field, p, k) {
  let d = roundBox(p, field.palm.centre, field.palm.half, field.palm.radius);
  for (const cone of field.cones) {
    /*
     * Reject on the bounding sphere first. A cone can only pull `d` down if it
     * comes within `k` of the best distance so far — everything further away
     * is already lost to the smooth minimum, and the closed form for a round
     * cone is twenty times the cost of this test.
     */
    const gap = p.distanceTo(cone.centre) - cone.bound;
    if (gap > d + k) continue;
    d = smin(d, roundCone(p, cone.a, cone.b, cone.r1, cone.r2), k);
  }
  return d;
}

const _probe = new Vector3();

/**
 * The field's gradient, by central difference.
 *
 * Six evaluations rather than three, because the one-sided version is biased
 * by half the step and the bias shows up as vertices creeping along the
 * surface instead of across it.
 */
export function gradient(field, p, k, out, h = 2e-4) {
  const at = (dx, dy, dz) => distance(field, _probe.set(p.x + dx, p.y + dy, p.z + dz), k);
  out.set(
    at(h, 0, 0) - at(-h, 0, 0),
    at(0, h, 0) - at(0, -h, 0),
    at(0, 0, h) - at(0, 0, -h)
  );
  const length = out.length();
  return length > 1e-9 ? out.divideScalar(length) : out.set(0, 0, 1);
}
