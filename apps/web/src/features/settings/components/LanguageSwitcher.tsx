import { useState } from 'react'

import SegmentedControl from '@/components/ui/SegmentedControl'
import { useTranslation } from '@/hooks/useTranslation'
import i18n from '@/i18n/i18n'

const LANG_OPTIONS = [
  { value: 'zh-CN', label: '中文', title: '简体中文' },
  { value: 'en', label: 'English', title: 'English' },
] as const

export default function LanguageSwitcher() {
  const _ = useTranslation()
  // i18n.language is not reactive on its own; mirror it so the control
  // re-renders after changeLanguage.
  const [lang, setLang] = useState(i18n.language)
  const currentLang = lang?.startsWith('en') ? 'en' : 'zh-CN'

  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="min-w-0">
        <p className="text-sm font-medium text-stone-700 dark:text-stone-200">{_('settings.language')}</p>
        <p className="mt-0.5 text-xs text-stone-400 dark:text-stone-500">{_('settings.languageHint')}</p>
      </div>
      <SegmentedControl
        ariaLabel={_('settings.language')}
        value={currentLang}
        onChange={(value) => {
          void i18n.changeLanguage(value)
          setLang(value)
        }}
        options={LANG_OPTIONS}
      />
    </div>
  )
}
