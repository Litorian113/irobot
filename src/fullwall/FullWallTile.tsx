import { useRef } from 'react'
import { tileRect } from './geometry'
import { useWallPicture } from './useWallPicture'
import type { FullWall } from './state'
import { SETTINGS } from '../wall'

/**
 * One screen of the whole-wall picture: the part of the pattern or the head that falls on place
 * `slot` of the shelf, steered by the camera like everything on the wall.
 */
export default function FullWallTile({ slot, state }: { slot: number; state: FullWall }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const pointer = useRef(null)
  useWallPicture(canvas, state, tileRect(slot), true, pointer, { fps: SETTINGS.fps, maxPixelRatio: 1 })
  return (
    <div className="cell">
      <canvas ref={canvas} />
    </div>
  )
}
