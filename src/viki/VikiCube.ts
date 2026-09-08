import * as THREE from 'three'
import type { HeadConfig } from './config'
import type { HeadUniforms } from './headShader'
import { VikiInterior } from './VikiInterior'

const vertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const fragment = /* glsl */ `
uniform sampler2D uFace;
uniform vec3 uShadow, uSilver, uHighlight;
uniform float uFormation, uGain, uField, uDiffusion;
varying vec2 vUv;
void main() {
  // Transmission preserves the perspective of the interior, including its surface-bound tiles.
  vec2 uv = vUv;
  float spread = 0.0003 + uDiffusion * 0.0015;
  vec4 face = texture2D(uFace, uv);
  float light = face.g * 0.6;
  light += (texture2D(uFace, uv + vec2(spread, 0)).g + texture2D(uFace, uv - vec2(spread, 0)).g) * 0.2;
  float faceLight = pow(max(light, 0.0), 1.12) * uFormation;
  // Keep the sockets dark: moving data there stays much weaker than on the lit face.
  float field = uField * (face.r * mix(1.0, 0.12, face.b * uFormation) + 0.002);
  float boundary = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
  float edge = smoothstep(0.0, 0.024, boundary);

  // Silvery green-gray phosphor on a nearly black optical substrate.
  vec3 tint = mix(uSilver, uHighlight, smoothstep(0.25, 0.75, faceLight) * 0.65);
  // Face brightness is independent of the surrounding matrix (Background tiles).
  vec3 color = (tint * faceLight * 1.65 * uGain + uSilver * field) * edge;
  // Lift the space around the portrait without filling its dark eye sockets.
  color += uShadow * (0.004 + 0.018 * (1.0 - face.b * uFormation) + field * 0.08) * edge;
  gl_FragColor = vec4(color, 1.0);
}
`

/** Six optical windows onto the same animated 3D scene, mirrored on alternating sides. */
export class VikiCube {
  readonly group = new THREE.Group()
  private geometry = new THREE.PlaneGeometry(2, 2)
  private materials: THREE.ShaderMaterial[] = []
  private interior: VikiInterior
  private views: { panel: THREE.Mesh; camera: THREE.PerspectiveCamera; target: THREE.WebGLRenderTarget; mirror: boolean }[] = []
  private eye = new THREE.Vector3()
  private clearColor = new THREE.Color()

  constructor(head: HeadUniforms) {
    this.interior = new VikiInterior(head)
    const faces = [
      { name: 'front', position: [0, 0, 1], rotation: [0, 0, 0], mirror: 0 },
      { name: 'right', position: [1, 0, 0], rotation: [0, Math.PI / 2, 0], mirror: 1 },
      { name: 'back', position: [0, 0, -1], rotation: [0, Math.PI, 0], mirror: 0 },
      { name: 'left', position: [-1, 0, 0], rotation: [0, -Math.PI / 2, 0], mirror: 1 },
      { name: 'top', position: [0, 1, 0], rotation: [-Math.PI / 2, 0, 0], mirror: 0 },
      { name: 'bottom', position: [0, -1, 0], rotation: [Math.PI / 2, 0, 0], mirror: 1 },
    ]
    for (const faceSide of faces) {
      const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter })
      const material = new THREE.ShaderMaterial({
        vertexShader: vertex, fragmentShader: fragment,
        uniforms: {
          uFace: { value: target.texture }, uFormation: { value: 0 },
          uShadow: { value: new THREE.Color() }, uSilver: { value: new THREE.Color() }, uHighlight: { value: new THREE.Color() },
          uGain: { value: 1.4 }, uField: { value: 0.7 }, uDiffusion: { value: 0.45 },
        },
        // Each window captures its own interior; far windows cannot leak through it.
        side: THREE.FrontSide, depthWrite: true,
      })
      const panel = new THREE.Mesh(this.geometry, material)
      panel.name = `VIKI-${faceSide.name}`
      panel.position.fromArray(faceSide.position)
      panel.rotation.set(faceSide.rotation[0], faceSide.rotation[1], faceSide.rotation[2])
      panel.frustumCulled = false
      this.materials.push(material)
      this.views.push({ panel, camera: new THREE.PerspectiveCamera(), target, mirror: Boolean(faceSide.mirror) })
      this.group.add(panel)
    }
    this.group.visible = false
  }

  applyConfig(cfg: HeadConfig) {
    this.interior.applyConfig(cfg)
    this.group.scale.set(1, 1, cfg.cubeDepth)
    for (const material of this.materials) {
      const u = material.uniforms
      u.uShadow.value.set(cfg.colorA)
      u.uSilver.value.set(cfg.colorB)
      u.uHighlight.value.set(cfg.colorC)
      u.uGain.value = cfg.gain
      u.uField.value = cfg.cage
      u.uDiffusion.value = cfg.diffusion
    }
  }

  update(time: number, formation: number) {
    this.interior.update(time)
    for (const material of this.materials) {
      material.uniforms.uFormation.value = formation
    }
  }

  setGeometry(geometry: THREE.BufferGeometry, influences: number[]) { this.interior.setGeometry(geometry, influences) }

  /** Off-axis frusta make the pane a window: foreground, face and rear cells have different parallax. */
  capture(renderer: THREE.WebGLRenderer, camera: THREE.Camera) {
    if (!this.group.visible) return
    this.group.updateWorldMatrix(true, true)
    camera.updateWorldMatrix(true, false)
    const previousTarget = renderer.getRenderTarget()
    renderer.getClearColor(this.clearColor)
    const previousAlpha = renderer.getClearAlpha()
    const size = Math.min(640, Math.max(320, Math.round(renderer.domElement.height * 0.8)))
    try {
      renderer.setClearColor(0x000000, 0)
      for (const view of this.views) {
        camera.getWorldPosition(this.eye)
        view.panel.worldToLocal(this.eye)
        // At most three windows face the viewer; skip every hidden side's extra render.
        if (this.eye.z <= 0.01) continue
        // Approximate refraction into the optical volume. This moderates grazing views
        // while retaining depth-dependent perspective (no camera-facing portrait).
        const ior = 1.45
        this.eye.z = Math.sqrt(ior * ior * this.eye.z * this.eye.z + (ior * ior - 1) * (this.eye.x * this.eye.x + this.eye.y * this.eye.y))
        if (view.target.width !== size) view.target.setSize(size, size)
        const near = 0.05, ratio = near / this.eye.z
        view.camera.position.copy(this.eye)
        view.camera.projectionMatrix.makePerspective(
          (-1 - this.eye.x) * ratio, (1 - this.eye.x) * ratio,
          (1 - this.eye.y) * ratio, (-1 - this.eye.y) * ratio, near, this.eye.z + 5,
        )
        view.camera.projectionMatrixInverse.copy(view.camera.projectionMatrix).invert()
        this.interior.setMirror(view.mirror)
        renderer.setRenderTarget(view.target)
        if (!renderer.autoClear) renderer.clear()
        renderer.render(this.interior.scene, view.camera)
      }
    } finally {
      renderer.setRenderTarget(previousTarget)
      renderer.setClearColor(this.clearColor, previousAlpha)
    }
  }

  dispose() {
    for (const material of this.materials) material.dispose()
    for (const view of this.views) view.target.dispose()
    this.interior.dispose()
    this.geometry.dispose()
  }
}
