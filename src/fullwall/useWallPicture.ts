import { useEffect, useRef } from 'react'
import { catalogEntry } from '../heads/catalog'
import type { HeadView } from '../heads/types'
import { onGrowth, serverNow, subscribe, type GazeMessage } from '../tracking/bus'
import { SHAPE_H, SHAPE_W, syntheticShape, unpackShape } from '../tracking/silhouette'
import { lookAngles, type Vec3 } from '../tracking/gaze'
import { height, wallRect, type Rect } from './geometry'
import { frameAsTileOf } from './headTile'
import { createPattern, type PatternView } from './pattern'
import { createSilhouette } from './silhouette'
import { createFigures, syntheticPose, type PoseInput } from './figure'
import { Growth } from './growth'
import { createGrowthView } from './growthView'
import type { FullWall } from './state'

/** Gaze messages older than this mean the camera window is gone. */
const STALE_MS = 2000
/** The wall's middle: the head over the whole wall looks from there. */
const MIDDLE: Vec3 = { x: 0, y: 0, z: 0 }

export type Person = { x: number; y: number; z: number } | null
/** What the picture reacts to: where the person is, and their outline when the camera can tell it. */
type Seen = { person: Person; shape: Uint8Array | null; poses: PoseInput[] }

/**
 * Who the picture reacts to: the camera's person (`live`), or a pointer over the preview standing in
 * for one. Calls `onPerson` 15 times a second, null when nobody is there.
 */
function usePerson(live: boolean, pointer: React.MutableRefObject<Person>, onPerson: (seen: Seen) => void) {
  const callback = useRef(onPerson)
  useEffect(() => { callback.current = onPerson })
  useEffect(() => {
    let latest: GazeMessage | null = null
    let receivedAt = 0
    const off = live ? subscribe((message) => { latest = message; receivedAt = performance.now() }) : () => {}
    const timer = window.setInterval(() => {
      if (!live) return callback.current({ person: pointer.current, shape: pointer.current ? shapeAt(pointer.current) : null, poses: pointer.current ? poseAt(pointer.current) : [] })
      const message = latest && performance.now() - receivedAt < STALE_MS ? latest : null
      const present = Boolean(message?.present && message.person)
      callback.current({ person: present ? message!.person : null, shape: present && message?.shape ? unpackShape(message.shape) : null, poses: present ? message?.poses ?? [] : [] })
    }, 1000 / 15)
    return () => {
      window.clearInterval(timer)
      off()
    }
  }, [live, pointer])
}

/** For the preview: a made-up person whose face is at the pointer (in wall metres). */
function shapeAt(person: { x: number; y: number }) {
  const wall = wallRect()
  const frameH = height(wall), frameW = frameH * 16 / 9
  const u = 0.5 - (person.x - (wall.x0 + wall.x1) / 2) / frameW
  const v = 0.5 - (person.y - (wall.y0 + wall.y1) / 2) / frameH
  // A second person further back, so that two colours can be seen side by side.
  return syntheticShape(u > 0.5 ? u - 0.2 : u + 0.2, v + 0.06, 0.42, 2, syntheticShape(u, v, 0.58, 1))
}
/** For the preview: a made-up person standing with their face at the pointer. */
function poseAt(person: { x: number; y: number }): PoseInput[] {
  const wall = wallRect()
  const frameH = height(wall), frameW = frameH * 16 / 9
  const u = 0.5 - (person.x - (wall.x0 + wall.x1) / 2) / frameW
  const v = 0.5 - (person.y - (wall.y0 + wall.y1) / 2) / frameH
  return [{ id: 1, points: syntheticPose(u, v, 0.7, performance.now() / 1000) }]
}

/**
 * One head or pattern in `canvas`, steered by `person`; the head looks from the wall's middle.
 * A pattern shows the part `view` of the wall; a head frames the whole wall and, on a screen of it,
 * shows only that screen's part (`view` smaller than the wall).
 */
export function useWallPicture(canvas: React.RefObject<HTMLCanvasElement | null>, state: FullWall, view: Rect, live: boolean, pointer: React.MutableRefObject<Person>, options: { fps: number; maxPixelRatio: number }) {
  const picture = useRef<{ pattern?: PatternView; silhouette?: ReturnType<typeof createSilhouette>; figures?: ReturnType<typeof createFigures>; head?: HeadView } | null>(null)
  const key = state.mode === 'pattern' ? state.pattern : state.mode === 'head' ? state.head : 'off'
  const { x0, y0, x1, y1 } = view

  useEffect(() => {
    const element = canvas.current
    if (!element || state.mode === 'off') return
    let pattern: PatternView | undefined
    let silhouette: ReturnType<typeof createSilhouette> | undefined
    let figures: ReturnType<typeof createFigures> | undefined
    let growthView: ReturnType<typeof createGrowthView> | undefined
    let stopGrowth: (() => void) | undefined
    let head: HeadView | undefined
    const wall = wallRect()
    const part = x0 > wall.x0 + 1e-6 || x1 < wall.x1 - 1e-6 || y0 > wall.y0 + 1e-6 || y1 < wall.y1 - 1e-6
    // Set before the head is made: its camera then frames the wall and cuts out this screen.
    const unframe = state.mode === 'head' && part ? frameAsTileOf(wall, { x0, y0, x1, y1 }) : null
    try {
      const kind = state.mode === 'pattern' ? state.pattern : null
      if (kind === 'geaest') {
        const view = createGrowthView(element, { x0, y0, x1, y1 }, { fps: options.fps, maxPixelRatio: options.maxPixelRatio })
        growthView = view
        if (live) {
          // On the wall: the server grows it; first what it has, then each new piece.
          const off = onGrowth((delta) => view.apply(delta))
          void fetch('/api/growth', { cache: 'no-store' }).then((r) => r.json()).then((snapshot) => view.load(snapshot), () => {})
          stopGrowth = off
        } else {
          // The preview grows its own, from the pointer.
          const growth = new Growth(wallRect())
          const timer = window.setInterval(() => {
            const p = pointer.current
            const delta = growth.step({ person: p, cells: p ? shapeAt(p) : null, gridW: SHAPE_W, gridH: SHAPE_H }, performance.now() / 1000)
            if (delta) view.apply(delta)
          }, 100)
          stopGrowth = () => window.clearInterval(timer)
        }
      } else if (kind === 'figur') {
        figures = createFigures(element, { x0, y0, x1, y1 }, { now: serverNow, fps: options.fps, maxPixelRatio: options.maxPixelRatio })
      } else if (kind === 'silhouette' || kind === 'schraffur' || kind === 'gewirr') {
        silhouette = createSilhouette(element, { x0, y0, x1, y1 }, { now: serverNow, fps: options.fps, maxPixelRatio: options.maxPixelRatio, style: kind })
      } else if (kind) {
        pattern = createPattern(element, kind, { x0, y0, x1, y1 }, { now: serverNow, fps: options.fps, maxPixelRatio: options.maxPixelRatio })
      } else if (state.mode === 'head') {
        const entry = catalogEntry(state.head)
        if (!entry?.create) {
          unframe?.()
          return
        }
        head = entry.create(element, { fps: options.fps, maxPixelRatio: options.maxPixelRatio, stiffness: 5, delay: 0.05 })
      }
    } catch (error) {
      console.warn('[ganze wand] WebGL nicht verfügbar', error)
      unframe?.()
      return
    }
    picture.current = { pattern, silhouette, figures, head }
    ;(window as unknown as { __fullWall?: unknown }).__fullWall = pattern ?? silhouette ?? figures ?? growthView ?? head
    return () => {
      picture.current = null
      pattern?.dispose()
      silhouette?.dispose()
      figures?.dispose()
      stopGrowth?.()
      growthView?.dispose()
      head?.dispose()
      unframe?.()
    }
    // The state's key says all that matters; the object is new on every load.
  }, [canvas, key, state.mode, x0, y0, x1, y1, options.fps, options.maxPixelRatio]) // eslint-disable-line react-hooks/exhaustive-deps

  const presentSince = useRef(0)
  usePerson(live, pointer, ({ person, shape, poses }) => {
    const current = picture.current
    if (!current) return
    current.pattern?.setPerson(person)
    current.silhouette?.setShape(shape)
    current.figures?.setPoses(poses)
    const head = current.head
    if (!head) return
    if (person) {
      presentSince.current ||= performance.now()
      const { yaw, pitch } = lookAngles(MIDDLE, person)
      head.setLook(yaw, pitch)
      head.setExpression(performance.now() - presentSince.current < 1500 ? 'curious' : 'happy')
      return
    }
    presentSince.current = 0
    // Nobody there: drift on the shared clock, so every screen's part of the head drifts alike.
    const t = serverNow() / 1000
    head.setLook(Math.sin(t * 0.21) * 0.35 + Math.sin(t * 0.067) * 0.2, Math.sin(t * 0.13) * 0.12 - 0.04)
    head.setExpression('neutral')
  })
}
