import * as THREE from 'three'

/** Area-weighted surface sampling that carries every morph delta onto the dust particles. */
export function sampleAnimatedSurface(source: THREE.BufferGeometry, count: number) {
  const position = source.getAttribute('position')
  const normal = source.getAttribute('normal')
  const feature = source.getAttribute('aFeature')
  const indices = source.index!
  const triangles = indices.count / 3
  const areas = new Float32Array(triangles)
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3()
  let total = 0
  for (let i = 0; i < triangles; i++) {
    a.fromBufferAttribute(position, indices.getX(i * 3))
    b.fromBufferAttribute(position, indices.getX(i * 3 + 1))
    c.fromBufferAttribute(position, indices.getX(i * 3 + 2))
    total += b.sub(a).cross(c.sub(a)).length() * 0.5
    areas[i] = total
  }
  const geometry = new THREE.BufferGeometry()
  const make = (size: number) => new THREE.Float32BufferAttribute(new Float32Array(count * size), size)
  const pos = make(3), nor = make(3), features = make(1), seeds = make(4)
  const morphPos = (source.morphAttributes.position ?? []).map(() => make(3))
  const morphNor = (source.morphAttributes.normal ?? []).map(() => make(3))
  let state = 42817
  const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296)
  for (let i = 0; i < count; i++) {
    const distance = random() * total
    let lo = 0, hi = triangles - 1
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (areas[mid] < distance) lo = mid + 1
      else hi = mid
    }
    const ia = indices.getX(lo * 3), ib = indices.getX(lo * 3 + 1), ic = indices.getX(lo * 3 + 2)
    let u = random(), v = random()
    if (u + v > 1) { u = 1 - u; v = 1 - v }
    const w = 1 - u - v
    const sample = (from: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, to: THREE.BufferAttribute, normalize = false) => {
      a.fromBufferAttribute(from, ia).multiplyScalar(u)
      b.fromBufferAttribute(from, ib).multiplyScalar(v)
      c.fromBufferAttribute(from, ic).multiplyScalar(w)
      a.add(b).add(c)
      if (normalize) a.normalize()
      to.setXYZ(i, a.x, a.y, a.z)
    }
    sample(position, pos)
    sample(normal, nor, true)
    features.setX(i, feature.getX(ia))
    seeds.setXYZW(i, random(), random(), random(), random())
    for (let k = 0; k < morphPos.length; k++) sample(source.morphAttributes.position![k], morphPos[k])
    for (let k = 0; k < morphNor.length; k++) sample(source.morphAttributes.normal![k], morphNor[k])
  }
  geometry.setAttribute('position', pos)
  geometry.setAttribute('normal', nor)
  geometry.setAttribute('aFeature', features)
  geometry.setAttribute('aSeed', seeds)
  geometry.morphAttributes = { position: morphPos, normal: morphNor }
  geometry.morphTargetsRelative = true
  return geometry
}
