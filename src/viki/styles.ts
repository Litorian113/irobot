import * as THREE from 'three'
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js'
import type { HeadConfig } from './config'
import { HEAD_DEFORM_GLSL, HEAD_PAINT_GLSL, HEAD_UNIFORMS_GLSL, NOISE_GLSL, type HeadUniforms } from './headShader'

/**
 * The non-lattice head styles. Each one draws the deformed head directly
 * (mesh or surface particles) with its own material; the post passes that
 * belong to a style live in ParticleFace.
 */

const commonVertex = /* glsl */ `
${HEAD_UNIFORMS_GLSL}
${HEAD_DEFORM_GLSL}
varying vec3 vLocal;
varying vec3 vNormal;   // head frame
varying vec3 vNormalW;  // world
varying vec3 vWorld;
varying float vHair;
void main() {
  vec3 q, l, nw;
  float hair;
  deformHead(position, normal, q, l, nw, hair);
  vLocal = l;
  vNormal = nw;
  vNormalW = normalize(mat3(modelMatrix) * nw);
  vHair = hair;
  vec4 w = modelMatrix * vec4(q, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`

const styleUniformsGlsl = /* glsl */ `
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uColorC;
uniform float uGain;
uniform float uTime;
uniform float uP0;
uniform float uP1;
uniform float uP2;
varying vec3 vLocal;
varying vec3 vNormal;
varying vec3 vNormalW;
varying vec3 vWorld;
varying float vHair;
`

// ---------------------------------------------------------------- contour

const contourFragment = /* glsl */ `
${HEAD_UNIFORMS_GLSL}
${HEAD_PAINT_GLSL}
${styleUniformsGlsl}
void main() {
  vec3 n = normalize(vNormal);
  float cav, maskv;
  float lum = paintLum(vLocal, n, vHair, cav, maskv);
  if (maskv < 0.02) discard;

  // topographic lines of head depth (uP0 = frequency, uP1 = line width)
  float h = vLocal.z * uP0;
  float f = fract(h);
  float d = fwidth(h);
  float w = uP1;
  float line = smoothstep(0.5 - w - d, 0.5 - w, f) - smoothstep(0.5 + w, 0.5 + w + d, f);
  line = clamp(line, 0.0, 1.0) * (1.0 - smoothstep(1.5, 4.0, d));

  vec3 nWorld = normalize(vNormalW);
  vec3 view = normalize(cameraPosition - vWorld);
  float rim = pow(1.0 - max(dot(nWorld, view), 0.0), 3.0);

  vec3 col = uColorB;
  col += uColorA * line * (0.3 + 1.0 * lum);
  col += uColorC * rim * 0.9;
  col *= 1.0 - 0.9 * cav;
  col *= mix(0.45, 1.0, uActive);  // dimmer while dormant
  gl_FragColor = vec4(col * uGain * maskv, 1.0);
}
`

// ---------------------------------------------------------------- dots (LED matrix, coloured by a post pass)

const dotsFragment = /* glsl */ `
${HEAD_UNIFORMS_GLSL}
${HEAD_PAINT_GLSL}
${styleUniformsGlsl}
void main() {
  vec3 n = normalize(vNormal);
  float cav, maskv;
  float lum = paintLum(vLocal, n, vHair, cav, maskv);
  if (maskv < 0.02) discard;
  gl_FragColor = vec4(vec3(lum * (1.0 - 0.9 * cav) * uGain * maskv * mix(0.45, 1.0, uActive)), 1.0);
}
`

/** Post pass: turns the luminance image into an LED dot matrix. */
export const DotMatrixShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uPitch: { value: 10 },
    uTime: { value: 0 },
    uFlicker: { value: 0.5 },
    uColorA: { value: new THREE.Color() },
    uColorB: { value: new THREE.Color() },
    uColorC: { value: new THREE.Color() },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uResolution;
    uniform float uPitch;
    uniform float uTime;
    uniform float uFlicker;
    uniform vec3 uColorA;
    uniform vec3 uColorB;
    uniform vec3 uColorC;
    varying vec2 vUv;
    float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise2(vec2 x) {
      vec2 i = floor(x); vec2 f = fract(x); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash2(i), hash2(i + vec2(1, 0)), f.x), mix(hash2(i + vec2(0, 1)), hash2(i + vec2(1, 1)), f.x), f.y);
    }
    void main() {
      vec2 px = vUv * uResolution;
      vec2 cell = floor(px / uPitch);
      vec2 center = (cell + 0.5) * uPitch;
      vec3 s = texture2D(tDiffuse, center / uResolution).rgb;
      float b = max(max(s.r, s.g), s.b);
      float r = length(px - center) / uPitch;
      float radius = 0.10 + 0.32 * smoothstep(0.0, 1.0, b);
      float disc = 1.0 - smoothstep(radius - 0.07, radius + 0.07, r);
      // warm patches drifting slowly over the cool base, plus per-dot twinkle
      float pat = noise2(cell * 0.11 + vec2(uTime * 0.06 * (0.3 + uFlicker), uTime * 0.02));
      float warm = smoothstep(0.52, 0.62, pat);
      float tw = 0.75 + 0.5 * hash2(cell + floor(uTime * (0.5 + 4.0 * uFlicker)));
      vec3 col = mix(uColorA, uColorB, warm);
      col = mix(col, uColorC, smoothstep(0.85, 1.1, b * tw));
      gl_FragColor = vec4(col * disc * (0.05 + 1.05 * b) * tw, 1.0);
    }`,
}

// ---------------------------------------------------------------- plasma

const plasmaFragment = /* glsl */ `
${HEAD_UNIFORMS_GLSL}
${HEAD_PAINT_GLSL}
${NOISE_GLSL}
${styleUniformsGlsl}
void main() {
  vec3 n = normalize(vNormal);
  float cav, maskv;
  float lum = paintLum(vLocal, n, vHair, cav, maskv);
  if (maskv < 0.02) discard;

  vec3 nWorld = normalize(vNormalW);
  vec3 view = normalize(cameraPosition - vWorld);
  float rim = pow(1.0 - max(dot(nWorld, view), 0.0), 2.0);

  // a flame of colour on the crown (uP0 = turbulence)
  float t = uTime * (0.3 + 1.2 * uP0);
  vec3 p = vLocal * 3.0 + vec3(0.0, -t * 0.6, 0.0);
  float nz = noise3(p) * 0.6 + noise3(p * 2.3 + 5.0) * 0.4;
  float crown = smoothstep(0.72, 1.05, vLocal.y + 0.3 * (nz - 0.5) + 0.35 * vHair);
  float flame = crown * (0.35 + 0.9 * nz);
  vec3 pal = mix(uColorA, uColorB, smoothstep(0.25, 0.6, flame));
  pal = mix(pal, uColorC, smoothstep(0.55, 0.9, flame));
  pal = mix(pal, vec3(1.0), smoothstep(0.85, 1.15, flame));

  vec3 col = uColorA * 0.06;
  col += uColorA * rim * 0.7;
  col += pal * flame * 1.6;
  col += uColorA * lum * 0.22 * uActive;   // the face glows through when she is awake
  col *= 1.0 - 0.8 * cav;
  col *= mix(0.5, 1.0, uActive);  // dimmer while dormant
  gl_FragColor = vec4(col * uGain * maskv, 1.0);
}
`

/** Post pass: chromatic aberration (radial RGB split). */
export const ChromaShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uAmount: { value: 0.01 },
  },
  vertexShader: DotMatrixShader.vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uAmount;
    varying vec2 vUv;
    void main() {
      vec2 d = (vUv - 0.5) * uAmount;
      float r = texture2D(tDiffuse, vUv + d).r;
      float g = texture2D(tDiffuse, vUv).g;
      float b = texture2D(tDiffuse, vUv - d).b;
      gl_FragColor = vec4(r, g, b, 1.0);
    }`,
}

// ---------------------------------------------------------------- dust (surface particles)

const dustVertex = /* glsl */ `
${HEAD_UNIFORMS_GLSL}
${HEAD_DEFORM_GLSL}
${HEAD_PAINT_GLSL}
uniform float uTime;
uniform float uScatter;
uniform float uDotSize;
uniform float uPointBase;
uniform float uCamDist;
attribute vec4 aSeed;
varying float vLum;
varying float vCav;
varying float vSparkle;
void main() {
  vec3 q, l, nw;
  float hair;
  deformHead(position, normal, q, l, nw, hair);
  float cav, maskv;
  float lum = paintLum(l, nw, hair, cav, maskv);
  vLum = lum;
  vCav = cav;
  vSparkle = step(0.965, aSeed.w);

  // particles drift off the surface, most of all at the silhouette and when she is dormant
  vec3 nView = normalize(normalMatrix * nw);
  float edge = pow(1.0 - abs(nView.z), 3.0);
  float dormant = 1.0 - uActive;
  float amount = uScatter * (0.06 + 1.2 * edge) + dormant * 0.9;
  float wobble = sin(uTime * 1.5 + aSeed.y * 40.0) * 0.5 + 0.5;
  q += nw * (aSeed.x - 0.35) * amount * (0.4 + 0.6 * wobble) * 0.5;
  q += (vec3(aSeed.y, aSeed.z, aSeed.x) - 0.5) * dormant * 0.3;

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
void main() {
  vec2 c = gl_PointCoord - 0.5;
  if (dot(c, c) > 0.25) discard;
  vec3 col = mix(uColorA, uColorB, clamp(vLum * 1.1, 0.0, 1.0));
  col = mix(col, uColorC, vSparkle * 0.9);
  col *= 1.0 - 0.85 * vCav;
  gl_FragColor = vec4(col * uGain, 1.0);
}
`

// ---------------------------------------------------------------- cages
// Every style gets a faint surrounding cube drawn in its own language:
// contour = soft wrapping lines, dots = a dot grid on the faces,
// plasma = softly glowing edges with a drifting shimmer, dust = thin haze.

const cageVertex = /* glsl */ `
varying vec3 vP;
void main() {
  vP = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const cageFragment = /* glsl */ `
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uIntensity;
uniform float uTime;
uniform float uMode; // 0 lines, 1 dots, 2 plasma
varying vec3 vP;
float hashC(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noiseC(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hashC(i), hashC(i + vec3(1, 0, 0)), f.x), mix(hashC(i + vec3(0, 1, 0)), hashC(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hashC(i + vec3(0, 0, 1)), hashC(i + vec3(1, 0, 1)), f.x), mix(hashC(i + vec3(0, 1, 1)), hashC(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
void main() {
  vec3 a = abs(vP);
  vec2 uv = (a.x > a.y && a.x > a.z) ? vP.yz : (a.y > a.z ? vP.xz : vP.xy);
  float bright = 0.0;
  if (uMode < 0.5) {
    // soft lines wrapping the cube; square rings on top and bottom
    float coord = (a.y > a.x && a.y > a.z) ? max(a.x, a.z) : vP.y * 0.5 + 0.5;
    float h = coord * 16.0;
    float f = fract(h);
    float d = fwidth(h);
    bright = smoothstep(0.5 - 0.08 - d, 0.5 - 0.08, f) - smoothstep(0.5 + 0.08, 0.5 + 0.08 + d, f);
    bright = clamp(bright, 0.0, 1.0) * (1.0 - smoothstep(1.0, 3.0, d)) * 0.55;
  } else if (uMode < 1.5) {
    // a quiet dot grid on the faces
    vec2 g = fract(uv * 13.0) - 0.5;
    bright = smoothstep(0.30, 0.10, length(g)) * (0.4 + 0.3 * hashC(floor(vec3(uv * 13.0, uMode))));
  } else {
    // glowing edges + a slow shimmer drifting across the faces
    float border = pow(max(abs(uv.x), abs(uv.y)), 8.0);
    bright = border * 0.9 + 0.22 * noiseC(vP * 1.6 + vec3(0.0, uTime * 0.12, 0.0));
  }
  vec3 col = mix(uColorA, uColorB, 0.35 * (1.0 + sin(vP.y * 2.0)));
  gl_FragColor = vec4(col * bright * uIntensity, 1.0);
}
`

function makeCage(mode: number): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    vertexShader: cageVertex,
    fragmentShader: cageFragment,
    uniforms: {
      uColorA: { value: new THREE.Color() },
      uColorB: { value: new THREE.Color() },
      uIntensity: { value: 0.06 },
      uTime: { value: 0 },
      uMode: { value: mode },
    },
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  })
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), mat)
  mesh.frustumCulled = false
  mesh.visible = false
  mesh.renderOrder = -1
  return mesh
}

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

const DUST_MAX = 220000

export interface StyleSet {
  contour: THREE.Mesh
  dots: THREE.Mesh
  plasma: THREE.Mesh
  dust: THREE.Points
  cages: { contour: THREE.Mesh; dots: THREE.Mesh; plasma: THREE.Mesh; dust: THREE.Points }
  dotMatrix: THREE.ShaderMaterial
  chroma: THREE.ShaderMaterial
  setTime: (t: number) => void
  applyConfig: (cfg: HeadConfig, styleId: string) => void
  setDustBase: (pointBase: number) => void
  dispose: () => void
}

export function createStyles(uniforms: HeadUniforms, geometry: THREE.BufferGeometry, camDist: number): StyleSet {
  const makeStyleUniforms = () => ({
    ...uniforms,
    uColorA: { value: new THREE.Color() },
    uColorB: { value: new THREE.Color() },
    uColorC: { value: new THREE.Color() },
    uGain: { value: 1 },
    uTime: { value: 0 },
    uP0: { value: 0 },
    uP1: { value: 0 },
    uP2: { value: 0 },
  })

  const contourMat = new THREE.ShaderMaterial({ vertexShader: commonVertex, fragmentShader: contourFragment, uniforms: makeStyleUniforms() })
  const dotsMat = new THREE.ShaderMaterial({ vertexShader: commonVertex, fragmentShader: dotsFragment, uniforms: makeStyleUniforms() })
  const plasmaMat = new THREE.ShaderMaterial({ vertexShader: commonVertex, fragmentShader: plasmaFragment, uniforms: makeStyleUniforms() })
  const mk = (m: THREE.Material) => {
    const mesh = new THREE.Mesh(geometry, m)
    mesh.frustumCulled = false
    mesh.visible = false
    return mesh
  }
  const contour = mk(contourMat)
  const dots = mk(dotsMat)
  const plasma = mk(plasmaMat)

  // dust: points sampled on the scan surface, deformed like the mesh
  const sampler = new MeshSurfaceSampler(new THREE.Mesh(geometry)).build()
  const pos = new Float32Array(DUST_MAX * 3)
  const nor = new Float32Array(DUST_MAX * 3)
  const seed = new Float32Array(DUST_MAX * 4)
  const p = new THREE.Vector3()
  const n = new THREE.Vector3()
  for (let i = 0; i < DUST_MAX; i++) {
    sampler.sample(p, n)
    pos.set([p.x, p.y, p.z], i * 3)
    nor.set([n.x, n.y, n.z], i * 3)
    seed.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4)
  }
  const dustGeo = new THREE.BufferGeometry()
  dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  dustGeo.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  dustGeo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4))
  const dustMat = new THREE.ShaderMaterial({
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
      uDotSize: { value: 1 },
      uPointBase: { value: 2 },
      uCamDist: { value: camDist },
    },
  })
  const dust = new THREE.Points(dustGeo, dustMat)
  dust.frustumCulled = false
  dust.visible = false

  const cages = { contour: makeCage(0), dots: makeCage(1), plasma: makeCage(2), dust: makeDustCage() }
  const cageMat = (o: THREE.Object3D) => (o as THREE.Mesh).material as THREE.ShaderMaterial

  const dotMatrix = new THREE.ShaderMaterial({ ...DotMatrixShader, uniforms: THREE.UniformsUtils.clone(DotMatrixShader.uniforms) })
  const chroma = new THREE.ShaderMaterial({ ...ChromaShader, uniforms: THREE.UniformsUtils.clone(ChromaShader.uniforms) })

  const setColors = (u: Record<string, { value: unknown }>, cfg: HeadConfig) => {
    ;(u.uColorA.value as THREE.Color).set(cfg.colorA)
    ;(u.uColorB.value as THREE.Color).set(cfg.colorB)
    ;(u.uColorC.value as THREE.Color).set(cfg.colorC)
    if (u.uGain) u.uGain.value = cfg.gain
  }

  return {
    contour,
    dots,
    plasma,
    dust,
    cages,
    dotMatrix,
    chroma,
    setTime: (t) => {
      contourMat.uniforms.uTime.value = t
      dotsMat.uniforms.uTime.value = t
      plasmaMat.uniforms.uTime.value = t
      dustMat.uniforms.uTime.value = t
      dotMatrix.uniforms.uTime.value = t
      for (const c of Object.values(cages)) cageMat(c).uniforms.uTime.value = t
    },
    applyConfig: (cfg, styleId) => {
      const cage = cages[styleId as keyof typeof cages] as THREE.Object3D | undefined
      if (cage) {
        const u = cageMat(cage).uniforms
        ;(u.uColorA.value as THREE.Color).set(cfg.colorA)
        ;(u.uColorB.value as THREE.Color).set(styleId === 'contour' ? cfg.colorA : cfg.colorB)
        u.uIntensity.value = (styleId === 'dust' ? 0.55 : 0.12) * cfg.cage
      }
      switch (styleId) {
        case 'contour':
          setColors(contourMat.uniforms, cfg)
          contourMat.uniforms.uP0.value = 8 + 52 * cfg.density
          contourMat.uniforms.uP1.value = cfg.lineWidth
          break
        case 'dots':
          setColors(dotsMat.uniforms, cfg)
          setColors(dotMatrix.uniforms, cfg)
          dotMatrix.uniforms.uPitch.value = 18 - 12 * cfg.density
          dotMatrix.uniforms.uFlicker.value = cfg.flicker
          break
        case 'plasma':
          setColors(plasmaMat.uniforms, cfg)
          plasmaMat.uniforms.uP0.value = cfg.flicker
          chroma.uniforms.uAmount.value = 0.03 * cfg.chroma
          break
        case 'dust':
          setColors(dustMat.uniforms, cfg)
          dustMat.uniforms.uScatter.value = cfg.scatter
          dustMat.uniforms.uDotSize.value = cfg.dotSize
          dustGeo.setDrawRange(0, Math.floor(DUST_MAX * cfg.density))
          break
        default:
          break
      }
    },
    setDustBase: (pointBase) => {
      dustMat.uniforms.uPointBase.value = pointBase
      cageMat(cages.dust).uniforms.uPointBase.value = pointBase
    },
    dispose: () => {
      for (const c of Object.values(cages)) {
        cageMat(c).dispose()
        ;(c as THREE.Mesh).geometry.dispose()
      }
      contourMat.dispose()
      dotsMat.dispose()
      plasmaMat.dispose()
      dustMat.dispose()
      dustGeo.dispose()
      dotMatrix.dispose()
      chroma.dispose()
    },
  }
}
