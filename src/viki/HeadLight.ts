import * as THREE from 'three'
import { HEAD_DEFORM_GLSL, HEAD_MORPH_GLSL, HEAD_MORPH_INPUT_GLSL, HEAD_UNIFORMS_GLSL, type HeadUniforms } from './headShader'

/** A light-space depth pass of the same animated head, for nose/lid/lip cast shadows. */
export class HeadLight {
  private scene = new THREE.Scene()
  private camera = new THREE.OrthographicCamera(-1.5, 1.5, 1.5, -1.5, 0.1, 8)
  private target = new THREE.WebGLRenderTarget(1024, 1024, { type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter })
  private material: THREE.ShaderMaterial
  private color = new THREE.Color()
  private uniforms: HeadUniforms
  private influences: number[]
  private previous = new Float64Array(96)
  private snapshot = new Float64Array(96)
  private cached = false
  private renders = 0
  private reuses = 0

  constructor(uniforms: HeadUniforms, geometry: THREE.BufferGeometry, influences: number[]) {
    this.uniforms = uniforms
    this.influences = influences
    this.material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: `${HEAD_UNIFORMS_GLSL}\n${HEAD_DEFORM_GLSL}\n${HEAD_MORPH_GLSL}
        void main() {
          vec3 q, l, n; float hair;
          ${HEAD_MORPH_INPUT_GLSL}
          deformHead(transformed, objectNormal, q, l, n, hair);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(q, 1.0);
        }`,
      fragmentShader: 'void main() { gl_FragColor = vec4(vec3(gl_FragCoord.z), 1.0); }',
    })
    const mesh = new THREE.Mesh(geometry, this.material)
    mesh.morphTargetInfluences = influences
    mesh.frustumCulled = false
    this.scene.add(mesh)
    uniforms.uKeyShadow.value = this.target.texture
  }

  /** Exact inputs to the depth vertex shader; color, pixel animation and camera rotation do not affect it. */
  private unchanged() {
    const u = this.uniforms, values = this.snapshot
    let i = 0
    for (const n of u.uHeadMatrix.value.elements) values[i++] = n
    for (const v of [u.uHeadOffset.value, u.uHeadScale.value, u.uKeyDirection.value]) {
      values[i++] = v.x; values[i++] = v.y; values[i++] = v.z
    }
    for (const key of ['uRigged', 'uMouthY', 'uBrowY', 'uJawWidth', 'uChin', 'uCheek', 'uBrowRidge', 'uNoseSize', 'uHair', 'uHairline', 'uMouthWidth', 'uLipFull'] as const) values[i++] = u[key].value
    // The rigged mesh gets expressions from morph targets; procedural expressions only deform the legacy scan.
    for (const key of ['uMouthOpen', 'uMouthWide', 'uSmile', 'uBrow', 'uEyeOpen', 'uEyeX', 'uEyeY', 'uEyeSize'] as const) values[i++] = u.uRigged.value < 0.5 ? u[key].value : 0
    for (const n of this.influences) values[i++] = n
    for (let j = 0; j < i; j++) if (values[j] !== this.previous[j]) return false
    return this.cached
  }

  render(renderer: THREE.WebGLRenderer, reuseUnchanged = false) {
    const u = this.uniforms
    if (u.uLighting.value < 0.5 || u.uFormation.value < 0.001) { u.uShadowReady.value = 0; return }
    if (reuseUnchanged && this.unchanged()) { u.uShadowReady.value = 1; this.reuses++; return }
    this.camera.position.copy(u.uKeyDirection.value).multiplyScalar(4)
    this.camera.lookAt(0, 0, 0)
    this.camera.updateMatrixWorld()
    u.uKeyMatrix.value.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse)
    const target = renderer.getRenderTarget(), alpha = renderer.getClearAlpha()
    renderer.getClearColor(this.color)
    renderer.setRenderTarget(this.target)
    renderer.setClearColor(0xffffff, 1)
    // renderer.render already clears by default. Preserve the other styles' existing path.
    if (!reuseUnchanged || !renderer.autoClear) renderer.clear()
    renderer.render(this.scene, this.camera)
    renderer.setRenderTarget(target)
    renderer.setClearColor(this.color, alpha)
    u.uShadowReady.value = 1
    this.renders++
    this.cached = reuseUnchanged
    if (reuseUnchanged) this.previous.set(this.snapshot)
  }

  debug() { return { renders: this.renders, reuses: this.reuses } }

  dispose() { this.target.dispose(); this.material.dispose() }
}
