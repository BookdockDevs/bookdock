import type { HiddenReason, HiddenVia } from '@bookdock/shared'

/** Private libraries file under shelves; shared libraries under categories. */
export type HiddenVocab = 'shelf' | 'category'

export interface HiddenCause {
  kind: 'category' | 'tag' | 'taxonomy'
  /** Short label for menus and icon buttons, e.g. 分类已隐藏. */
  shortKey: string
  /** Tooltip explaining where the hide lives. */
  hintKey: string
  hintParams?: Record<string, string>
}

/**
 * One taxonomy-hide verdict for every surface. A taxonomy-derived hide has no
 * work-level flag to clear, so menus and details must render it inert (same
 * icon, disabled, reason in the tooltip) instead of offering a toggle that
 * would write the wrong layer. Returns null for visible works and direct
 * hides, which keep their own toggle controls.
 */
export function getHiddenCause(
  item: {
    hidden?: boolean | null
    effectiveHidden?: boolean | null
    hiddenReason?: HiddenReason | null
    hiddenVia?: HiddenVia
  },
  vocab: HiddenVocab = 'category',
): HiddenCause | null {
  if (item.hidden || item.effectiveHidden !== true) return null
  if (item.hiddenReason === 'category' && item.hiddenVia?.categoryName) {
    return {
      kind: 'category',
      shortKey: vocab === 'shelf' ? 'library.shelfHiddenAction' : 'library.categoryHiddenAction',
      hintKey: vocab === 'shelf' ? 'library.shelfHiddenHint' : 'library.categoryHiddenHint',
      hintParams: { name: item.hiddenVia.categoryName },
    }
  }
  if (item.hiddenReason === 'tag' && item.hiddenVia?.tagNames?.length) {
    return {
      kind: 'tag',
      shortKey: 'library.tagHiddenAction',
      hintKey: 'library.tagHiddenHint',
      hintParams: { names: item.hiddenVia.tagNames.join('、') },
    }
  }
  return { kind: 'taxonomy', shortKey: 'library.taxonomyHiddenAction', hintKey: 'library.taxonomyHiddenHint' }
}
