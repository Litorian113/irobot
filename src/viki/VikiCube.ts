import * as THREE from 'three'
import type { HeadConfig } from './config'
import type { HeadUniforms } from './headShader'
import { VikiInterior } from './VikiInterior'
import { VikiRain } from './VikiRain'
import { VIKI_ASSEMBLY_GLSL } from './VikiAssembly'

const vertex = /* glsl */ `
varying vec2 vUv;
varying vec3 vCubePosition;
uniform mat4 uPanelMatrix;
void main() {
  vUv = uv;
  vCubePosition = (uPanelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const fragment = /* glsl */ `
uniform sampler2D uFace;
uniform vec3 uShadow, uSilver, uHighlight;
uniform float uFormation, uGain, uField, uDiffusion, uBloom;
varying vec2 vUv;
varying vec3 vCubePosition;
${VIKI_ASSEMBLY_GLSL}
void main() {
  float reveal = assemblyMask(vCubePosition);
  if (reveal < 0.001) discard;
  // Transmission preserves the perspective of the interior, including its surface-bound tiles.
  vec2 uv = vUv;
  float unevenGlass = 0.9 + 0.1 * sin(uv.x * 23.0) * cos(uv.y * 17.0);
  float spread = (0.0012 + uDiffusion * 0.0038) * unevenGlass;
  vec4 face = texture2D(uFace, uv);
  // Normalized 3x3 Gaussian kernel over the projected front layer AND its interior matrix.
  vec4 soft = face * 0.25;
  soft += (texture2D(uFace, uv + vec2(spread, 0)) + texture2D(uFace, uv - vec2(spread, 0))
    + texture2D(uFace, uv + vec2(0, spread)) + texture2D(uFace, uv - vec2(0, spread))) * 0.125;
  soft += (texture2D(uFace, uv + vec2(spread)) + texture2D(uFace, uv - vec2(spread))
    + texture2D(uFace, uv + vec2(spread, -spread)) + texture2D(uFace, uv + vec2(-spread, spread))) * 0.0625;
  vec2 haloStep = vec2(spread * 2.4);
  vec4 halo = (texture2D(uFace, uv + haloStep) + texture2D(uFace, uv - haloStep)
    + texture2D(uFace, uv + vec2(haloStep.x, -haloStep.y)) + texture2D(uFace, uv + vec2(-haloStep.x, haloStep.y))) * 0.25;
  float light = mix(face.g, soft.g, min(0.82, 0.4 + uDiffusion * 0.4));
  float faceLight = pow(max(light, 0.0), 1.02) * uFormation;
  // Keep the sockets dark: moving data there stays much weaker than on the lit face.
  float field = uField * (mix(face.r, soft.r, 0.68) * mix(1.0, 0.26, face.b * uFormation) * 1.45 + 0.006);

  // Silvery green-gray phosphor on a nearly black optical substrate.
  vec3 tint = mix(uSilver, uHighlight, smoothstep(0.25, 0.75, faceLight) * 0.65);
  // Face brightness is independent of the surrounding matrix (Background tiles).
  vec3 color = tint * faceLight * 1.65 * uGain + uSilver * field;
  // Diffusion and halation belong to this optical volume, not the hall or UI.
  vec3 glow = uSilver * (halo.g * uFormation * uGain * 0.6 + halo.r * uField * 0.65) * uBloom;
  color += glow * (1.0 - clamp(color, 0.0, 1.0) * 0.35);
  // Lift the space around the portrait without filling its dark eye sockets.
  color += uShadow * (0.028 + 0.024 * (1.0 - face.b * uFormation) + field * 0.12);
  // Adjacent panes meet without an alpha gutter exposing a bright line of the hall.
  gl_FragColor = vec4(color, reveal * 0.94);
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
  private rain = new VikiRain()
  private build = 0

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
          uBuild: { value: 0 }, uPanelMatrix: { value: new THREE.Matrix4() }, uBloom: { value: 0.65 },
          uShadow: { value: new THREE.Color() }, uSilver: { value: new THREE.Color() }, uHighlight: { value: new THREE.Color() },
          uGain: { value: 1.4 }, uField: { value: 0.7 }, uDiffusion: { value: 0.45 },
        },
        // Each window captures its own interior; far windows cannot leak through it.
        side: THREE.FrontSide, depthWrite: true, transparent: true,
      })
      const panel = new THREE.Mesh(this.geometry, material)
      panel.name = `VIKI-${faceSide.name}`
      panel.position.fromArray(faceSide.position)
      panel.rotation.set(faceSide.rotation[0], faceSide.rotation[1], faceSide.rotation[2])
      panel.updateMatrix()
      material.uniforms.uPanelMatrix.value = panel.matrix
      panel.frustumCulled = false
      this.materials.push(material)
      this.views.push({ panel, camera: new THREE.PerspectiveCamera(), target, mirror: Boolean(faceSide.mirror) })
      this.group.add(panel)
    }
    this.group.add(this.rain)
    this.group.visible = false
  }

  applyConfig(cfg: HeadConfig) {
    this.interior.applyConfig(cfg)
    this.group.scale.set(1, 1, cfg.cubeDepth)
    this.rain.material.uniforms.uColor.value.set(cfg.colorB)
    for (const material of this.materials) {
      const u = material.uniforms
      u.uShadow.value.set(cfg.colorA)
      u.uSilver.value.set(cfg.colorB)
      u.uHighlight.value.set(cfg.colorC)
      u.uGain.value = cfg.gain
      u.uField.value = cfg.cage
      u.uDiffusion.value = cfg.diffusion
      u.uBloom.value = cfg.bloom
    }
  }

  update(time: number, formation: number, build = 1, direction = 1) {
    this.build = build
    this.interior.update(time)
    this.rain.visible = build > 0.001 && build < 0.999
    const rain = this.rain.material.uniforms
    rain.uTime.value = time
    rain.uBuild.value = build
    rain.uDirection.value = direction
    for (const view of this.views) view.panel.visible = build > 0.001
    for (const material of this.materials) {
      material.uniforms.uFormation.value = formation
      material.uniforms.uBuild.value = build
    }
  }

  setGeometry(geometry: THREE.BufferGeometry, influences: number[]) { this.interior.setGeometry(geometry, influences) }

  /** Off-axis frusta make the pane a window: foreground, face and rear cells have different parallax. */
  capture(renderer: THREE.WebGLRenderer, camera: THREE.Camera) {
    if (!this.group.visible || this.build < 0.001) return
    this.rain.material.uniforms.uPixelScale.value = renderer.domElement.height
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
    this.rain.dispose()
    this.geometry.dispose()
  }
}
