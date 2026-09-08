import * as THREE from 'three'
import { VIKI_TILES_GLSL } from './VikiTiles'

/** Transparent slices occupy real depths; a single instanced draw renders the whole matrix. */
export class VikiMatrix extends THREE.InstancedMesh<THREE.PlaneGeometry, THREE.ShaderMaterial> {
  constructor(uniforms: Record<string, THREE.IUniform>) {
    const geometry = new THREE.PlaneGeometry(2, 2)
    geometry.setAttribute('aOpacity', new THREE.InstancedBufferAttribute(new Float32Array([0.5, 0.45, 0.35, 0.32]), 1))
    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: /* glsl */ `
        attribute float aOpacity;
        varying vec3 vPosition;
        varying float vOpacity;
        void main() {
          vec4 p = instanceMatrix * vec4(position, 1.0);
          vPosition = p.xyz;
          vOpacity = aOpacity;
          gl_Position = projectionMatrix * modelViewMatrix * p;
        }`,
      fragmentShader: /* glsl */ `
        ${VIKI_TILES_GLSL}
        varying vec3 vPosition;
        varying float vOpacity;
        void main() {
          // Invert the head's placement, keeping the matrix on the same tile spacing.
          vec2 point = (vPosition.xy + vec2(0.0, 0.06)) / 1.08;
          float boundary = 1.0 - max(abs(vPosition.x), abs(vPosition.y));
          float edge = smoothstep(0.0, 0.12, boundary);
          float variation = 0.5 + 0.5 * sin(vPosition.x * 3.8 + vPosition.z * 2.0)
            * cos(vPosition.y * 4.6 - vPosition.z);
          float fade = mix(0.22, 1.0, smoothstep(0.1, 0.9, variation));
          // R alone carries the enclosure: never overwrite head light or its coverage.
          gl_FragColor = vec4(tileLight(point) * 0.18, 0.0, 0.0, vOpacity * edge * fade);
        }`,
      transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
    })
    super(geometry, material, 4)
    const transform = new THREE.Matrix4()
    ;[-0.06, -0.52, -1.0, -1.55].forEach((z, i) => this.setMatrixAt(i, transform.makeTranslation(0, 0, z)))
    this.instanceMatrix.needsUpdate = true
    this.frustumCulled = false
    this.name = 'VIKI-translucent-matrix'
  }

  override dispose() {
    super.dispose()
    this.geometry.dispose()
    this.material.dispose()
    return this
  }
}
