import { ShaderMaterial, Vector2, DoubleSide, NormalBlending } from 'three';
import { sharedUniforms } from '../core/FrameUniforms.js';

/**
 * Material for invisible proxies rendered only into the distortion buffer.
 * The main composite decodes RG direction, B strength and A coverage.
 */
export function createDistortionMaterial(mode = 'radial') {
  return new ShaderMaterial({
    defines: { DISTORTION_MODE: mode === 'flow' ? 1 : mode === 'rift' ? 2 : 0 },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: NormalBlending,
    side: DoubleSide,
    toneMapped: false,
    uniforms: sharedUniforms({
      uAge: { value: 0 },
      uStrength: { value: 1 },
      uOpacity: { value: 1 },
      uFrequency: { value: 8 },
      uDirection: { value: new Vector2(1, 0) }
    }),
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNormalV;
      void main() {
        vUv = uv;
        vNormalV = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uAge;
      uniform float uStrength;
      uniform float uOpacity;
      uniform float uFrequency;
      uniform vec2 uDirection;
      varying vec2 vUv;
      varying vec3 vNormalV;

      void main() {
        vec2 p = vUv * 2.0 - 1.0;
        float r = length(p);
        vec2 direction;
        float mask;

        #if DISTORTION_MODE == 1
          direction = normalize(vNormalV.xy + uDirection * 0.7 + vec2(1e-4));
          mask = smoothstep(1.0, 0.1, r) * (0.6 + 0.4 * sin(p.y * uFrequency + uTime * 7.0));
        #elif DISTORTION_MODE == 2
          direction = normalize(vec2(sign(p.x + 1e-4), sin(p.y * uFrequency + uTime * 5.0) * 0.3));
          mask = smoothstep(1.0, 0.55, abs(p.y)) * smoothstep(1.0, 0.05, abs(p.x));
        #else
          direction = normalize(p + vec2(1e-4));
          float ring = exp(-18.0 * abs(r - fract(uAge * 0.7) * 0.85));
          mask = smoothstep(1.0, 0.05, r) * (0.35 + ring);
        #endif

        float coverage = clamp(mask * uOpacity, 0.0, 1.0);
        if (coverage < 0.004) discard;
        gl_FragColor = vec4(direction * 0.5 + 0.5, uStrength, coverage);
      }
    `
  });
}
