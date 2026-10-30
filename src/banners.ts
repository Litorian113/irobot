import type { WallLayout } from './layout'

/**
 * The HfG banners, category "Werbung" in the lists. A banner is an add-on to a screen: the screen's head keeps
 * running, and the banner fades in over it once someone has stood in front of the wall for a while (Promo.tsx).
 * Its copy changes every few seconds.
 */
export interface Banner {
  /** Stored in a saved wall. */
  key: string
  name: string
  description: string
  /** The head for a screen that has none yet: dropped on an empty screen, or a wall saved when banners replaced heads. */
  defaultHead: string
  /** CSS class of the look, in index.css. */
  look: 'plain' | 'halloween'
  /** In public/images. */
  logo: string
  /** Two lines each: while nobody is there, and while someone is. */
  idle: [string, string][]
  seen: [string, string][]
}

export const PROMO_BANNERS: Banner[] = [
  {
    key: 'promo',
    name: 'Werbung',
    description: 'HfG-Logo und Spruch auf Weiß, über dem Kopf des Bildschirms',
    defaultHead: 'main-11',
    look: 'plain',
    logo: 'Gmuend_logo.svg',
    idle: [['Hier schaut', 'Gestaltung zurück.']],
    seen: [['Ja, genau du.', 'Wir sehen dich.']],
  },
  {
    key: 'promo-halloween',
    name: 'Werbung Halloween',
    description: 'Dunkel, über dem Kopf des Bildschirms: Buh! und gruselige Design-Witze',
    defaultHead: 'main-13',
    look: 'halloween',
    logo: 'Gmuend_logo_dark.svg',
    idle: [['Hier spukt', 'Gestaltung.']],
    seen: [
      ['Buh!', 'Erschrocken?'],
      ['Das Gruseligste hier:', 'Comic Sans.'],
      ['Mein Albtraum:', 'schlechtes K ern ing.'],
      ['Keine Angst,', 'der will nur gestalten.'],
      ['Wir sehen dich.', 'Auch im Dunkeln.'],
      ['Süßes oder Saures?', 'Hauptsache gutes Layout.'],
    ],
  },
]

export const bannerOf = (key: string | null | undefined) => PROMO_BANNERS.find((banner) => banner.key === key) ?? null

/** A wall saved when a banner took a screen's place: now the banner lies over that screen's head. */
export function bannersAsAddOns(layout: WallLayout): WallLayout {
  return layout.map((row) => row.map((cell) => {
    const banner = bannerOf(cell.key)
    return banner ? { ...cell, key: banner.defaultHead, banner: banner.key } : cell
  }))
}
