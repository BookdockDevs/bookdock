import { useState } from 'react'

import { cn } from '@/lib/utils'
import i18n from '@/i18n/i18n'
import { useTranslation } from '@/hooks/useTranslation'

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
        <p className="text-sm text-stone-700 dark:text-stone-200">{_('settings.language')}</p>
      </div>
      <div className="inline-flex items-center gap-0.5 rounded-lg bg-stone-100 p-0.5 dark:bg-stone-800" role="group" aria-label={_('settings.language')}>
        {LANG_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            title={opt.title}
            aria-pressed={currentLang === opt.value}
            onClick={() => {
              void i18n.changeLanguage(opt.value)
              setLang(opt.value)
            }}
            className={cn(
              'flex h-7 items-center justify-center rounded-md px-3 text-xs font-medium transition-all',
              currentLang === opt.value
                ? 'bg-white text-stone-900 shadow-sm dark:bg-stone-700 dark:text-stone-100'
                : 'text-stone-500 hover:text-stone-800 dark:hover:text-stone-200',
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}
