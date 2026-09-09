import * as THREE from 'three'
import { sampleAnimatedSurface } from './sampleSurface'
import type { HeadConfig } from './config'
import { HEAD_DEFORM_GLSL, HEAD_MORPH_GLSL, HEAD_MORPH_INPUT_GLSL, HEAD_PAINT_GLSL, HEAD_UNIFORMS_GLSL, type HeadUniforms } from './headShader'
import { DUST_CLOUD_FIELD_GLSL } from './dustCloudField'

/**
 * The dust head style: particles sampled on the rigged scan surface. They carry
 * the head's morph targets (visemes, expressions), so the same lip system that
 * drives the lattice portrait moves the dust. At rest these same particles expand
 * into a viewport-filling volume of drifting clouds and soft haze.
 */

// ---------------------------------------------------------------- dust (surface particles)

const dustVertex = /* glsl */ `
${HEAD_UNIFORMS_GLSL}
${HEAD_DEFORM_GLSL}
${HEAD_MORPH_GLSL}
${HEAD_PAINT_GLSL}
${DUST_CLOUD_FIELD_GLSL}
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
  vec3 surface = q;
  vec3 resting = (vec3(aSeed.y, aSeed.z, aSeed.x) * 2.0 - 1.0) * 0.97;
  resting += 0.025 * sin(uTime * 0.4 + aSeed.xyz * 40.0);
  q = mix(q, resting, dormant);
  vLum = mix(0.12, lum, 1.0 - dormant);
  vOpacity = uTransition > 0.5 ? sin(clamp(uFormation, 0.0, 1.0) * 3.14159) * 0.48 : mix(0.08, 1.0, uFormation);

  vec4 mv = modelViewMatrix * vec4(q, 1.0);
  // Change only Dust's resting positions. The fully formed head and Lattice's
  // existing transition retain their original positions, shading and point sizes.
  if (uTransition < 0.5 && dormant > 0.0) {
    float cloudLight;
    vec3 cloud = dustCloudPosition(aSeed, uTime, cloudLight);
    // Gather the wide cloud directly into the animated skin in view space.
    vec3 skinView = (modelViewMatrix * vec4(surface, 1.0)).xyz;
    mv = vec4(mix(skinView, cloud, dormant), 1.0);
    vLum = mix(0.58, lum, 1.0 - dormant);
    vCav *= 1.0 - dormant;
    vSparkle = mix(0.18 + aSeed.z * 0.34, vSparkle, 1.0 - dormant);
    vOpacity = mix(min(0.85, 0.30 * cloudLight), 1.0, uFormation);
  }
  gl_Position = projectionMatrix * mv;
  float size = (0.9 + 1.6 * aSeed.z) * uDotSize;
  gl_PointSize = uPointBase * size * (uCamDist / -mv.z);
  if (maskv < 0.05 && (uTransition > 0.5 || dormant == 0.0)) gl_PointSize = 0.0;
}
`

const dustFragment = /* glsl */ `
uniform float uLighting;
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
  gl_FragColor = vec4(col * uGain * mix(uLighting > 1.5 ? 0.0 : 0.15, 1.0, clamp(vLum * 1.3, 0.0, 1.0)), vOpacity);
}
`

const cageDustVertex = /* glsl */ `
${DUST_CLOUD_FIELD_GLSL}
uniform float uTime;
uniform float uPointBase;
uniform float uFormation;
attribute vec3 aSeed;
varying float vA;
varying float vCloud;
varying float vMist;
varying float vCore;
varying float vTint;
void main() {
  vec3 p = position + 0.04 * sin(uTime * 0.4 + aSeed * 6.2831);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float originalSize = uPointBase * (0.6 + aSeed.x) * (4.2 / -mv.z);
  vA = 0.5 + 0.5 * aSeed.y;
  vCloud = 1.0 - smoothstep(0.0, 1.0, uFormation);
  float dormant = vCloud;
  float cloudLight;
  vec3 cloud = dustCloudPosition(vec4(aSeed, position.z * 0.5 + 0.5), uTime, cloudLight);
  // Keep a quiet fringe at the sides when awake; leave the head's central space clear.
  float side = smoothstep(1.15, 1.65, abs(cloud.x / -cloud.z) * uFieldView.z);
  vCloud = mix(vCloud, 1.0, side);
  // Choose haze independently of the flow seeds, distributing it across every cloud.
  vMist = step(0.60, fract(dot(position, vec3(13.731, 17.133, 3.173))));
  vTint = aSeed.z;
  vCore = 1.0;
  gl_PointSize = originalSize;
  if (vCloud > 0.0) {
    mv.xyz = mix(mv.xyz, cloud, vCloud);
    float cloudSize = uPointBase * mix(0.8 + aSeed.y, 48.0 + 54.0 * aSeed.y, vMist) * (4.2 / -cloud.z);
    gl_PointSize = mix(originalSize, cloudSize, vCloud);
    vCore = min(1.0, originalSize / gl_PointSize);
    vA = mix(vA, cloudLight * mix(0.7, 1.0, dormant), vCloud);
  }
  gl_Position = projectionMatrix * mv;
}
`

const cageDustFragment = /* glsl */ `
uniform vec3 uColorB;
uniform vec3 uColorC;
uniform float uIntensity;
varying float vA;
varying float vCloud;
varying float vMist;
varying float vCore;
varying float vTint;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r2 = dot(c, c);
  if (r2 > 0.25) discard;
  vec3 original = uColorB * vA * uIntensity;
  if (vCloud == 0.0) {
    gl_FragColor = vec4(original, 1.0);
    return;
  }
  float core = 1.0 - step(0.25 * vCore * vCore, r2);
  float soft = exp(-18.0 * r2) * (1.0 - smoothstep(0.17, 0.25, r2));
  float profile = mix(1.0 - smoothstep(0.06, 0.25, r2), soft * 0.10, vMist);
  vec3 cloud = mix(uColorB, uColorC, vTint * 0.65) * vA * uIntensity * profile;
  gl_FragColor = vec4(original * core * (1.0 - vCloud) + cloud * vCloud, 1.0);
}
`

function makeDustCage(formation: HeadUniforms['uFormation'], fieldView: { value: THREE.Vector3 }): THREE.Points {
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
      uColorC: { value: new THREE.Color() },
      uFormation: formation,
      uFieldView: fieldView,
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
  setFieldView: (camera: THREE.PerspectiveCamera) => void
  dispose: () => void
}

export function createStyles(uniforms: HeadUniforms, geometry: THREE.BufferGeometry, camDist: number): StyleSet {
  const fieldView = { value: new THREE.Vector3(1, 1, camDist) }
  // dust: points sampled on the scan surface, deformed like the mesh
  const dustGeo = sampleAnimatedSurface(geometry, DUST_MAX)
  const dustMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    vertexShader: dustVertex,
    fragmentShader: dustFragment,
    uniforms: {
      ...uniforms,
      uFieldView: fieldView,
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

  const cage = makeDustCage(uniforms.uFormation, fieldView)
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
      ;(cageMat.uniforms.uColorC.value as THREE.Color).set(cfg.colorC)
      cageMat.uniforms.uIntensity.value = 0.55 * cfg.cage
    },
    setDustBase: (pointBase) => {
      dustMat.uniforms.uPointBase.value = pointBase
      cageMat.uniforms.uPointBase.value = pointBase
    },
    setFieldView: (camera) => {
      const p = camera.projectionMatrix.elements
      fieldView.value.set(1 / p[0], 1 / p[5], camera.position.z)
    },
    dispose: () => {
      cageMat.dispose()
      cage.geometry.dispose()
      dustMat.dispose()
      dustGeo.dispose()
    },
  }
}
