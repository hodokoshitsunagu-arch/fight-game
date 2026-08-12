import {
  AdditiveBlending,
  NormalBlending,
  ShaderMaterial,
  Color,
  DoubleSide
} from 'three';
import { sharedUniforms } from '../core/FrameUniforms.js';
import { noiseGLSL } from '../shaders/lib/noise.glsl.js';
import { commonGLSL } from '../shaders/lib/common.glsl.js';

export const ShowcaseMode = Object.freeze({
  RIFT: 0,
  FIREBIRD: 1,
  DISK: 2,
  GROUND: 3,
  SAP: 4,
  DARK_CORE: 5
});

/** Shared programmable surface used by the four showcase abilities. */
export function createShowcaseMaterial(mode, options = {}) {
  const additive = options.additive ?? mode !== ShowcaseMode.DARK_CORE;
  return new ShaderMaterial({
    defines: { SHOWCASE_MODE: mode },
    transparent: true,
    depthWrite: options.depthWrite ?? false,
    depthTest: true,
    blending: additive ? AdditiveBlending : NormalBlending,
    side: options.side ?? DoubleSide,
    toneMapped: false,
    uniforms: sharedUniforms({
      uAge: { value: 0 },
      uProgress: { value: 0 },
      uOpacity: { value: 1 },
      uIntensity: { value: 1 },
      uSeed: { value: Math.random() * 20 },
      uParam0: { value: 1 },
      uParam1: { value: 1 },
      uParam2: { value: 1 },
      uColorA: { value: new Color(1, 1, 1) },
      uColorB: { value: new Color(0.5, 0.2, 1) },
      uColorC: { value: new Color(0.05, 0.01, 0.15) }
    }),
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uAge;
      uniform float uProgress;
      uniform float uParam0;
      uniform float uParam1;
      uniform float uParam2;
      varying vec2 vUv;
      varying vec3 vLocal;
      varying vec3 vNormalW;
      varying vec3 vViewDir;
      varying float vViewZ;

      void main() {
        vUv = uv;
        vec3 pos = position;
        #if SHOWCASE_MODE == 0
          pos.z += sin(pos.x * uParam0 + uTime * 2.4) * uParam1 * (0.2 + uv.y * 0.8);
        #elif SHOWCASE_MODE == 1
          float wing = smoothstep(0.1, 1.0, abs(pos.x) / max(uParam0, 0.01));
          pos.y += sin(uAge * 7.2 + abs(pos.x) * 0.7) * uParam1 * wing;
        #endif
        vLocal = pos;
        vec4 localPosition = vec4(pos, 1.0);
        vec3 objectNormal = normal;
        #ifdef USE_INSTANCING
          localPosition = instanceMatrix * localPosition;
          mat3 im = mat3(instanceMatrix);
          vec3 invScale = vec3(dot(im[0], im[0]), dot(im[1], im[1]), dot(im[2], im[2]));
          objectNormal = im * (objectNormal / max(invScale, vec3(1e-5)));
        #endif
        vec4 world = modelMatrix * localPosition;
        vNormalW = normalize(mat3(modelMatrix) * objectNormal);
        vViewDir = cameraPosition - world.xyz;
        vec4 mv = viewMatrix * world;
        vViewZ = mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uAge;
      uniform float uProgress;
      uniform float uOpacity;
      uniform float uIntensity;
      uniform float uSeed;
      uniform float uParam0;
      uniform float uParam1;
      uniform float uParam2;
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      uniform vec3 uColorC;
      uniform float uGlobalGlow;
      uniform vec2 uResolution;
      uniform sampler2D uSceneDepth;
      uniform float uCameraNear;
      uniform float uCameraFar;
      varying vec2 vUv;
      varying vec3 vLocal;
      varying vec3 vNormalW;
      varying vec3 vViewDir;
      varying float vViewZ;
      ${noiseGLSL}
      ${commonGLSL}

      void main() {
        vec2 p = vUv * 2.0 - 1.0;
        vec3 color = uColorA;
        float alpha = uOpacity;

        #if SHOWCASE_MODE == 0
          float tear = abs(p.y + snoise(vec3(vLocal.x * 1.7, uSeed, uTime * 0.35)) * 0.16);
          float core = smoothstep(0.58, 0.03, tear);
          float edge = exp(-20.0 * abs(tear - 0.28));
          float veins = ridged(vec3(vLocal.x * 2.0, vLocal.y * 2.4, uTime + uSeed), 4);
          color = mix(uColorC, uColorB, core * 0.35 + veins * 0.18) + uColorA * edge * 2.2;
          float zipper = 1.0 - smoothstep(max(0.0, uProgress - 0.08), max(0.001, uProgress), abs(p.x));
          alpha *= smoothstep(0.68, 0.03, tear) * smoothstep(0.0, 0.06, vUv.x) * smoothstep(0.0, 0.06, 1.0 - vUv.x) * zipper;
        #elif SHOWCASE_MODE == 1
          float n = ridged(vLocal * vec3(1.2, 2.0, 1.5) + vec3(0.0, -uTime * 2.6, uSeed), 4);
          float rim = fresnelTerm(vViewDir, vNormalW, 2.2, 1.0);
          color = mix(uColorC, uColorB, smoothstep(0.1, 0.9, n));
          color = mix(color, uColorA, pow(n, 3.0) + rim * 0.65);
          alpha *= smoothstep(-0.25, 0.28, n) * (0.72 + rim * 0.28);
        #elif SHOWCASE_MODE == 2
          float r = length(p);
          float a = atan(p.y, p.x);
          float bands = 0.5 + 0.5 * sin(a * uParam0 - uTime * uParam1 + r * 18.0);
          float inner = clamp(0.82 - uParam2 * 0.7, 0.08, 0.86);
          float ring = smoothstep(1.0, 0.88, r) * smoothstep(inner, inner + 0.09, r);
          color = mix(uColorC, uColorB, bands) + uColorA * pow(bands, 7.0) * 1.8;
          alpha *= ring * (0.45 + bands * 0.55);
        #elif SHOWCASE_MODE == 3
          float r = length(p);
          float a = atan(p.y, p.x);
          float roots = pow(max(0.0, sin(a * uParam0 + fbm3(vec3(p * 4.0, uSeed)) * 4.0)), 10.0);
          float pulse = exp(-16.0 * abs(r - fract(uAge * uParam1)));
          float ring = exp(-28.0 * abs(r - 0.82));
          color = mix(uColorC, uColorB, roots) + uColorA * (pulse + ring) * 1.5;
          alpha *= smoothstep(1.0, 0.12, r) * (roots * 0.75 + pulse + ring * 0.55);
        #elif SHOWCASE_MODE == 4
          float bark = ridged(vec3(vUv.x * 5.0, vUv.y * 12.0 - uTime * 0.15, uSeed), 4);
          float sap = exp(-24.0 * abs(fract(vUv.y * 2.0 - uAge * uParam1 + bark * 0.18) - 0.5));
          color = mix(uColorC, uColorB, bark * 0.35) + uColorA * sap * 1.8;
          alpha *= 0.9;
        #else
          float rim = fresnelTerm(vViewDir, vNormalW, 3.5, 1.0);
          float speck = step(0.82, snoise01(vLocal * 7.0 + uSeed + uTime * 0.2));
          color = mix(uColorC, uColorB, rim) + uColorA * speck * rim;
          alpha *= smoothstep(0.02, 0.32, rim) * 0.75 + 0.96;
        #endif

        alpha *= softFade(uSceneDepth, gl_FragCoord.xy / uResolution, vViewZ, uCameraNear, uCameraFar, 0.3);
        if (alpha < 0.004) discard;
        gl_FragColor = vec4(color * uIntensity * uGlobalGlow, clamp(alpha, 0.0, 1.0));
      }
    `
  });
}
