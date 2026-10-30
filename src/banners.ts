/**
 * The HfG banners of a screen, category "Werbung" in the lists of Gestalten. Each is shown over its stand-in head
 * once someone has stood in front of the wall for a while (Promo.tsx). Its copy changes every few seconds.
 */
export interface Banner {
  /** Stored in a saved wall. */
  key: string
  name: string
  description: string
  /** The catalog key of the head it stands in front of. */
  standIn: string
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
    description: 'HfG-Logo und Spruch auf Weiß',
    standIn: 'main-11',
    look: 'plain',
    logo: 'Gmuend_logo.svg',
    idle: [['Hier schaut', 'Gestaltung zurück.']],
    seen: [['Ja, genau du.', 'Wir sehen dich.']],
  },
  {
    key: 'promo-halloween',
    name: 'Werbung Halloween',
    description: 'Dunkel, vor J.A.C.K.: Buh! und gruselige Design-Witze',
    standIn: 'main-13',
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
