import { useState } from 'react'
import type { HeadCategory } from '../heads/types'

/** null: all heads. Outlives the picker and a change of tab: choosing eight grisly heads should take one tap, not eight. */
let remembered: HeadCategory | null = null

export function useCategoryFilter() {
  const [category, setCategory] = useState(remembered)
  const choose = (next: HeadCategory | null) => {
    remembered = next
    setCategory(next)
  }
  return [category, choose] as const
}

export function inCategory(item: { categories: HeadCategory[] }, category: HeadCategory | null) {
  return category === null || item.categories.includes(category)
}
