import { BackSide, Mesh, ShaderMaterial, SphereGeometry } from 'three';

/**
 * SkyDome.js — a panorama with depth, so the backdrop moves.
 *
 * `scene.background` draws a panorama at infinite distance. That is free, and
 * it is why the sky never shifts as the camera orbits: everything in it is
 * infinitely far, so nothing can pass in front of anything else. A city
 * backdrop drawn that way reads as painted-on the moment the camera moves.
 *
 * This draws the same panorama as real geometry instead. Each vertex of a
 * sphere is pushed out along its own direction to the distance its depth map
 * says, so a building 30 metres away lands 30 metres away. Parallax then falls
 * out of ordinary perspective projection — near blocks sweep past far ones with
 * no special code, because they genuinely are nearer.
 *
 * The dome sits at the world origin, where the panorama was captured, and does
 * *not* follow the camera. That is the whole trick: a backdrop pinned to the
 * camera cannot parallax by definition.
 *
 * Trade-offs, stated plainly:
 *
 *  - **Disocclusion.** Stepping sideways should reveal what was hidden behind a
 *    building, and there is no such data in a panorama. Those regions stretch
 *    instead of tearing, which is the least-bad option and why the effect is
 *    kept subtle by default.
 *  - **Cost.** One mesh, ~65k triangles, one draw call. Against the flat
 *    background's zero, this is the price of the effect.
 *  - **Depth precision.** The map stores disparity, not distance, spending its
 *    8 bits where parallax is visible — near — rather than on the skyline.
 */

const VERTEX = /* glsl */ `
  uniform sampler2D uDepth;
  uniform float uHasDepth;
  uniform float uNear;
  uniform float uMaxDepth;
  uniform float uScale;
  uniform float uWorldScale;
  uniform float uRadius;
  uniform float uFlipV;
  uniform float uGroundDrop;

  varying vec2 vUv;
  varying float vDistance;

  void main() {
    vUv = uv;

    vec3 dir = normalize(position);
    float distance = uRadius;

    if (uHasDepth > 0.5) {
      vec2 duv = vec2(uv.x, uFlipV > 0.5 ? uv.y : 1.0 - uv.y);
      // Disparity -> metres. The floor stops a zero sample (sky) becoming a
      // division by zero and collapsing the dome onto the camera.
      float disparity = max(texture2D(uDepth, duv).r, uNear / uMaxDepth);
      distance = min(uNear / disparity, uMaxDepth);
      /*
       * The panorama was captured at its own scale — a city 30 metres away
       * around a road. The play area has its own floor reaching 200 metres, so
       * a city placed at face value ends up buried inside it, with the floor
       * occluding the buildings from the knees down.
       *
       * Scaling every distance uniformly moves the city out past the floor
       * without changing a single pixel of what it looks like: angular size is
       * unaffected, because it is the same panorama. What it does cost is
       * parallax, which falls off with distance — that is the real trade, and
       * why this is a control rather than a constant.
       */
      distance *= uWorldScale;
    }

    float far = uMaxDepth * uWorldScale;
    // Blend toward the shell as depth runs out, so the sky stays a sphere
    // rather than a ragged edge of clamped samples.
    distance = mix(distance, far, smoothstep(far * 0.75, far, distance));
    // 0 collapses everything onto that shell, which is exactly the flat
    // background — the honest way to dial the effect down.
    distance = mix(far, distance, uScale);
    vDistance = distance;

    vec3 displaced = dir * distance;

    // The panorama has its own road, and so does the game. Dropping the lower
    // hemisphere below the play floor lets the real floor win the depth test
    // instead of the two z-fighting along y = 0.
    if (dir.y < 0.0) displaced.y -= uGroundDrop * uWorldScale;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D uPanorama;
  uniform float uIntensity;
  uniform float uFlipV;

  varying vec2 vUv;
  varying float vDistance;

  void main() {
    vec2 uvp = vec2(vUv.x, uFlipV > 0.5 ? vUv.y : 1.0 - vUv.y);
    vec3 colour = texture2D(uPanorama, uvp).rgb * uIntensity;
    gl_FragColor = vec4(colour, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class SkyDome {
  /**
   * @param {object} options
   * @param {number} options.segments longitude segments; latitude is half.
   *   This is the parallax resolution — silhouettes can only bend where there
   *   is a vertex to bend.
   */
  constructor({ segments = 256, radius = 320 } = {}) {
    this.material = new ShaderMaterial({
      uniforms: {
        uPanorama: { value: null },
        uDepth: { value: null },
        uHasDepth: { value: 0 },
        uNear: { value: 4 },
        uMaxDepth: { value: 400 },
        uScale: { value: 1 },
        uWorldScale: { value: 9 },
        uRadius: { value: radius },
        uIntensity: { value: 1 },
        uFlipV: { value: 1 },
        uGroundDrop: { value: 0.6 }
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      side: BackSide,
      depthWrite: true,
      depthTest: true,
      fog: false
    });

    this.mesh = new Mesh(new SphereGeometry(1, segments, segments / 2), this.material);
    this.mesh.name = 'SkyDome';
    // It encloses the camera, so it is never off screen and culling it is a
    // per-frame bounds test that can only ever answer "visible".
    this.mesh.frustumCulled = false;
    // Drawn before everything else, so it can never overdraw the scene.
    this.mesh.renderOrder = -1000;
    this.mesh.visible = false;
  }

  get object3D() {
    return this.mesh;
  }

  /**
   * @param {import('three').Texture|null} panorama
   * @param {import('three').Texture|null} depth null falls back to a plain
   *   sphere at the far radius, which looks exactly like the flat background.
   */
  setTextures(panorama, depth) {
    const u = this.material.uniforms;
    u.uPanorama.value = panorama ?? null;
    u.uDepth.value = depth ?? null;
    u.uHasDepth.value = depth ? 1 : 0;
    u.uFlipV.value = panorama?.flipY === false ? 0 : 1;
    this.material.needsUpdate = true;
  }

  /**
   * How far the shell sits, in world units. The camera has to be able to see
   * this far or the dome is clipped away and the sky simply vanishes — which
   * looks exactly like the feature being broken.
   */
  get farDistance() {
    const u = this.material.uniforms;
    return u.uMaxDepth.value * u.uWorldScale.value;
  }

  /** @param {object} config `settings.environment` */
  sync(config, visible) {
    const u = this.material.uniforms;
    this.mesh.visible = visible && Boolean(u.uPanorama.value);
    u.uScale.value = config.parallaxScale;
    u.uWorldScale.value = config.parallaxWorldScale;
    u.uIntensity.value = config.backgroundIntensity;
    u.uNear.value = config.depthNear;
    u.uMaxDepth.value = config.depthFar;
    this.mesh.rotation.y = (config.backgroundRotation * Math.PI) / 180;
    this.mesh.rotation.x = (config.backgroundTilt * Math.PI) / 180;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
