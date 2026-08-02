import { useCallback } from 'react'
import { useTranslation as useI18nTranslation } from 'react-i18next'

type TOptions = Record<string, string | number>

export function useTranslation() {
  const { t } = useI18nTranslation('translation')
  return useCallback((key: string, options?: TOptions) => t(key, { defaultValue: key, ...options }), [t])
}
