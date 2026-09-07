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

  constructor(uniforms: HeadUniforms, geometry: THREE.BufferGeometry, influences: number[]) {
    this.uniforms = uniforms
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

  render(renderer: THREE.WebGLRenderer) {
    const u = this.uniforms
    if (u.uLighting.value < 0.5 || u.uFormation.value < 0.001) { u.uShadowReady.value = 0; return }
    this.camera.position.copy(u.uKeyDirection.value).multiplyScalar(4)
    this.camera.lookAt(0, 0, 0)
    this.camera.updateMatrixWorld()
    u.uKeyMatrix.value.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse)
    const target = renderer.getRenderTarget(), alpha = renderer.getClearAlpha()
    renderer.getClearColor(this.color)
    renderer.setRenderTarget(this.target)
    renderer.setClearColor(0xffffff, 1)
    renderer.clear()
    renderer.render(this.scene, this.camera)
    renderer.setRenderTarget(target)
    renderer.setClearColor(this.color, alpha)
    u.uShadowReady.value = 1
  }

  dispose() { this.target.dispose(); this.material.dispose() }
}
