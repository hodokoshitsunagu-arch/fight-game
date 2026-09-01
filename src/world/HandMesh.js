import { BufferGeometry, BufferAttribute, Bone, Skeleton, Vector3, Matrix4 } from 'three';
import { PALM_STATIONS } from './HandRig.js';

/**
 * HandMesh.js — one continuous skinned surface, swept over the rig.
 *
 * The hand it replaces was twelve disjoint capsules. Not too few triangles —
 * 3,008 a hand is a reasonable budget, and a good hand model lives in the
 * 1,500–3,000 range — but twelve *separate* ones, with an end cap sitting
 * inside the next primitive at every joint. Nothing tapered, nothing webbed,
 * and the fingers were 27mm across on 24mm spacing, which means they
 * interpenetrated and there was no gap between them to see. It read as a
 * mitten because geometrically it was one.
 *
 * ## Why a sweep and not an implicit surface
 *
 * The first plan was to union capsules with a smooth minimum and pull the
 * surface out with marching cubes. It was measured and it does not work at this
 * budget:
 *
 *   voxel    triangles/hand    resolves the gap between fingers?
 *   1.0mm     146,164          yes
 *   1.5mm      65,092          barely
 *   2.0mm      36,552          no
 *   4.5mm       ~7,000         no — and it is nondeterministic which pairs fuse
 *
 * The air gap between adjacent fingers is 2.7mm at its widest. A grid coarse
 * enough to fit the budget cannot sample it, so whether any two fingers
 * separate depends on where the grid phase happens to land. And a 4.5mm voxel
 * puts about 15 vertices around a finger against the 12 the capsules already
 * had — 2.4× the triangles for 25% more angular resolution.
 *
 * A hand is a branching tube. It has a parameter domain already; marching cubes
 * throws that away and then makes you reconstruct UVs, tangents and weights
 * from nothing. Sweeping rings along the bones is 5,056 triangles for 32
 * vertices around a finger — the same angular fidelity marching cubes wanted
 * 36,552 for — and the domain hands you three things for free:
 *
 *   UVs        `u` around the ring, `v` along the chain by arc length
 *   tangents   the ring tangent *is* the u direction, written analytically.
 *              Never `computeTangents()`, which produces garbage at seams
 *   weights    every ring knows its bone and its position along it
 *
 * ## Bind space
 *
 * Vertices are emitted through the bones' rest-pose world matrices, so the
 * geometry is already in bind space and `Skeleton` derives correct inverses
 * from the same matrices. Build the skeleton first, pose it never, then sweep.
 */

/** Vertices around a finger. */
const RADIAL = 32;

/** Ring stations along each phalanx, not counting the one it shares with its parent. */
const RINGS_PER_BONE = 3;

/** Rings in the rounded cap that closes a fingertip. */
const CAP_RINGS = 3;

/**
 * Metres of surface per tile repeat.
 *
 * The skin tile is seamless and stationary, so texel density is set here once
 * and is uniform from fingertip to palm — which the old scheme, with mismatched
 * capsules all sharing one `repeat`, could not be.
 */
const TILE_METRES = 0.045;

const smoothstep = (t) => t * t * (3 - 2 * t);

/**
 * Make the tangent perpendicular to the normal, in place.
 *
 * The analytic tangent is exact for a circular ring and *not* exact anywhere
 * the cross-section is something else — the palm's thenar bulge varies the
 * radius with the angle, and the tangent formula that ignores it came out up
 * to 8 degrees off. `USE_TANGENT` builds the whole normal-map frame from this
 * vector, so a tangent that is not perpendicular tilts the lighting.
 *
 * One Gram-Schmidt step, applied everywhere rather than only where it is
 * needed: it costs nothing on a vector that is already perpendicular, and
 * "everywhere" is a property a test can assert.
 */
function orthogonalise(tangent, normal) {
  tangent.addScaledVector(normal, -tangent.dot(normal));
  if (tangent.lengthSq() < 1e-12) return tangent.set(1, 0, 0);
  return tangent.normalize();
}
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);

/**
 * Build the bone hierarchy in its rest pose.
 *
 * Returns the handles `FirstPersonHands` drives, under the same names the
 * capsule rig used. That is deliberate and it is the migration: `built.hand`,
 * `built.knuckle`, `built.fingers[i]`, `fingers[i].userData.distal`,
 * `.tipObject`, `.tipOffset` and `.fan` all mean what they meant, so the pose
 * layer and its tests do not know the geometry changed underneath them.
 */
export function buildSkeleton(rig) {
  const bones = [];
  const add = (bone, parent) => {
    bones.push(bone);
    if (parent) parent.add(bone);
    return bone;
  };

  const root = add(new Bone());
  root.name = 'wrist';

  /*
   * The knuckle stays, but it is the transverse metacarpal arch now rather
   * than the single hinge all four fingers used to pivot on. The palm is not a
   * board: its far edge rolls toward the thumb as the hand closes, and how far
   * depends on the finger. It is most of what separates a fist from four rods.
   */
  const knuckle = add(new Bone(), root);
  knuckle.name = 'knuckle';

  const chains = rig.digits.map((digit) => {
    const parent = digit.name === 'thumb' ? root : knuckle;
    const chain = [];
    let host = parent;
    digit.bones.forEach((spec, i) => {
      const bone = add(new Bone(), host);
      bone.name = `${digit.name}.${spec.name}`;
      if (i === 0) {
        bone.position.set(digit.base.x, digit.base.y, digit.base.z);
        bone.rotation.set(digit.rotation.x, digit.rotation.y, digit.rotation.z);
      } else {
        // Each phalanx starts where the last one ended. Bones run along -z.
        bone.position.set(0, 0, -digit.bones[i - 1].length);
      }
      bone.userData.spec = spec;
      chain.push(bone);
      host = bone;
    });
    return { digit, chain };
  });

  root.updateMatrixWorld(true);

  const fingers = chains.filter(({ digit }) => digit.name !== 'thumb').map(({ digit, chain }) => {
    const mcp = chain[0];
    mcp.userData.fan = digit.fan;
    mcp.userData.arch = digit.arch;
    mcp.userData.middle = chain[1];
    mcp.userData.distal = chain[2];
    /*
     * Where the tip is, so callers do not have to know how this is built.
     * Measuring the bone's *origin* reports the joint, which barely moves and
     * is exactly what let a fist that curled the wrong way pass for an open
     * hand once already.
     */
    mcp.userData.tipObject = chain[2];
    mcp.userData.tipOffset = [0, 0, -digit.bones[2].length];
    return mcp;
  });

  const thumbChain = chains.find(({ digit }) => digit.name === 'thumb').chain;
  const thumb = thumbChain[0];
  thumb.userData.middle = thumbChain[1];
  thumb.userData.distal = thumbChain[2];

  return { root, knuckle, fingers, thumb, bones, chains };
}

/**
 * A writable, growable vertex buffer.
 *
 * Plain arrays here rather than typed ones sized up front: the vertex count
 * depends on the rig, and getting that arithmetic wrong is a silent
 * out-of-bounds rather than an error.
 */
function makeBuffers() {
  return {
    position: [], normal: [], uv: [], tangent: [], skinIndex: [], skinWeight: [], index: []
  };
}

/**
 * Emit one ring of vertices around a bone's axis.
 *
 * @param t 0..1 along the bone, which fixes both the radius and the weights
 */
function ring(buffers, bone, boneIndex, parentIndex, childIndex, t, arcLength, radialSegments) {
  const spec = bone.userData.spec;
  const radius = spec.radius + (spec.tipRadius - spec.radius) * t;
  const slope = spec.tipRadius - spec.radius;
  const z = -t * spec.length;

  /*
   * Weights.
   *
   * A joint is where two bones meet, so the ring sitting on it belongs half to
   * each. Away from a joint a ring belongs entirely to its own bone. Anything
   * else creases: weight a joint ring fully to one side and the surface hinges
   * there like a paper fold instead of bending like a finger.
   */
  const BLEND = 0.34;
  let selfWeight = 1;
  let otherIndex = boneIndex;
  if (t < BLEND && parentIndex >= 0) {
    selfWeight = 0.5 + 0.5 * smoothstep(clamp01(t / BLEND));
    otherIndex = parentIndex;
  } else if (t > 1 - BLEND && childIndex >= 0) {
    selfWeight = 0.5 + 0.5 * smoothstep(clamp01((1 - t) / BLEND));
    otherIndex = childIndex;
  }

  const local = new Vector3();
  const normal = new Vector3();
  const tangent = new Vector3();
  const world = bone.matrixWorld;
  // Rotation only, for directions. The bone rest matrices carry no scale.
  const rotation = new Matrix4().extractRotation(world);

  const start = buffers.position.length / 3;
  for (let i = 0; i <= radialSegments; i++) {
    // The last vertex duplicates the first, at u = 1 rather than u = 0, so the
    // tile meets itself instead of running the whole way back round.
    const a = (i / radialSegments) * Math.PI * 2;
    const cos = Math.cos(a);
    const sin = Math.sin(a);

    local.set(cos * radius, sin * radius, z).applyMatrix4(world);
    buffers.position.push(local.x, local.y, local.z);

    // Surface of revolution: the axial term is how fast the radius is changing.
    normal.set(spec.length * cos, spec.length * sin, slope).normalize().applyMatrix4(rotation);
    buffers.normal.push(normal.x, normal.y, normal.z);

    tangent.set(-sin, cos, 0).applyMatrix4(rotation);
    orthogonalise(tangent, normal);
    buffers.tangent.push(tangent.x, tangent.y, tangent.z, 1);

    buffers.uv.push(i / radialSegments, arcLength / TILE_METRES);

    buffers.skinIndex.push(boneIndex, otherIndex, 0, 0);
    buffers.skinWeight.push(selfWeight, 1 - selfWeight, 0, 0);
  }
  return start;
}

/**
 * Close a ring with a triangle fan to a point on the axis.
 *
 * Without this the palm is a length of pipe. Both ends are open: the wrist end
 * hides behind the sleeve, but the knuckle end faces the camera and you can see
 * down inside it between the fingers.
 *
 * @param flip which way the fan winds, so both ends face outward
 */
function capRing(buffers, ringStart, centre, normal, uvV, boneIndex, radialSegments, flip) {
  const start = buffers.position.length / 3;
  buffers.position.push(centre.x, centre.y, centre.z);
  buffers.normal.push(normal.x, normal.y, normal.z);
  // The fan's centre has no ring direction to be tangent to; any perpendicular
  // will do, and Gram-Schmidt against the normal is what makes it consistent.
  const tangent = new Vector3(1, 0, 0);
  orthogonalise(tangent, normal);
  buffers.tangent.push(tangent.x, tangent.y, tangent.z, 1);
  buffers.uv.push(0.5, uvV);
  buffers.skinIndex.push(boneIndex, boneIndex, 0, 0);
  buffers.skinWeight.push(1, 0, 0, 0);

  for (let i = 0; i < radialSegments; i++) {
    const a = ringStart + i;
    const b = ringStart + i + 1;
    if (flip) buffers.index.push(start, b, a);
    else buffers.index.push(start, a, b);
  }
}

/** Stitch two rings of equal width into a band of quads. */
function stitch(buffers, a, b, radialSegments) {
  for (let i = 0; i < radialSegments; i++) {
    const a0 = a + i;
    const a1 = a + i + 1;
    const b0 = b + i;
    const b1 = b + i + 1;
    buffers.index.push(a0, b0, a1, a1, b0, b1);
  }
}

/**
 * Sweep one digit: three phalanges into a single continuous tube, capped.
 *
 * Rings are shared at the joints rather than doubled. Two coincident rings with
 * different weights is a crack that opens as soon as the finger bends, and it
 * is invisible until it does.
 */
function sweepDigit(buffers, chain, boneIndexOf, wristIndex, radialSegments) {
  let previous = -1;
  let arc = 0;

  for (let b = 0; b < chain.length; b++) {
    const bone = chain[b];
    const spec = bone.userData.spec;
    const index = boneIndexOf(bone);
    const parent = b > 0 ? boneIndexOf(chain[b - 1]) : wristIndex;
    const child = b < chain.length - 1 ? boneIndexOf(chain[b + 1]) : -1;

    // Skip t = 0 on every bone but the first: it is the previous bone's t = 1.
    for (let s = b === 0 ? 0 : 1; s <= RINGS_PER_BONE; s++) {
      const t = s / RINGS_PER_BONE;
      const at = ring(buffers, bone, index, parent, child, t, arc + t * spec.length, radialSegments);
      if (previous >= 0) stitch(buffers, previous, at, radialSegments);
      previous = at;
    }
    arc += spec.length;
  }

  /*
   * The tip.
   *
   * A flat disc reads as a cut-off tube from any angle that sees it, and the
   * fingertip is the part of the hand nearest the camera. Quarter-circle
   * rings close it into a dome for the price of three bands.
   */
  const last = chain[chain.length - 1];
  const spec = last.userData.spec;
  const index = boneIndexOf(last);
  const world = last.matrixWorld;
  const rotation = new Matrix4().extractRotation(world);
  const point = new Vector3();
  const normal = new Vector3();
  const tangent = new Vector3();

  for (let c = 1; c <= CAP_RINGS; c++) {
    const phi = (c / CAP_RINGS) * (Math.PI / 2);
    const radius = spec.tipRadius * Math.cos(phi);
    const z = -spec.length - spec.tipRadius * Math.sin(phi);
    const start = buffers.position.length / 3;
    for (let i = 0; i <= radialSegments; i++) {
      const a = (i / radialSegments) * Math.PI * 2;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      point.set(cos * radius, sin * radius, z).applyMatrix4(world);
      buffers.position.push(point.x, point.y, point.z);
      normal.set(cos * Math.cos(phi), sin * Math.cos(phi), -Math.sin(phi))
        .normalize().applyMatrix4(rotation);
      buffers.normal.push(normal.x, normal.y, normal.z);
      tangent.set(-sin, cos, 0).applyMatrix4(rotation);
      orthogonalise(tangent, normal);
      buffers.tangent.push(tangent.x, tangent.y, tangent.z, 1);
      buffers.uv.push(i / radialSegments, (arc + spec.tipRadius * Math.sin(phi)) / TILE_METRES);
      buffers.skinIndex.push(index, index, 0, 0);
      buffers.skinWeight.push(1, 0, 0, 0);
    }
    stitch(buffers, previous, start, radialSegments);
    previous = start;
  }
}

/**
 * The palm.
 *
 * An elliptical tube swept from the wrist to the knuckle line, widening as it
 * goes and rounded at both ends. Not a box, and not the flattened capsule it
 * replaces: the cross-section is authored per station, so the thenar side can
 * carry the mass a thumb muscle actually has.
 *
 * Weighted entirely to the wrist. The finger metacarpals are not bones here —
 * in a real hand they barely move, and what motion they do have is the arch,
 * which rides on the knuckle.
 */
function sweepPalm(buffers, rig, root, wristIndex, radialSegments) {
  const { depth, width, thickness } = rig.palm;
  // The profile lives in `HandRig` because it is a measurement, and because the
  // test that checks each digit's root is buried has to ask the same question.
  const stations = PALM_STATIONS;

  const world = root.matrixWorld;
  const rotation = new Matrix4().extractRotation(world);
  const point = new Vector3();
  const normal = new Vector3();
  const tangent = new Vector3();
  let previous = -1;

  for (let s = 0; s < stations.length; s++) {
    const station = stations[s];
    const rx = (width / 2) * station.w;
    const ry = (thickness / 2) * station.h;
    const z = -station.t * depth;
    const start = buffers.position.length / 3;

    for (let i = 0; i <= radialSegments; i++) {
      const a = (i / radialSegments) * Math.PI * 2;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      /*
       * The thenar eminence — the pad at the base of the thumb — is a bulge on
       * the thumb side only, so it is added on the half of the ring facing the
       * thumb rather than to the radius everywhere.
       */
      const towardThumb = Math.max(0, -rig.side * cos);
      const bulge = 1 + station.thenar * towardThumb;

      point.set(cos * rx * bulge, sin * ry, z).applyMatrix4(world);
      buffers.position.push(point.x, point.y, point.z);

      /*
       * Tangent by central difference, not by formula.
       *
       * The bulge makes the radius a function of the angle, so the ellipse
       * tangent is wrong exactly where the thenar mass is — measured 8 degrees
       * out. Differencing the profile is correct for whatever the profile
       * happens to be, including the next one somebody authors.
       */
      const at = (angle) => {
        const c = Math.cos(angle);
        const b = 1 + station.thenar * Math.max(0, -rig.side * c);
        return [c * rx * b, Math.sin(angle) * ry];
      };
      const h = 1e-3;
      const [ax, ay] = at(a - h);
      const [bx, by] = at(a + h);
      tangent.set(bx - ax, by - ay, 0).normalize().applyMatrix4(rotation);

      // The normal is the tangent turned a quarter turn in the cross-section
      // plane, which is exact for any profile the difference above can walk.
      normal.set(by - ay, -(bx - ax), 0).normalize().applyMatrix4(rotation);
      // Outward, not inward.
      if (normal.dot(point.clone().sub(new Vector3().setFromMatrixPosition(world))) < 0) {
        normal.negate();
      }
      buffers.normal.push(normal.x, normal.y, normal.z);

      orthogonalise(tangent, normal);
      buffers.tangent.push(tangent.x, tangent.y, tangent.z, 1);

      buffers.uv.push(i / radialSegments, (station.t * depth) / TILE_METRES);
      buffers.skinIndex.push(wristIndex, wristIndex, 0, 0);
      buffers.skinWeight.push(1, 0, 0, 0);
    }

    if (previous >= 0) stitch(buffers, previous, start, radialSegments);

    if (s === 0) {
      capRing(buffers, start, new Vector3(0, 0, z).applyMatrix4(world),
        new Vector3(0, 0, 1).applyMatrix4(rotation).normalize(),
        (station.t * depth) / TILE_METRES, wristIndex, radialSegments, false);
    } else if (s === stations.length - 1) {
      capRing(buffers, start, new Vector3(0, 0, z).applyMatrix4(world),
        new Vector3(0, 0, -1).applyMatrix4(rotation).normalize(),
        (station.t * depth) / TILE_METRES, wristIndex, radialSegments, true);
    }

    previous = start;
  }
}

/**
 * Build the whole hand: one geometry, one skeleton, one draw call.
 *
 * The palm and the five digits are separate shells inside a single indexed
 * buffer. They are not stitched to each other — a finger root sits inside the
 * palm's surface — but they share a skeleton, so the junction moves as one
 * piece and stays buried. Stitching them properly is what buys webbing between
 * the fingers, and it is the next thing worth doing here.
 */
export function buildHandGeometry(rig, skeleton, { radialSegments = RADIAL } = {}) {
  const buffers = makeBuffers();
  const boneIndex = new Map(skeleton.bones.map((bone, i) => [bone, i]));
  const boneIndexOf = (bone) => boneIndex.get(bone) ?? 0;
  const wristIndex = boneIndexOf(skeleton.root);

  sweepPalm(buffers, rig, skeleton.root, wristIndex, radialSegments);
  for (const { chain } of skeleton.chains) {
    sweepDigit(buffers, chain, boneIndexOf, wristIndex, radialSegments);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(buffers.position), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(buffers.normal), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(buffers.uv), 2));
  geometry.setAttribute('tangent', new BufferAttribute(new Float32Array(buffers.tangent), 4));
  geometry.setAttribute('skinIndex', new BufferAttribute(new Uint16Array(buffers.skinIndex), 4));
  geometry.setAttribute('skinWeight', new BufferAttribute(new Float32Array(buffers.skinWeight), 4));
  geometry.setIndex(new BufferAttribute(new Uint16Array(buffers.index), 1));
  geometry.computeBoundingSphere();
  return geometry;
}

/** Bind the bones into a `Skeleton`, once the geometry has been swept off them. */
export function makeSkeleton(built) {
  return new Skeleton(built.bones);
}
