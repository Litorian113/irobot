import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { mapVisemes, SPEECH_MORPHS } from './visemes.ts'

export const MORPH_NAMES = ['jawOpen', 'mouthWide', 'mouthRound', 'smile', 'frown', 'blinkLeft', 'blinkRight', 'browUp', 'browDown', 'mouthClose', 'mouthPress', 'mouthPucker', 'mouthFunnel', 'upperLipUp', 'lowerLipDown', 'lowerLipRoll'] as const

/** Preserve all face parts and bake their node transforms into one canonical, morphable geometry. */
export class HeadRig {
  readonly geometry: THREE.BufferGeometry
  readonly influences = MORPH_NAMES.map(() => 0)
  readonly rigged: boolean

  constructor(scene: THREE.Object3D) {
    scene.updateMatrixWorld(true)
    const parts: THREE.BufferGeometry[] = []
    let rigged = false
    scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      const source = object.geometry
      const geometry = source.clone()
      const count = geometry.getAttribute('position').count
      const part = object.userData.vikiPart || object.name
      const feature = /mouthinterior/i.test(part) ? 2 : /eyes/i.test(part) ? 1 : 0
      geometry.setAttribute('aFeature', new THREE.BufferAttribute(new Float32Array(count).fill(feature), 1))
      for (const name of Object.keys(geometry.attributes)) {
        if (!['position', 'normal', 'aFeature'].includes(name)) geometry.deleteAttribute(name)
      }
      if (!geometry.getAttribute('normal')) geometry.computeVertexNormals()
      if (!geometry.index) geometry.setIndex(Array.from({ length: count }, (_, i) => i))
      const normalMatrix = new THREE.Matrix3().getNormalMatrix(object.matrixWorld)
      const linearMatrix = new THREE.Matrix3().setFromMatrix4(object.matrixWorld)
      geometry.getAttribute('position').applyMatrix4(object.matrixWorld)
      geometry.getAttribute('normal').applyNormalMatrix(normalMatrix)
      const positions: THREE.BufferAttribute[] = []
      const normals: THREE.BufferAttribute[] = []
      for (const name of MORPH_NAMES) {
        const index = object.morphTargetDictionary?.[name]
        rigged ||= index !== undefined
        const p = new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3)
        const n = new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3)
        if (index !== undefined) {
          const sourceP = source.morphAttributes.position?.[index]
          const sourceN = source.morphAttributes.normal?.[index]
          const v = new THREE.Vector3()
          for (let i = 0; i < count; i++) {
            if (sourceP) {
              v.fromBufferAttribute(sourceP, i)
              if (!source.morphTargetsRelative) v.sub(new THREE.Vector3().fromBufferAttribute(source.getAttribute('position'), i))
              v.applyMatrix3(linearMatrix)
              p.setXYZ(i, v.x, v.y, v.z)
            }
            if (sourceN) {
              v.fromBufferAttribute(sourceN, i)
              if (!source.morphTargetsRelative) v.sub(new THREE.Vector3().fromBufferAttribute(source.getAttribute('normal'), i))
              v.applyMatrix3(normalMatrix)
              n.setXYZ(i, v.x, v.y, v.z)
            }
          }
        }
        p.name = name
        n.name = name
        positions.push(p)
        normals.push(n)
      }
      geometry.morphAttributes = { position: positions, normal: normals }
      geometry.morphTargetsRelative = true
      parts.push(geometry)
    })
    if (!parts.length) throw new Error('The head model contains no meshes')
    const merged = mergeGeometries(parts)
    for (const part of parts) part.dispose()
    if (!merged) throw new Error('Head model parts could not be merged')
    // mergeGeometries copies the target attributes, but not this flag.
    // Without it each expression scales the entire head by 1 - sum(weights).
    merged.morphTargetsRelative = true
    this.geometry = merged
    this.rigged = rigged
  }

  /** All visible, depth and offscreen passes share the exact same pose array. */
  bind(root: THREE.Object3D) {
    root.traverse((object) => {
      if ((object instanceof THREE.Mesh || object instanceof THREE.Points) && object.geometry.morphAttributes.position?.length === MORPH_NAMES.length) {
        object.morphTargetInfluences = this.influences
      }
    })
  }

  update(open: number, wide: number, round: number, smile: number, brow: number, eyeOpen: number, visemes?: readonly number[], strength = 1) {
    const clamp = THREE.MathUtils.clamp
    const values = [
      clamp(open, 0, 1) * 0.6,
      clamp(wide * open, 0, 1) * 0.45,
      clamp(round, 0, 1) * 0.65,
      clamp(smile, 0, 1) * 0.6,
      clamp(-smile, 0, 1) * 0.5,
      1 - clamp(eyeOpen, 0, 1),
      1 - clamp(eyeOpen, 0, 1),
      clamp(brow, 0, 1) * 0.55,
      clamp(-brow, 0, 1) * 0.45,
    ]
    this.influences.fill(0)
    for (let i = 0; i < values.length; i++) this.influences[i] = values[i]
    if (visemes && this.rigged) {
      const { pose, expressionScale } = mapVisemes(visemes, strength)
      this.influences[2] = 0 // The legacy combined rounding pose must not stack with funnel/pucker.
      this.influences[3] *= expressionScale
      this.influences[4] *= expressionScale
      for (const name of SPEECH_MORPHS) this.influences[MORPH_NAMES.indexOf(name)] = pose[name]
    }
  }

  dispose() { this.geometry.dispose() }
}
