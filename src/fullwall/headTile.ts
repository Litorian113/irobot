import * as THREE from 'three'
import { height, width, type Rect } from './geometry'

/**
 * One head over the whole wall: every perspective camera on this page frames the whole wall,
 * and shows only the part `tile` of it. The heads need no change; this page shows one screen
 * and one head. Returns a function that undoes it.
 */
export function frameAsTileOf(wall: Rect, tile: Rect) {
  const prototype = THREE.PerspectiveCamera.prototype
  const original = prototype.updateProjectionMatrix
  const MM = 1000
  prototype.updateProjectionMatrix = function (this: THREE.PerspectiveCamera) {
    this.aspect = width(wall) / height(wall)
    this.view = {
      enabled: true,
      fullWidth: width(wall) * MM,
      fullHeight: height(wall) * MM,
      offsetX: (tile.x0 - wall.x0) * MM,
      offsetY: (wall.y1 - tile.y1) * MM,
      width: width(tile) * MM,
      height: height(tile) * MM,
    }
    original.call(this)
  }
  return () => { prototype.updateProjectionMatrix = original }
}
