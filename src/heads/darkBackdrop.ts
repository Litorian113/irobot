import * as THREE from 'three'

/** The one background of every scary head (category `gruselig`), so that they sit side by side on the wall. */
export const DARK_BACKDROP = 0x0b0b0e

const RED = ((DARK_BACKDROP >> 16) & 255) / 255
const GREEN = ((DARK_BACKDROP >> 8) & 255) / 255
const BLUE = (DARK_BACKDROP & 255) / 255

/** Fills the whole picture, whatever the camera does. Returns its material, to dispose with the head. */
export function addDarkBackdrop(scene: THREE.Scene) {
  const material = new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `void main() { gl_Position = vec4(position.xy, 1.0, 1.0); }`,
    fragmentShader: /* glsl */ `void main() { gl_FragColor = vec4(${RED.toFixed(4)}, ${GREEN.toFixed(4)}, ${BLUE.toFixed(4)}, 1.0); }`,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
  })
  const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material)
  backdrop.frustumCulled = false
  backdrop.renderOrder = -10
  scene.add(backdrop)
  return material
}
