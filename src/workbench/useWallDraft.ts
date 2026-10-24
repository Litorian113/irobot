import { useEffect, useState } from 'react'
import { loadCustomWall, saveCustomWall } from '../customWall'
import { DEFAULT_WALL } from '../heads/catalog'
import { nextSlot, type WallLayout } from '../layout'
import type { Tone } from './ui'

/**
 * The wall being built in Gestalten: a draft of the saved Live-Wand, everything that can be
 * done to it, and whether it differs from what the iMacs show.
 */
export function useWallDraft() {
  const [layout, setLayout] = useState<WallLayout | null>(null)
  const [saved, setSaved] = useState<WallLayout | null>(null)
  const [status, setStatus] = useState('Lädt …')

  useEffect(() => {
    loadCustomWall().then(
      (result) => {
        setLayout(result.layout)
        setSaved(result.saved ? result.layout : null)
        setStatus(result.saved ? 'Läuft auf der Wand' : 'Noch nie gespeichert – Startpunkt ist die Hauptwand')
      },
      (error: unknown) => setStatus(`Fehler beim Laden: ${String(error)}`),
    )
  }, [])

  const dirty = layout !== null && JSON.stringify(layout) !== JSON.stringify(saved)
  const tone: Tone = dirty ? 'dirty' : status.startsWith('Fehler') ? 'error' : saved ? 'live' : null
  const update = (change: (current: WallLayout) => WallLayout) => setLayout((current) => current && change(current))
  const keyAt = (rows: WallLayout, slot: number) => rows.flat().find((cell) => cell.slot === slot)?.key ?? null

  return {
    layout,
    dirty,
    tone,
    status: dirty ? 'Nicht gespeichert' : status,
    /** Only a wall that was saved once can go back to it. */
    canDiscard: saved !== null,
    keyOf: (slot: number) => (layout ? keyAt(layout, slot) : null),
    assign: (slot: number, key: string | null) =>
      update((rows) => rows.map((row) => row.map((cell) => (cell.slot === slot ? { ...cell, key } : cell)))),
    swap: (a: number, b: number) => update((rows) => {
      const ka = keyAt(rows, a)
      const kb = keyAt(rows, b)
      return rows.map((row) => row.map((cell) => (cell.slot === a ? { ...cell, key: kb } : cell.slot === b ? { ...cell, key: ka } : cell)))
    }),
    addScreen: (rowIndex: number) =>
      update((rows) => rows.map((row, r) => (r === rowIndex ? [...row, { slot: nextSlot(rows), key: null }] : row))),
    removeScreen: (slot: number) => update((rows) => rows.map((row) => row.filter((cell) => cell.slot !== slot))),
    addRow: () => update((rows) => [...rows, []]),
    removeRow: (rowIndex: number) => update((rows) => rows.filter((_, r) => r !== rowIndex)),
    resetToMain: () => setLayout(structuredClone(DEFAULT_WALL)),
    discard: () => { if (saved) setLayout(saved) },
    save: async () => {
      if (!layout) return
      setStatus('Speichert …')
      try {
        await saveCustomWall(layout)
        setSaved(layout)
        setStatus('Gespeichert – die Wand lädt neu')
      } catch (error) {
        setStatus(`Fehler beim Speichern: ${error instanceof Error ? error.message : String(error)}`)
      }
    },
  }
}
