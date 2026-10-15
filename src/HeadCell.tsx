import { useEffect, useRef, useState } from 'react'
import { ParticleFace } from './viki/ParticleFace'
import { subscribe, type GazeMessage } from './tracking/bus'
import { lookAngles, slotPosition } from './tracking/gaze'
import { SETTINGS, type SlotPreset } from './wall'

/** Gaze messages older than this mean the camera window is gone. */
const STALE_MS = 2000
/** First they notice you (brows up), then they smile. */
const NOTICE_MS = 1500

const heads = new Map<number, ParticleFace>()
;(window as unknown as { __heads?: () => unknown }).__heads = () =>
  Object.fromEntries([...heads].map(([slot, face]) => [slot, face.debug()]))

export default function HeadCell({ slot, preset }: { slot: number; preset: SlotPreset }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [stats, setStats] = useState<string | null>(null)

  useEffect(() => {
    if (!canvasRef.current) return
    let face: ParticleFace
    try {
      face = new ParticleFace(canvasRef.current, {
        style: preset.style,
        config: preset.config,
        fps: SETTINGS.fps,
        maxPixelRatio: SETTINGS.wall ? 1 : 1.5,
        stiffness: preset.stiffness,
        delay: preset.delay,
      })
    } catch (error) {
      console.warn(`[head ${slot}] WebGL unavailable`, error)
      return
    }
    heads.set(slot, face)
    const position = slotPosition(slot, SETTINGS.spacing)
    const started = performance.now()
    let latest: GazeMessage | null = null
    let receivedAt = 0
    let presentSince = 0
    const off = subscribe((message) => {
      latest = message
      receivedAt = performance.now()
    })

    const steer = () => {
      const now = performance.now()
      const message = latest && now - receivedAt < STALE_MS ? latest : null
      if (message?.present && message.person) {
        presentSince ||= now
        const { yaw, pitch } = lookAngles(position, message.person)
        face.setLook(yaw, pitch)
        face.setExpression(now - presentSince < NOTICE_MS ? 'curious' : 'happy')
        return
      }
      presentSince = 0
      // Nobody there: each head drifts on its own slow rhythm.
      const t = (now - started) / 1000 + slot * 7.3
      face.setLook(Math.sin(t * 0.21) * 0.35 + Math.sin(t * 0.067) * 0.2, Math.sin(t * 0.13) * 0.12 - 0.04)
      face.setExpression('neutral')
    }
    const timer = window.setInterval(steer, 1000 / 15)
    steer()
    const statsTimer = SETTINGS.stats ? window.setInterval(() => {
      const info = face.debug()
      setStats(`WebGL ${info.webgl} · ${info.renderedFps} fps`)
    }, 1000) : 0

    return () => {
      window.clearInterval(timer)
      window.clearInterval(statsTimer)
      off()
      heads.delete(slot)
      face.dispose()
    }
  }, [slot, preset])

  return (
    <div className="cell">
      <canvas ref={canvasRef} />
      {stats && <span className="cell-stats">{stats}</span>}
    </div>
  )
}
