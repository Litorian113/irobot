import * as THREE from 'three'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { REF_SCALE } from './config'

/** A lens-like zoom smear around Dust's silhouette, after bloom and before tone mapping. */
export class DustRadialBlur extends ShaderPass {
  private headToView = new THREE.Matrix4()
  private center = new THREE.Vector3()

  constructor() {
    super({
      name: 'DustRadialBlur',
      uniforms: {
        tDiffuse: { value: null },
        uCenter: { value: new THREE.Vector2(0.5, 0.5) },
        uRadius: { value: new THREE.Vector2(0.2, 0.35) },
        uTexel: { value: new THREE.Vector2(1 / 1000, 1 / 1000) },
        uStrength: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform vec2 uCenter;
        uniform vec2 uRadius;
        uniform vec2 uTexel;
        uniform float uStrength;
        varying vec2 vUv;

        void main() {
          // Integer fetch avoids even a subpixel resample in the protected center.
          vec4 original = texelFetch(tDiffuse, ivec2(gl_FragCoord.xy), 0);
          vec2 ray = vUv - uCenter;
          float radius = length(ray / uRadius);
          float edge = smoothstep(0.58, 1.15, radius);
          // Eyes, nose and lips pass through exactly, including their existing bloom.
          if (edge < 0.0001 || uStrength <= 0.0) {
            gl_FragColor = original;
            return;
          }

          float reach = 0.30 * uStrength * edge;
          vec3 streak = vec3(0.0);
          float total = 0.0;
          // Stable subpixel offsets hide repeated-dot banding without animated noise.
          float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
          vec2 direction = normalize(ray / uTexel);
          vec2 across = vec2(-direction.y, direction.x) * uTexel * 1.5 * edge * uStrength;
          // Sample inward: particles leave light trails OUTWARD, away from the face.
          // A half-Gaussian kernel feathers the trail instead of making hard replicas.
          for (int i = 0; i < 32; i++) {
            float t = (float(i) + jitter) / 32.0;
            float weight = exp(-3.0 * t * t);
            vec2 sampleUv = vUv - ray * reach * t + across * (fract(float(i) * 0.618034 + jitter) - 0.5);
            // Do not clamp an offscreen highlight into a stripe along the viewport.
            if (all(greaterThanEqual(sampleUv, vec2(0.0))) && all(lessThanEqual(sampleUv, vec2(1.0)))) {
              streak += texture2D(tDiffuse, sampleUv).rgb * weight;
              total += weight;
            }
          }
          // Retain a little particle texture under the streaks. Normalize the kernel
          // so changing the blur does not change the scene's exposure or palette.
          gl_FragColor = vec4(mix(original.rgb, streak / max(total, 0.0001), edge * 0.88), original.a);
        }
      `,
    })
    this.enabled = false
  }

  setStrength(strength: number) {
    this.uniforms.uStrength.value = Number.isFinite(strength) ? THREE.MathUtils.clamp(strength, 0, 1) : 0
    // A zero slider value also avoids the full-screen draw entirely.
    this.enabled = this.uniforms.uStrength.value > 0
  }

  override setSize(width: number, height: number) {
    this.uniforms.uTexel.value.set(1 / Math.max(1, width), 1 / Math.max(1, height))
  }

  /** Project the head frame, so the focus follows placement, rotation, oval shape and camera framing. */
  update(headMatrix: THREE.Matrix4, group: THREE.Object3D, camera: THREE.PerspectiveCamera) {
    if (!this.enabled) return
    group.updateWorldMatrix(true, false)
    camera.updateMatrixWorld()
    this.headToView.multiplyMatrices(camera.matrixWorldInverse, group.matrixWorld).multiply(headMatrix)
    this.center.set(0, 0.40 / REF_SCALE, 0.40 / REF_SCALE).applyMatrix4(this.headToView)
    const distance = Math.max(camera.near, -this.center.z)
    const projection = camera.projectionMatrix.elements
    const px = projection[0] * 0.5 / distance, py = projection[5] * 0.5 / distance
    this.uniforms.uCenter.value.set(0.5 + this.center.x * px, 0.5 + this.center.y * py)

    // Screen bounds of a head-sized ellipsoid. Include depth so the focus region
    // never collapses into a thin strip when the user turns the head sideways.
    const m = this.headToView.elements
    const rx = Math.hypot(m[0] * 0.42, m[4] * 0.66, m[8] * 0.42) / REF_SCALE
    const ry = Math.hypot(m[1] * 0.42, m[5] * 0.66, m[9] * 0.42) / REF_SCALE
    this.uniforms.uRadius.value.set(Math.max(0.001, rx * px), Math.max(0.001, ry * py))
  }
}
