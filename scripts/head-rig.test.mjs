import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { HeadRig, MORPH_NAMES } from '../src/viki/HeadRig.ts'
import { sampleAnimatedSurface } from '../src/viki/sampleSurface.ts'
import { fixedViseme } from '../src/viki/visemes.ts'

const data = await readFile(new URL('../public/models/VikiHead.glb', import.meta.url))
const gltf = await new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '')
const rig = new HeadRig(gltf.scene)

test('the bundled model retains skin, eyes, mouth and all relative pose/normal targets', () => {
  const g = rig.geometry
  assert.equal(rig.rigged, true)
  assert.equal(g.morphTargetsRelative, true)
  assert.deepEqual([...new Set(g.attributes.aFeature.array)].sort(), [0, 1, 2])
  for (const type of ['position', 'normal']) {
    assert.equal(g.morphAttributes[type].length, MORPH_NAMES.length)
    for (const a of g.morphAttributes[type]) {
      assert.equal(a.count, g.attributes.position.count)
      assert.ok(a.array.every(Number.isFinite))
    }
  }
})

test('talking and blinking move the face without shrinking the skull or eyeballs', () => {
  const g = rig.geometry
  const mesh = new THREE.Mesh(g)
  rig.bind(mesh)
  let crown = 0, eye = -1, jaw = 0
  for (let i = 0; i < g.attributes.position.count; i++) {
    if (g.attributes.position.getY(i) > g.attributes.position.getY(crown)) crown = i
    if (g.attributes.aFeature.getX(i) === 1) eye = i
    if (g.morphAttributes.position[0].getY(i) < g.morphAttributes.position[0].getY(jaw)) jaw = i
  }
  const base = (i) => new THREE.Vector3().fromBufferAttribute(g.attributes.position, i)
  rig.update(0.8, 0.5, 0.3, 0.25, 0.08, 0)
  for (const i of [crown, eye]) assert.ok(mesh.getVertexPosition(i, new THREE.Vector3()).distanceTo(base(i)) < 1e-5)
  assert.ok(mesh.getVertexPosition(jaw, new THREE.Vector3()).y < base(jaw).y - 0.1)
  rig.update(0, 0, 0, 0, 0, 1)
  assert.ok(mesh.getVertexPosition(jaw, new THREE.Vector3()).distanceTo(base(jaw)) < 1e-5)
  mesh.material.dispose()
})

test('surface particles and depth meshes use the same pose and retain sampled targets', () => {
  const dust = sampleAnimatedSurface(rig.geometry, 4000)
  const root = new THREE.Group()
  const depth = new THREE.Mesh(rig.geometry)
  const points = new THREE.Points(dust)
  root.add(depth, points)
  rig.bind(root)
  assert.equal(depth.morphTargetInfluences, rig.influences)
  assert.equal(points.morphTargetInfluences, rig.influences)
  assert.equal(dust.morphTargetsRelative, true)
  assert.equal(dust.morphAttributes.position.length, MORPH_NAMES.length)
  assert.ok(dust.morphAttributes.position[0].array.some((v) => Math.abs(v) > 0.1))
  assert.ok(dust.morphAttributes.normal[5].array.some((v) => Math.abs(v) > 0.01))
  dust.dispose()
  depth.material.dispose()
  points.material.dispose()
})

test('node transforms affect positions and relative deltas correctly', () => {
  const geometry = new THREE.BoxGeometry()
  geometry.morphTargetsRelative = true
  const delta = new Float32Array(geometry.attributes.position.count * 3)
  for (let i = 0; i < delta.length; i += 3) delta[i] = 0.1
  const target = new THREE.BufferAttribute(delta, 3)
  target.name = 'jawOpen'
  geometry.morphAttributes.position = [target]
  const mesh = new THREE.Mesh(geometry)
  mesh.position.set(2, 3, 4)
  mesh.scale.setScalar(2)
  const transformed = new HeadRig(mesh)
  assert.ok(Math.abs(transformed.geometry.attributes.position.getX(0) - (geometry.attributes.position.getX(0) * 2 + 2)) < 1e-5)
  assert.ok(Math.abs(transformed.geometry.morphAttributes.position[0].getX(0) - 0.2) < 1e-5)
  transformed.dispose()
  geometry.dispose()
  mesh.material.dispose()
})

test('all seven additional lip poses move actual model vertices and preserve eye geometry', () => {
  const g = rig.geometry
  for (const name of ['mouthClose', 'mouthPress', 'mouthPucker', 'mouthFunnel', 'upperLipUp', 'lowerLipDown', 'lowerLipRoll']) {
    const target = g.morphAttributes.position[MORPH_NAMES.indexOf(name)]
    assert.ok(target.array.some((v) => Math.abs(v) > 0.001), `${name} has a real lip deformation`)
    for (let i = 0; i < target.count; i++) {
      if (g.attributes.aFeature.getX(i) === 1) assert.ok(Math.abs(target.getX(i)) + Math.abs(target.getY(i)) + Math.abs(target.getZ(i)) < 1e-6)
    }
  }
})

test('speech closure suppresses the smile, preserves eyelids and clears when speech ends', () => {
  rig.update(0.9, 0.9, 0.9, 1, 0.5, 0.3, fixedViseme('PP'))
  const weight = (name) => rig.influences[MORPH_NAMES.indexOf(name)]
  assert.equal(weight('jawOpen'), 0)
  assert.equal(weight('smile'), 0)
  assert.equal(weight('mouthRound'), 0)
  assert.ok(weight('mouthPress') > 0)
  assert.equal(weight('blinkLeft'), 0.7)
  rig.update(0, 0, 0, 1, 0.5, 0.3, [])
  assert.equal(weight('mouthPress'), 0)
  assert.equal(weight('smile'), 0.6)
  rig.update(0, 0, 0, 0, 0, 1)
  assert.ok(rig.influences.every((v) => v === 0))
})
