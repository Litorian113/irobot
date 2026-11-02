import { useRef, type PointerEvent } from 'react'
import { isOffline } from '../layout'
import { height, tileRect, wallRect, width } from './geometry'
import type { FullWall } from './state'
import { useWallPicture, type Person } from './useWallPicture'

/**
 * The whole wall at once, as one picture behind the shelf: the screens are windows into it, the
 * frames and gaps are dark, the places without a screen yet are marked. A pointer over it stands in
 * for a person unless `live`.
 */
export default function FullWallStage({ state, live = false }: { state: FullWall; live?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const pointer = useRef<Person>(null)
  const wall = wallRect()
  useWallPicture(canvas, state, wall, live, pointer, { fps: 30, maxPixelRatio: 1.5 })

  const onMove = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    pointer.current = {
      x: wall.x0 + ((event.clientX - box.left) / box.width) * width(wall),
      y: wall.y1 - ((event.clientY - box.top) / box.height) * height(wall),
      z: 1.2,
    }
  }
  const tiles = Array.from({ length: 9 }, (_, slot) => ({ slot, rect: tileRect(slot), offline: isOffline(slot) }))
  const svgY = (y: number) => wall.y1 - y

  return (
    <div
      className="full-wall-stage"
      style={{ aspectRatio: `${width(wall)} / ${height(wall)}` }}
      onPointerMove={onMove}
      onPointerLeave={() => { pointer.current = null }}
    >
      {state.mode !== 'off' && <canvas ref={canvas} key={state.mode === 'pattern' ? state.pattern : state.head} />}
      <svg viewBox={`0 0 ${width(wall)} ${height(wall)}`} preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <mask id="full-wall-screens">
            <rect x="0" y="0" width={width(wall)} height={height(wall)} fill="#fff" />
            {tiles.map(({ slot, rect }) => (
              <rect key={slot} x={rect.x0 - wall.x0} y={svgY(rect.y1)} width={width(rect)} height={height(rect)} fill="#000" />
            ))}
          </mask>
        </defs>
        <rect x="0" y="0" width={width(wall)} height={height(wall)} fill="rgba(8, 8, 10, 0.86)" mask="url(#full-wall-screens)" />
        {tiles.filter((t) => t.offline).map(({ slot, rect }) => (
          <g key={slot}>
            <rect x={rect.x0 - wall.x0} y={svgY(rect.y1)} width={width(rect)} height={height(rect)} fill="rgba(8, 8, 10, 0.5)" stroke="rgba(255,255,255,0.7)" strokeWidth="0.006" strokeDasharray="0.02 0.015" />
            <text x={rect.x0 - wall.x0 + width(rect) / 2} y={svgY(rect.y0) - height(rect) / 2} textAnchor="middle" dominantBaseline="middle" fontSize="0.035" fill="#fff">noch kein Bildschirm</text>
          </g>
        ))}
      </svg>
    </div>
  )
}
