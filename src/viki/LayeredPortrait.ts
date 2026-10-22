import * as THREE from 'three'
import type { HeadConfig } from './config'
import type { HeadUniforms } from './headShader'
import { TILE_TARGET_GLSL } from './tileTarget'

/**
 * Live depth maps drive thin stepped tiles, including the eyelids. The head is
 * always assembled, with no floor of loose tiles around it.
 */
export class LayeredPortrait {
  readonly group = new THREE.Group()
  private geometry = new THREE.InstancedBufferGeometry()
  private material: THREE.ShaderMaterial
  private resolution = 0
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
        uExtent: { value: 1 }, uCenterY: { value: 0 }, uMinY: { value: -0.11 },
        uHeadOffset: head.uHeadOffset, uHeadScale: head.uHeadScale,
        uHighlight: { value: new THREE.Color('#ffffff') },
        uKeyDirection: head.uKeyDirection,
      },
      vertexShader: /* glsl */ `
        ${TILE_TARGET_GLSL}
        attribute vec2 aCell;
        attribute float aBack;
        varying float vValid, vLight, vShade, vSeed, vCap;
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
          float r2 = hash(aCell.yx + 4.7 + aBack);
          float r3 = hash(aCell + 11.3 + aBack);
          // Exact target tracking keeps the eyelids and the turning head crisp.
          vec3 center = tile.head;
          mat3 turn = rotateTile(tile.free*sin(uTime*0.22+r2), tile.free*r3);
          vec3 p = center + turn * (position * vec3(uCell*uFill, uCell*uFill, uCell*0.32));
          float zFront = floor(face.r/uStep)*uStep;
          vec4 neighbor = texture2D(uFront, uv + vec2(uCell / (2.0 * uExtent), 0.0));
          vec4 above = texture2D(uFront, uv + vec2(0.0, uCell / (2.0 * uExtent)));
          // Unpremultiply against the head mask: rim texels otherwise render as dark chains.
          vLight = aBack > 0.5 ? rear.g / max(rear.b, 0.05) : face.g / max(face.b, 0.05);
          float raised = max(neighbor.b > 0.35 ? neighbor.r : zFront, above.b > 0.35 ? above.r : zFront);
          vShade = 1.0 - 0.48 * smoothstep(uStep * 0.3, uStep * 1.4, raised - zFront);
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
        varying float vValid, vLight, vShade, vSeed, vCap;
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
  }

  applyConfig(config: HeadConfig) {
    const s = config.headScale / 0.29
    if (config.neck) {
      // From just above the crown to just below the frame: the neck runs out of the picture.
      const top = config.headY + 1.2 * s, bottom = config.headY - 0.6 * s
      this.extent = (top - bottom) / 2
      this.centerY = (top + bottom) / 2
    } else {
      this.extent = s * (0.8 + config.hair * 0.12)
      this.centerY = config.headY + s * 0.47
    }
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
      this.geometry.dispose() // Release the previous instance buffer when density changes.
      this.geometry.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 2))
      this.geometry.setAttribute('aBack', new THREE.InstancedBufferAttribute(backs, 1))
      this.geometry.instanceCount = count * count * 2
    }
    const u = this.material.uniforms
    u.uCell.value = 2 * this.extent / count
    u.uExtent.value = this.extent
    u.uCenterY.value = this.centerY
    // Tiles stop under the chin unless the neck is shown.
    u.uMinY.value = config.neck ? -10 : -0.11
    u.uFill.value = THREE.MathUtils.clamp(0.84 * config.cellSize, 0.65, 0.98)
    u.uStep.value = 0.026 + config.cubeDepth * 0.025
    u.uColor.value.set(config.colorB)
    u.uSide.value.set(config.colorA)
    u.uHighlight.value.set(config.colorC)
    u.uGain.value = config.gain
    u.uVariation.value = config.flicker
  }

  update(time: number) {
    this.material.uniforms.uTime.value = time
  }

  dispose() {
    this.geometry.dispose()
    this.material.dispose()
  }
}
