import * as THREE from 'three'
import type { HeadConfig } from './config'
import type { HeadUniforms } from './headShader'
import { TILE_TARGET_GLSL } from './tileTarget'
import { TileDynamics } from './TileDynamics'

/** Live depth maps drive thin stepped tiles, including the speaking mouth and eyelids. */
export class LayeredPortrait {
  readonly group = new THREE.Group()
  private geometry = new THREE.InstancedBufferGeometry()
  private material: THREE.ShaderMaterial
  private shadow: THREE.Mesh
  private resolution = 0
  private assembly = 0
  private dynamics: TileDynamics | null = null
  private awake = false
  private frozen = false
  private elapsed = 0
  private release = false
  private clearColor = new THREE.Color()
  extent = 1
  centerY = 0

  constructor(head: HeadUniforms, front: THREE.Texture, back: THREE.Texture) {
    const box = new THREE.BoxGeometry(1, 1, 1)
    this.geometry.setIndex(box.index)
    for (const [name, attribute] of Object.entries(box.attributes)) this.geometry.setAttribute(name, attribute)
    box.dispose()
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uFront: { value: front }, uBack: { value: back },
        uCell: { value: 0.02 }, uFill: { value: 0.92 }, uStep: { value: 0.045 },
        uColor: { value: new THREE.Color('#eeeeee') }, uSide: { value: new THREE.Color('#888888') },
        uGain: { value: 1 }, uTime: { value: 0 }, uVariation: { value: 0.2 },
        uMotionPosition: { value: null }, uMotionVelocity: { value: null },
        uSimulated: { value: false }, uAwake: { value: 0 }, uFloor: { value: -0.8 },
        uExtent: { value: 1 }, uCenterY: { value: 0 },
        uHeadOffset: head.uHeadOffset, uHeadScale: head.uHeadScale,
        uHighlight: { value: new THREE.Color('#ffffff') },
        uKeyDirection: head.uKeyDirection,
      },
      vertexShader: /* glsl */ `
        ${TILE_TARGET_GLSL}
        uniform sampler2D uMotionPosition, uMotionVelocity;
        uniform bool uSimulated;
        uniform float uAwake;
        attribute vec2 aCell;
        attribute float aBack;
        varying float vValid, vLight, vShade, vSeed, vCap, vLift;
        varying vec3 vNormal, vPosition;
        mat3 rotateTile(float a, float b) {
          float c=cos(a), s=sin(a), d=cos(b), t=sin(b);
          return mat3(d,0.0,-t, 0.0,1.0,0.0, t,0.0,d) * mat3(1.0,0.0,0.0, 0.0,c,s, 0.0,-s,c);
        }
        void main() {
          vec2 uv = aCell * 0.5 + 0.5;
          vec4 face = texture2D(uFront, uv);
          vec4 rear = texture2D(uBack, vec2(1.0-uv.x,uv.y));
          TileTarget tile = tileTarget(aCell, aBack);
          vValid = tile.valid;
          vSeed = tile.seed;
          vec2 motionUv = vec2(uv.x, (uv.y + aBack) * 0.5);
          vec4 state = uSimulated ? texture2D(uMotionPosition, motionUv) : vec4(mix(tile.rest,tile.head,uAwake),uAwake);
          vec4 velocity = uSimulated ? texture2D(uMotionVelocity, motionUv) : vec4(0.0);
          float r2 = hash(aCell.yx + 4.7 + aBack);
          float r3 = hash(aCell + 11.3 + aBack);
          // Exact target tracking once assembled preserves crisp mouth/eyelid motion.
          vec3 center = mix(state.xyz, tile.head, smoothstep(0.97,1.0,state.w));
          float lift = state.w;
          float floorPiece = step(length(tile.head-tile.rest),0.001);
          float orientationLift = lift * (1.0-floorPiece);
          mat3 turn = rotateTile((1.0-orientationLift)*(1.45+r3*0.25+velocity.w) + tile.free*lift*sin(uTime*0.22+r2),
            (1.0-orientationLift)*(r2*6.283185+velocity.w*(r3-0.5)) + tile.free*lift*r3);
          vec3 p = center + turn * (position * vec3(uCell*uFill, uCell*uFill, uCell*0.32));
          float zFront = floor(face.r/uStep)*uStep;
          vec4 neighbor = texture2D(uFront, uv + vec2(uCell / (2.0 * uExtent), 0.0));
          vec4 above = texture2D(uFront, uv + vec2(0.0, uCell / (2.0 * uExtent)));
          vLift = orientationLift;
          vLight = aBack > 0.5 ? rear.g : face.g;
          float raised = max(neighbor.b > 0.08 ? neighbor.r : zFront, above.b > 0.08 ? above.r : zFront);
          vShade = 1.0 - 0.48 * vLift * smoothstep(uStep * 0.3, uStep * 1.4, raised - zFront);
          vPosition = p;
          vCap = abs(normal.z);
          vNormal = normalize(mat3(modelMatrix) * turn * normal);
          if (vValid < 0.5) p = vec3(0.0);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor, uSide, uKeyDirection, uHighlight;
        uniform float uGain, uStep;
        varying float vValid, vLight, vShade, vSeed, vCap, vLift;
        varying vec3 vNormal, vPosition;
        void main() {
          if (vValid < 0.5) discard;
          vec3 n = normalize(vNormal);
          float light = 0.23 + 0.77 * max(0.0, dot(n, normalize(uKeyDirection + vec3(-0.4, 0.1, 0.0))));
          // Dark, narrow joints across column walls make each depth stratum readable.
          float layer = fract(vPosition.z / uStep + 0.001);
          float seam = smoothstep(0.025, 0.13, min(layer, 1.0 - layer));
          float front = vCap;
          float faceLight = 0.05 + 0.95 * pow(clamp(vLight, 0.0, 1.0), 0.85);
          faceLight = mix(light, faceLight, vLift);
          vec3 color = mix(uSide, uColor, front * 0.8 + 0.2);
          color = mix(color, uHighlight, max(0.0, faceLight - 0.6) * 0.25);
          color *= mix(light * (0.50 + 0.50 * seam), faceLight, pow(front, 6.0));
          color *= vShade * (0.94 + 0.06 * vSeed) * uGain;
          gl_FragColor = vec4(color, 1.0);
        }
      `,
    })
    const tiles = new THREE.Mesh(this.geometry, this.material)
    tiles.frustumCulled = false
    this.group.add(tiles)
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.22), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uOpacity: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: 'uniform float uOpacity; varying vec2 vUv; void main(){vec2 p=(vUv-.5)*2.0;gl_FragColor=vec4(vec3(0.0),exp(-dot(p,p)*5.0)*uOpacity);}',
    }))
    this.shadow.position.set(0, -0.88, 0.0)
    this.group.add(this.shadow)
  }

  applyConfig(config: HeadConfig) {
    this.extent = config.headScale / 0.29 * (0.8 + config.hair * 0.12)
    this.centerY = config.headY + config.headScale / 0.29 * 0.47
    const count = Math.round(72 + config.density * 80)
    if (count !== this.resolution) {
      this.resolution = count
      const cells = new Float32Array(count * count * 4)
      const backs = new Float32Array(count * count * 2)
      for (let b = 0; b < 2; b++) for (let y = 0; y < count; y++) for (let x = 0; x < count; x++) {
        const index = b * count * count + y * count + x
        const i = index * 2
        backs[index] = b
        cells[i] = (x + 0.5) * 2 / count - 1
        cells[i + 1] = (y + 0.5) * 2 / count - 1
      }
      this.dynamics?.dispose()
      this.dynamics = null
      this.material.uniforms.uSimulated.value = false
      this.geometry.dispose() // Release the previous instance buffer when density changes.
      this.geometry.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 2))
      this.geometry.setAttribute('aBack', new THREE.InstancedBufferAttribute(backs, 1))
      this.geometry.instanceCount = count * count * 2
    }
    const u = this.material.uniforms
    u.uCell.value = 2 * this.extent / count
    u.uExtent.value = this.extent
    u.uCenterY.value = this.centerY
    u.uFill.value = THREE.MathUtils.clamp(0.84 * config.cellSize, 0.65, 0.98)
    u.uStep.value = 0.026 + config.cubeDepth * 0.025
    u.uColor.value.set(config.colorB)
    u.uSide.value.set(config.colorA)
    u.uHighlight.value.set(config.colorC)
    u.uGain.value = config.gain
    u.uVariation.value = config.flicker
    u.uFloor.value = config.headY - config.headScale / 0.29 * 0.11 - 0.30
    this.shadow.position.y = u.uFloor.value
    this.shadow.scale.x = 1.8
  }

  update(time: number, awake: boolean, dt: number, frozen = false) {
    if (awake !== this.awake) {
      this.release = !awake
      this.elapsed = 0
      this.awake = awake
    }
    this.elapsed += dt
    this.frozen = frozen
    this.assembly = frozen ? (awake ? 1 : 0) : THREE.MathUtils.clamp(
      this.assembly + (awake ? dt / 3.2 : -dt / 0.65), 0, 1)
    this.material.uniforms.uTime.value = time
    this.material.uniforms.uAwake.value = awake ? 1 : 0
    ;(this.shadow.material as THREE.ShaderMaterial).uniforms.uOpacity.value = 0.30 + this.assembly * 0.05
  }

  /** Called after depth capture so the simulation sees the current animated face. */
  simulate(renderer: THREE.WebGLRenderer, dt: number) {
    const u = this.material.uniforms
    if (this.frozen) { u.uSimulated.value = false; return }
    renderer.getClearColor(this.clearColor)
    const alpha = renderer.getClearAlpha()
    try {
      this.dynamics ??= new TileDynamics(renderer, this.resolution, u)
      this.dynamics.step(dt, this.awake, this.elapsed, this.release)
    } finally {
      // Compute passes leave a linear clear color in GL; restore it for the scene.
      renderer.setClearColor(this.clearColor, alpha)
    }
    this.release = false
    u.uMotionPosition.value = this.dynamics.position
    u.uMotionVelocity.value = this.dynamics.velocity
    u.uSimulated.value = true
  }

  dispose() {
    this.dynamics?.dispose()
    this.geometry.dispose()
    this.material.dispose()
    this.shadow.geometry.dispose()
    ;(this.shadow.material as THREE.Material).dispose()
  }
}
