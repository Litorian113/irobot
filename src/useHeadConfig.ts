import { useCallback, useEffect, useState, type RefObject } from 'react'
import type { ParticleFace } from './viki/ParticleFace'
import {
  clearConfig,
  loadConfig,
  loadStyle,
  saveConfig,
  saveStyle,
  STYLE_DEFAULTS,
  STYLES,
  type HeadConfig,
  type HeadStyle,
} from './viki/config'

/** Dev aid: `?style=viki` (or lattice / dust) opens that tab. */
const STYLE_PARAM = new URLSearchParams(window.location.search).get('style') as HeadStyle | null

export function initialStyle(): HeadStyle {
  return STYLE_PARAM && STYLES.some((s) => s.id === STYLE_PARAM) ? STYLE_PARAM : loadStyle()
}

/** Per-style configuration: saved config, live draft, and the configurator panel state. */
export function useHeadConfig(faceRef: RefObject<ParticleFace | null>) {
  const [style, setStyle] = useState<HeadStyle>(initialStyle)
  const [config, setConfig] = useState<HeadConfig>(() => loadConfig(initialStyle()))
  const [draft, setDraft] = useState<HeadConfig>(config)
  const [configOpen, setConfigOpen] = useState(false)
  const dirty = JSON.stringify(draft) !== JSON.stringify(config)

  // Switch tabs: load that head's saved config and make it the current one
  const chooseStyle = useCallback((next: HeadStyle) => {
    const cfg = loadConfig(next)
    setStyle(next)
    setConfig(cfg)
    setDraft(cfg)
    saveStyle(next)
    faceRef.current?.setStyle(next)
    faceRef.current?.applyConfig(cfg)
  }, [faceRef])

  const openConfig = useCallback(() => {
    setDraft(config)
    setConfigOpen(true)
  }, [config])

  const closeConfig = useCallback(() => {
    setDraft(config) // discard unsaved changes
    setConfigOpen(false)
  }, [config])

  const saveDraft = useCallback(() => {
    setConfig(draft)
    saveConfig(style, draft)
  }, [draft, style])

  const resetConfig = useCallback(() => {
    clearConfig(style)
    const cfg = { ...STYLE_DEFAULTS[style] }
    setConfig(cfg)
    setDraft(cfg)
    faceRef.current?.resetView()
  }, [style, faceRef])

  // Live preview of the draft (the speech delay is applied by the caller)
  useEffect(() => {
    faceRef.current?.applyConfig(draft)
  }, [draft, faceRef])

  return { style, draft, setDraft, configOpen, dirty, chooseStyle, openConfig, closeConfig, saveDraft, resetConfig }
}
