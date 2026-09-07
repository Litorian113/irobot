import * as THREE from 'three'
import { HEAD_DEFORM_GLSL, HEAD_MORPH_GLSL, HEAD_MORPH_INPUT_GLSL, HEAD_PAINT_GLSL, HEAD_UNIFORMS_GLSL, type HeadUniforms } from './headShader'
import type { HeadConfig } from './config'

const vertex = /* glsl */ `
${HEAD_UNIFORMS_GLSL}
${HEAD_DEFORM_GLSL}
${HEAD_MORPH_GLSL}
varying vec3 vLocal;
varying vec3 vNormal;
varying vec3 vWorld;
varying vec3 vHeadPosition;
varying vec3 vNormalWorld;
varying vec3 vPattern;
varying vec3 vPatternNormal;
varying float vHair;
void main() {
  vec3 q, l, n;
  float hair;
  ${HEAD_MORPH_INPUT_GLSL}
  deformHead(transformed, objectNormal, q, l, n, hair);
  vLocal = l;
  vNormal = n;
  vPattern = toLocal((uHeadMatrix * vec4(position, 1.0)).xyz);
  vPatternNormal = normal;
  vWorld = (modelMatrix * vec4(q, 1.0)).xyz;
  vHeadPosition = q;
  vNormalWorld = normalize(mat3(modelMatrix) * n);
  vHair = hair;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(q, 1.0);
}
`

const fragment = /* glsl */ `
${HEAD_UNIFORMS_GLSL}
${HEAD_PAINT_GLSL}
varying float vFeature;
uniform vec3 uColor;
uniform vec3 uHighlight;
uniform float uGain;
uniform float uTime;
uniform float uTurbulence;
uniform float uDensity;
uniform float uPointSize;
uniform float uVariation;
uniform float uDiagnostic;
uniform float uOptical;
varying vec3 vLocal;
varying vec3 vNormal;
varying vec3 vWorld;
varying vec3 vHeadPosition;
varying vec3 vNormalWorld;
varying vec3 vPattern;
varying vec3 vPatternNormal;
varying float vHair;

// A single, anti-aliased layer of data points attached to the surface.
// Triplanar projection preserves the point spacing when the head is turned.
float pointGrid(vec2 uv) {
  vec2 grid = uv * uDensity;
  vec2 cell = floor(grid);
  vec2 center = fract(grid) - 0.5;
  float radius = clamp(0.27 * uPointSize, 0.12, 0.46);
  float footprint = max(length(dFdx(grid)), length(dFdy(grid)));
  float aa = clamp(footprint * 0.5, 0.015, 0.18);
  float disc = 1.0 - smoothstep(radius - aa, radius + aa, length(center));
  // Unresolved points converge to their area, not a bright solid patch.
  disc = mix(disc, 3.14159 * radius * radius, smoothstep(0.65, 1.2, footprint));
  float shimmer = 0.88 + 0.12 * sin(dot(cell, vec2(0.73, 1.37)) + uTime * 0.6);
  return disc * mix(1.0, shimmer, uVariation);
}

// Shallow square cells under the glass, with fine dark seams rather than LED dots.
float tileSurface(vec2 uv) {
  vec2 grid = uv * uDensity * 0.42;
  vec2 seamDistance = min(fract(grid), 1.0 - fract(grid));
  vec2 aa = max(fwidth(grid) * 0.4, vec2(0.005));
  float gap = clamp(0.055 / uPointSize, 0.025, 0.12);
  vec2 inside = smoothstep(vec2(gap) - aa, vec2(gap) + aa, seamDistance);
  float tile = inside.x * inside.y;
  float variation = 0.90 + 0.10 * hashH(vec3(floor(grid), 7.0));
  return (0.33 + 0.17 * tile) * variation;
}
void main() {
  vec3 n = normalize(vNormal);
  float cavity, maskv;
  float light = paintLum(vLocal, n, vHeadPosition, vHair, vFeature, cavity, maskv);
  // The neck dissolves before the cut edge of the scan's shoulders.
  maskv *= smoothstep(-0.24, -0.02, vLocal.y);
  if (maskv < 0.005 || headCoverage(vLocal) < 0.5) discard;
  if (uDiagnostic > 0.5) {
    gl_FragColor = vec4(vec3(light), 1.0);
    return;
  }
  // Attach the pattern to the neutral mesh so points follow the lids and lips.
  vec3 weights = pow(abs(normalize(vPatternNormal)), vec3(6.0));
  weights /= max(dot(weights, vec3(1.0)), 0.001);
  float dots = dot(weights, vec3(pointGrid(vPattern.yz), pointGrid(vPattern.xz), pointGrid(vPattern.xy)));
  // A single frontal projection across the moving apertures avoids stretched
  // rows and overlapping projection axes when the lids close or lips part.
  float eyes = 1.0 - smoothstep(0.7, 1.5, length(vec2((abs(vLocal.x) - uEyeX) / 0.11, (vLocal.y - uEyeY) / 0.085)));
  float lips = 1.0 - smoothstep(0.7, 1.5, length(vec2(vLocal.x / 0.20, (vLocal.y - uMouthY) / 0.12)));
  dots = mix(dots, pointGrid(vLocal.xy), max(eyes, lips) * smoothstep(0.10, 0.30, vLocal.z));
  float formation = uFormation * (1.0 - 0.3 * uTurbulence);
  vec3 color = mix(uColor, uHighlight, smoothstep(0.55, 0.9, light) * 0.3);
  // A whisper of continuous shading connects the points into a readable face.
  float surface = mix(0.08 + 0.84 * dots, tileSurface(vPattern.xy), uOptical);
  float alpha = surface * maskv * formation;
  float facing = dot(normalize(vNormalWorld), normalize(cameraPosition - vWorld));
  alpha *= smoothstep(0.0, 0.45, facing);
  gl_FragColor = vec4(color * pow(light, 1.35) * uGain, alpha);
}
`

/** Surface data points with a separate depth prepass and no stacked voxel shells. */
export class SurfacePortrait {
  readonly group = new THREE.Group()
  private material: THREE.ShaderMaterial
  private depthMaterial: THREE.ShaderMaterial

  constructor(head: HeadUniforms, geometry: THREE.BufferGeometry) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: {
        ...head,
        uTime: { value: 0 },
        uTurbulence: { value: 0 },
        uDensity: { value: 130 },
        uPointSize: { value: 1 },
        uVariation: { value: 0.2 },
        uOptical: { value: 0 },
        uDiagnostic: { value: new URLSearchParams(window.location.search).has('inspect') ? 1 : 0 },
        uColor: { value: new THREE.Color() },
        uHighlight: { value: new THREE.Color() },
        uGain: { value: 1 },
      },
      transparent: true,
      depthTest: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    })
    // Write the nearest surface before any translucent triangles. Otherwise
    // the rear skull / inner eye geometry can accumulate through the face.
    this.depthMaterial = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: /* glsl */ `
        ${HEAD_UNIFORMS_GLSL}
        varying vec3 vLocal;
        void main() {
          if (vLocal.y < -0.24 || headCoverage(vLocal) < 0.5) discard;
          gl_FragColor = vec4(0.0);
        }`,
      uniforms: head,
      colorWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
      depthWrite: true,
    })
    const depth = new THREE.Mesh(geometry, this.depthMaterial)
    depth.frustumCulled = false
    const mesh = new THREE.Mesh(geometry, this.material)
    mesh.frustumCulled = false
    mesh.renderOrder = -1
    this.group.add(depth, mesh)
  }

  applyConfig(config: HeadConfig) {
    const u = this.material.uniforms
    u.uColor.value.set(config.colorB)
    u.uHighlight.value.set(config.colorC)
    u.uOptical.value = config.optical ? 1 : 0
    u.uGain.value = config.gain
    u.uVariation.value = config.flicker
    u.uDensity.value = 70 + 95 * config.density
    u.uPointSize.value = config.cellSize
  }

  update(time: number, formation: number, turbulence: number) {
    this.material.uniforms.uTime.value = time
    this.material.uniforms.uFormation.value = formation
    this.material.uniforms.uTurbulence.value = turbulence
  }

  dispose() {
    this.material.dispose()
    this.depthMaterial.dispose()
  }
}
