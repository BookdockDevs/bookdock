import { createPortal } from 'react-dom'

import { useTranslation } from '@/hooks/useTranslation'
import { selectReadingTone, useUiStore } from '@/stores/ui.store'

import ThemeIcon from './ThemeIcon'

export default function ThemeTrialBar({ onBack }: { onBack: () => void }) {
  const _ = useTranslation()
  const tone = useUiStore(selectReadingTone)
  return createPortal(
    <div
      data-theme-trial-bar=""
      data-settings-toggle=""
      className={`${tone} fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom))] left-1/2 z-[71] flex -translate-x-1/2 items-center gap-3 rounded-full border border-current/12 bg-[var(--bd-read-page-bg)] py-1.5 pl-4 pr-1.5 text-sm text-[var(--bd-read-text)] shadow-lg`}
    >
      <ThemeIcon name="preview" />
      <span className="whitespace-nowrap">{_('reader.themeTrialing')}</span>
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-current/10 px-3 py-1.5 text-xs hover:bg-current/15">
        <ThemeIcon name="edit" size={13} />{_('reader.themeBackToEditing')}
      </button>
    </div>,
    document.body,
  )
}
