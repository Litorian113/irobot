import * as THREE from 'three'
import { sampleAnimatedSurface } from './sampleSurface'
import type { HeadConfig } from './config'
import { HEAD_DEFORM_GLSL, HEAD_MORPH_GLSL, HEAD_MORPH_INPUT_GLSL, HEAD_PAINT_GLSL, HEAD_UNIFORMS_GLSL, type HeadUniforms } from './headShader'

/**
 * The dust head style: particles sampled on the rigged scan surface. They carry
 * the head's morph targets (visemes, expressions), so the same lip system that
 * drives the lattice portrait moves the dust. A thin haze of drifting particles
 * forms the surrounding cube.
 */

// ---------------------------------------------------------------- dust (surface particles)

const dustVertex = /* glsl */ `
${HEAD_UNIFORMS_GLSL}
${HEAD_DEFORM_GLSL}
${HEAD_MORPH_GLSL}
${HEAD_PAINT_GLSL}
uniform float uTime;
uniform float uScatter;
uniform float uTransition;
uniform float uDotSize;
uniform float uPointBase;
uniform float uCamDist;
attribute vec4 aSeed;
varying float vLum;
varying float vCav;
varying float vSparkle;
varying float vOpacity;
void main() {
  vec3 q, l, nw;
  float hair;
  ${HEAD_MORPH_INPUT_GLSL}
  deformHead(transformed, objectNormal, q, l, nw, hair);
  float cav, maskv;
  float lum = paintLum(l, nw, q, hair, aFeature, cav, maskv);
  vLum = lum;
  vCav = cav;
  vSparkle = step(0.965, aSeed.w);

  // particles drift off the surface, most of all at the silhouette and when she is dormant
  vec3 nView = normalize(normalMatrix * nw);
  float edge = pow(1.0 - abs(nView.z), 3.0);
  float dormant = 1.0 - smoothstep(0.0, 1.0, uFormation);
  float amount = uScatter * (0.06 + 1.2 * edge) + dormant * 0.9;
  float wobble = sin(uTime * 1.5 + aSeed.y * 40.0) * 0.5 + 0.5;
  q += nw * (aSeed.x - 0.35) * amount * (0.4 + 0.6 * wobble) * 0.5;
  vec3 resting = (vec3(aSeed.y, aSeed.z, aSeed.x) * 2.0 - 1.0) * 0.97;
  resting += 0.025 * sin(uTime * 0.4 + aSeed.xyz * 40.0);
  q = mix(q, resting, dormant);
  vLum = mix(0.12, lum, 1.0 - dormant);
  vOpacity = uTransition > 0.5 ? sin(clamp(uFormation, 0.0, 1.0) * 3.14159) * 0.48 : mix(0.08, 1.0, uFormation);

  vec4 mv = modelViewMatrix * vec4(q, 1.0);
  gl_Position = projectionMatrix * mv;
  float size = (0.9 + 1.6 * aSeed.z) * uDotSize;
  gl_PointSize = uPointBase * size * (uCamDist / -mv.z);
  if (maskv < 0.05) gl_PointSize = 0.0;
}
`

const dustFragment = /* glsl */ `
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uColorC;
uniform float uGain;
varying float vLum;
varying float vCav;
varying float vSparkle;
varying float vOpacity;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  if (dot(c, c) > 0.25) discard;
  vec3 col = mix(uColorA, uColorB, clamp(vLum * 1.1, 0.0, 1.0));
  col = mix(col, uColorC, vSparkle * 0.9);
  col *= 1.0 - 0.85 * vCav;
  gl_FragColor = vec4(col * uGain * mix(0.15, 1.0, clamp(vLum * 1.3, 0.0, 1.0)), vOpacity);
}
`

const cageDustVertex = /* glsl */ `
uniform float uTime;
uniform float uPointBase;
attribute vec3 aSeed;
varying float vA;
void main() {
  vec3 p = position + 0.04 * sin(uTime * 0.4 + aSeed * 6.2831);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uPointBase * (0.6 + aSeed.x) * (4.2 / -mv.z);
  vA = 0.5 + 0.5 * aSeed.y;
}
`

const cageDustFragment = /* glsl */ `
uniform vec3 uColorB;
uniform float uIntensity;
varying float vA;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  if (dot(c, c) > 0.25) discard;
  gl_FragColor = vec4(uColorB * vA * uIntensity, 1.0);
}
`

function makeDustCage(): THREE.Points {
  const N = 3500
  const pos = new Float32Array(N * 3)
  const seed = new Float32Array(N * 3)
  for (let i = 0; i < N * 3; i++) {
    pos[i] = Math.random() * 2 - 1
    seed[i] = Math.random()
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3))
  const mat = new THREE.ShaderMaterial({
    vertexShader: cageDustVertex,
    fragmentShader: cageDustFragment,
    uniforms: {
      uColorA: { value: new THREE.Color() },
      uColorB: { value: new THREE.Color() },
      uIntensity: { value: 0.3 },
      uTime: { value: 0 },
      uPointBase: { value: 2 },
    },
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  })
  const pts = new THREE.Points(geo, mat)
  pts.frustumCulled = false
  pts.visible = false
  pts.renderOrder = -1
  return pts
}

const DUST_MAX = 70000

export interface StyleSet {
  dust: THREE.Points
  cage: THREE.Points
  setTransition: (on: boolean) => void
  setTime: (t: number) => void
  applyConfig: (cfg: HeadConfig) => void
  setDustBase: (pointBase: number) => void
  dispose: () => void
}

export function createStyles(uniforms: HeadUniforms, geometry: THREE.BufferGeometry, camDist: number): StyleSet {
  // dust: points sampled on the scan surface, deformed like the mesh
  const dustGeo = sampleAnimatedSurface(geometry, DUST_MAX)
  const dustMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    vertexShader: dustVertex,
    fragmentShader: dustFragment,
    uniforms: {
      ...uniforms,
      uColorA: { value: new THREE.Color() },
      uColorB: { value: new THREE.Color() },
      uColorC: { value: new THREE.Color() },
      uGain: { value: 1 },
      uTime: { value: 0 },
      uScatter: { value: 0.5 },
      uTransition: { value: 0 },
      uDotSize: { value: 1 },
      uPointBase: { value: 2 },
      uCamDist: { value: camDist },
    },
  })
  const dust = new THREE.Points(dustGeo, dustMat)
  dust.frustumCulled = false
  dust.visible = false

  const cage = makeDustCage()
  const cageMat = cage.material as THREE.ShaderMaterial

  return {
    dust,
    cage,
    setTransition: (on) => {
      dustMat.uniforms.uTransition.value = on ? 1 : 0
      // Active Dust retains nearest-particle occlusion; the transient lattice
      // scatter must not write depth over the dissolving portrait.
      dustMat.depthWrite = !on
    },
    setTime: (t) => {
      dustMat.uniforms.uTime.value = t
      cageMat.uniforms.uTime.value = t
    },
    applyConfig: (cfg) => {
      ;(dustMat.uniforms.uColorA.value as THREE.Color).set(cfg.colorA)
      ;(dustMat.uniforms.uColorB.value as THREE.Color).set(cfg.colorB)
      ;(dustMat.uniforms.uColorC.value as THREE.Color).set(cfg.colorC)
      dustMat.uniforms.uGain.value = cfg.gain
      dustMat.uniforms.uScatter.value = cfg.scatter
      dustMat.uniforms.uDotSize.value = cfg.dotSize
      dustGeo.setDrawRange(0, Math.floor(DUST_MAX * cfg.density))
      ;(cageMat.uniforms.uColorA.value as THREE.Color).set(cfg.colorA)
      ;(cageMat.uniforms.uColorB.value as THREE.Color).set(cfg.colorB)
      cageMat.uniforms.uIntensity.value = 0.55 * cfg.cage
    },
    setDustBase: (pointBase) => {
      dustMat.uniforms.uPointBase.value = pointBase
      cageMat.uniforms.uPointBase.value = pointBase
    },
    dispose: () => {
      cageMat.dispose()
      cage.geometry.dispose()
      dustMat.dispose()
      dustGeo.dispose()
    },
  }
}
