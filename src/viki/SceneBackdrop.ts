import * as THREE from 'three'

/**
 * A quiet, abstract backdrop for the studio scenes (Max and Dust): an isometric
 * line grid with a few large wireframe cubes, fading out towards the edges so
 * the plain clear colour never shows as an empty wall.
 */
export class SceneBackdrop {
  readonly mesh: THREE.Mesh
  private material: THREE.ShaderMaterial

  constructor() {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uBase: { value: new THREE.Color(0x414141) },
        uLine: { value: new THREE.Color(0x393939) },
        uGlow: { value: new THREE.Color(0x4a4a4a) },
        uTime: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vP;
        void main() {
          vP = position.xy;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uBase, uLine, uGlow;
        uniform float uTime;
        varying vec2 vP;
        float lineAt(float v) {
          float f = abs(fract(v) - 0.5);
          float d = fwidth(v);
          return 1.0 - smoothstep(0.012, 0.012 + d * 1.6, f);
        }
        float segment(vec2 q, vec2 dir, float len) {
          float t = clamp(dot(q, dir), 0.0, len);
          return length(q - dir * t);
        }
        // A wireframe cube in isometric view: hexagon outline + three inner edges.
        float cubeArt(vec2 q, float r) {
          vec2 a = abs(q);
          float hexDist = max(a.x * 0.866 + a.y * 0.5, a.y) - r;
          float art = 1.0 - smoothstep(0.010, 0.028, abs(hexDist));
          art = max(art, 1.0 - smoothstep(0.010, 0.028, segment(q, vec2(0.0, 1.0), r)));
          art = max(art, 1.0 - smoothstep(0.010, 0.028, segment(q, vec2(-0.866, -0.5), r)));
          art = max(art, 1.0 - smoothstep(0.010, 0.028, segment(q, vec2(0.866, -0.5), r)));
          return art;
        }
        void main() {
          vec2 p = vP * 0.75;
          float grid = max(max(lineAt(p.x), lineAt(dot(p, vec2(0.5, 0.866)))), lineAt(dot(p, vec2(-0.5, 0.866))));
          float cubes = cubeArt((vP - vec2(-5.2, 2.1)) / 1.5, 1.0) * 0.9;
          cubes = max(cubes, cubeArt((vP - vec2(4.6, -0.6)) / 0.9, 1.0) * 0.7);
          cubes = max(cubes, cubeArt((vP - vec2(3.1, 3.2)) / 0.55, 1.0) * 0.55);
          float vignette = smoothstep(1.15, 0.25, length(vP * vec2(0.115, 0.20)));
          float breathe = 0.85 + 0.15 * sin(uTime * 0.12 + vP.x * 0.08);
          vec3 color = mix(uBase, uLine, grid * 0.55 * vignette * breathe);
          color = mix(color, uGlow, cubes * 0.5 * vignette);
          gl_FragColor = vec4(color, 1.0);
        }`,
      depthWrite: false,
    })
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(30, 16), this.material)
    this.mesh.position.z = -6
    this.mesh.renderOrder = -10
    this.mesh.frustumCulled = false
    this.mesh.visible = false
  }

  /** Only the Dust studio uses the line-art wall; Max and VIKI have photo backdrops. */
  setStyle(style: string) {
    this.mesh.visible = style === 'dust'
    const u = this.material.uniforms
    ;(u.uBase.value as THREE.Color).set(0x02050c)
    ;(u.uLine.value as THREE.Color).set(0x0a1322)
    ;(u.uGlow.value as THREE.Color).set(0x15243c)
  }

  update(time: number) {
    this.material.uniforms.uTime.value = time
  }

  dispose() {
    this.mesh.geometry.dispose()
    this.material.dispose()
  }
}
