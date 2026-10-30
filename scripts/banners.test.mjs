import assert from 'node:assert/strict'
import test from 'node:test'
import { bannersAsAddOns, bannerOf, PROMO_BANNERS } from '../src/banners.ts'
import { isLayout } from '../src/layout.ts'

test('a banner saved in place of a head becomes an add-on over its head', () => {
  const old = [[{ slot: 3, key: 'main-19' }, { slot: 4, key: 'promo-halloween' }, { slot: 5, key: 'promo' }]]
  assert.deepEqual(bannersAsAddOns(old), [[
    { slot: 3, key: 'main-19' },
    { slot: 4, key: 'main-13', banner: 'promo-halloween' },
    { slot: 5, key: 'main-11', banner: 'promo' },
  ]])
})

test('a head with a banner stays as it is', () => {
  const wall = [[{ slot: 4, key: 'main-16', banner: 'promo-halloween' }]]
  assert.deepEqual(bannersAsAddOns(wall), wall)
})

test('the server takes a banner on a cell, but only a clean one', () => {
  assert.equal(isLayout([[{ slot: 4, key: 'main-16', banner: 'promo-halloween' }]]), true)
  assert.equal(isLayout([[{ slot: 4, key: 'main-16' }]]), true)
  assert.equal(isLayout([[{ slot: 4, key: 'main-16', banner: '<x>' }]]), false)
  assert.equal(isLayout([[{ slot: 4, key: 'main-16', banner: 3 }]]), false)
})

test('every banner has a line for both moments', () => {
  for (const banner of PROMO_BANNERS) {
    assert.ok(banner.idle.length && banner.seen.length, banner.key)
    assert.equal(bannerOf(banner.key), banner)
  }
})
