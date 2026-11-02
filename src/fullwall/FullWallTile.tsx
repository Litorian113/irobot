import { useRef } from 'react'
import { tileRect } from './geometry'
import { useWallPicture } from './useWallPicture'
import type { FullWall } from './state'
import { bannerOf } from '../banners'
import { BannerOver } from '../Promo'
import { PROMO_SLOT, SETTINGS } from '../wall'

/**
 * One screen of the whole-wall picture: the part of the pattern or the head that falls on place
 * `slot` of the shelf, steered by the camera like everything on the wall. The middle screen carries
 * the banner on top, if one is set.
 */
export default function FullWallTile({ slot, state }: { slot: number; state: FullWall }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const pointer = useRef(null)
  useWallPicture(canvas, state, tileRect(slot), true, pointer, { fps: SETTINGS.fps, maxPixelRatio: 1 })
  const banner = slot === PROMO_SLOT ? bannerOf(state.banner) : null
  const picture = (
    <div className="cell">
      <canvas ref={canvas} />
    </div>
  )
  return banner ? <BannerOver banner={banner}>{picture}</BannerOver> : picture
}
