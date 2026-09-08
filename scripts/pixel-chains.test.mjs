import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CHAIN_GRID_SIZE, createPixelChains, chainCells, PixelChains } from '../src/viki/PixelChains.ts'

const distance = (a, b) => a.reduce((sum, n, i) => {
  const delta = Math.abs(n - b[i])
  return sum + Math.min(delta, CHAIN_GRID_SIZE - delta)
}, 0)

test('pixel trails contain 3–5 connected cells and turn in all four directions, including loop seams', () => {
  const chains = createPixelChains()
  assert.equal(chains.length, 112)
  assert.deepEqual(chains, createPixelChains(), 'Deterministic previews can seek directly to a time')
  for (const chain of chains) {
    assert.ok(chain.length >= 3 && chain.length <= 5)
    const directions = new Set()
    for (let i = 0; i < chain.path.length; i++) {
      const a = chain.path[i], b = chain.path[(i + 1) % chain.path.length]
      assert.equal(distance(a, b), 1, 'No teleport at bends or at the end of a loop')
      directions.add(b.map((n, k) => ((n - a[k] + 192) % 128) - 64).join(','))
    }
    assert.equal(directions.size, 4)
    for (const step of [0, 7, 41, 500, 100000]) {
      const cells = chainCells(chain, step)
      assert.equal(cells.length, chain.length)
      assert.equal(new Set(cells.map(String)).size, cells.length)
      cells.slice(1).forEach((cell, i) => assert.equal(distance(cells[i], cell), 1))
      assert.ok(distance(cells[0], chainCells(chain, step + 1)[0]) <= 1)
    }
  }
})

test('chain animation reuses one texture, uploads only at cell steps and can seek backwards', () => {
  const chains = new PixelChains(), texture = chains.texture, data = texture.image.data
  try {
    const start = data.slice(), version = texture.version
    chains.update(0.05, 1)
    assert.equal(texture.version, version)
    assert.ok(chains.uniforms.uChainMix.value > 0)
    chains.update(2, 1)
    assert.notDeepEqual(data, start)
    assert.equal(chains.texture, texture)
    assert.equal(texture.image.data, data)
    chains.update(0, 1)
    assert.deepEqual(data, start)
    chains.update(12345, 0)
    assert.deepEqual(data, start, 'Speed zero freezes the chains')
  } finally { chains.dispose() }
})
