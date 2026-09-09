import * as THREE from 'three'
import { HEAD_DEFORM_GLSL, HEAD_MORPH_GLSL, HEAD_MORPH_INPUT_GLSL, HEAD_PAINT_GLSL, HEAD_UNIFORMS_GLSL, type HeadUniforms } from './headShader'

/**
 * Lattice style helper: renders the deformed head from four sides into small
 * textures that the particle lattice samples:
 *   R = z of the surface, A = x of the surface (both in cube space)
 *   G = luminance (lighting + painted features), B = mask (1 where the head is)
 */

const headVertex = /* glsl */ `
${HEAD_UNIFORMS_GLSL}
${HEAD_DEFORM_GLSL}
${HEAD_MORPH_GLSL}
varying vec3 vNormal;
varying vec3 vPos;
varying vec3 vLocal;
varying float vHair;
void main() {
  vec3 q, l, nw;
  float hair;
  ${HEAD_MORPH_INPUT_GLSL}
  deformHead(transformed, objectNormal, q, l, nw, hair);
  vPos = q;
  vLocal = l;
  vNormal = nw;
  vHair = hair;
  gl_Position = projectionMatrix * viewMatrix * vec4(q, 1.0);
}
`

const headFragment = /* glsl */ `
${HEAD_UNIFORMS_GLSL}
${HEAD_PAINT_GLSL}
varying float vFeature;
varying vec3 vNormal;
varying vec3 vPos;
varying vec3 vLocal;
varying float vHair;
void main() {
  if (headCoverage(vLocal) < 0.5) discard;
  float cav, maskv;
  float lum = paintLum(vLocal, normalize(vNormal), vPos, vHair, vFeature, cav, maskv);
  float depth = vPos.z - 0.2 * cav;
  gl_FragColor = vec4(depth, lum * maskv, maskv, vPos.x);
}
`

interface View {
  target: THREE.WebGLRenderTarget
  camera: THREE.OrthographicCamera
}

export class FacePass {
  /** cameras at +z, -z, +x, -x respectively */
  readonly views: { front: View; back: View; right: View; left: View }

  private scene = new THREE.Scene()
  private material: THREE.ShaderMaterial
  private head: THREE.Mesh | null = null
  private tmpColor = new THREE.Color()

  constructor(uniforms: HeadUniforms, size = 256) {
    const makeTarget = () =>
      new THREE.WebGLRenderTarget(size, size, {
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: true,
        stencilBuffer: false,
      })
    const makeCamera = (x: number, z: number) => {
      const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 6)
      cam.position.set(x, 0, z)
      cam.lookAt(0, 0, 0)
      cam.updateMatrixWorld()
      return cam
    }
    this.material = new THREE.ShaderMaterial({ vertexShader: headVertex, fragmentShader: headFragment, uniforms, side: THREE.FrontSide })
    this.views = {
      front: { target: makeTarget(), camera: makeCamera(0, 3) },
      back: { target: makeTarget(), camera: makeCamera(0, -3) },
      right: { target: makeTarget(), camera: makeCamera(3, 0) },
      left: { target: makeTarget(), camera: makeCamera(-3, 0) },
    }
  }

  setGeometry(geometry: THREE.BufferGeometry, influences?: number[]) {
    if (this.head) this.scene.remove(this.head)
    const head = new THREE.Mesh(geometry, this.material)
    if (influences) head.morphTargetInfluences = influences
    head.frustumCulled = false
    this.head = head
    this.scene.add(head)
  }

  setFraming(extent: number, centerY: number) {
    for (const { camera } of Object.values(this.views)) {
      camera.left = camera.bottom = -extent
      camera.right = camera.top = extent
      camera.position.y = centerY
      camera.lookAt(0, centerY, 0)
      camera.updateProjectionMatrix()
      camera.updateMatrixWorld()
    }
  }

  /**
   * Renders the head textures. The layered portrait needs front and back depth (`includeBack`);
   * debug views can request all four cameras with `full`.
   */
  render(renderer: THREE.WebGLRenderer, full = true, includeBack = false) {
    if (!this.head) return
    const prevTarget = renderer.getRenderTarget()
    const prevColor = renderer.getClearColor(this.tmpColor)
    const prevAlpha = renderer.getClearAlpha()
    renderer.setClearColor(0x000000, 0)
    const views = full ? Object.values(this.views) : includeBack ? [this.views.front, this.views.back] : [this.views.front]
    for (const view of views) {
      renderer.setRenderTarget(view.target)
      renderer.clear(true, true, false)
      renderer.render(this.scene, view.camera)
    }
    renderer.setRenderTarget(prevTarget)
    renderer.setClearColor(prevColor, prevAlpha)
  }

  dispose() {
    for (const view of Object.values(this.views)) view.target.dispose()
    this.material.dispose()
  }
}
