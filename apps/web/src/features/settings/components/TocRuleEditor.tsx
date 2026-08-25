import { useState } from 'react'

import type { TocRulePattern, TocRuleRes } from '@bookdock/shared'

import { useCreateTocRule, useUpdateTocRule } from '@/api/hooks/useTocRules'
import { Button } from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import Toggle from '@/components/ui/Toggle'
import { useTranslation } from '@/hooks/useTranslation'
import { useToastStore } from '@/stores/toast.store'
import { cn } from '@/lib/utils'

interface TocRuleEditorProps {
  /** Null = create mode */
  initial?: TocRuleRes | null
  onClose: () => void
}

interface PatternDraft {
  level: number
  regex: string
  replacement: string
  enabled: boolean
}

type PatternError = 'required' | 'invalidRegex' | null

function toDrafts(patterns: TocRulePattern[]): PatternDraft[] {
  return patterns.map((p) => ({
    level: p.level,
    regex: p.regex,
    replacement: p.replacement ?? '',
    enabled: p.enabled,
  }))
}

export default function TocRuleEditor({ initial, onClose }: TocRuleEditorProps) {
  const _ = useTranslation()
  const addToast = useToastStore((s) => s.addToast)
  const createRule = useCreateTocRule()
  const updateRule = useUpdateTocRule()

  const editing = initial != null
  const [name, setName] = useState(initial?.name ?? '')
  const [enabled, setEnabled] = useState(initial?.enabled ?? true)
  const [drafts, setDrafts] = useState<PatternDraft[]>(() => toDrafts(initial?.patterns ?? [{ level: 1, regex: '', replacement: '', enabled: true }]))
  const [errors, setErrors] = useState<PatternError[]>(drafts.map(() => null))
  const saving = createRule.isPending || updateRule.isPending

  function setDraft(index: number, patch: Partial<PatternDraft>) {
    setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)))
    if (patch.regex !== undefined) {
      setErrors((prev) => prev.map((e, i) => (i === index ? null : e)))
    }
  }

  function addPattern() {
    const nextLevel = drafts.length === 0 ? 1 : drafts[drafts.length - 1].level + 1
    setDrafts((prev) => [...prev, { level: nextLevel, regex: '', replacement: '', enabled: true }])
    setErrors((prev) => [...prev, null])
  }

  function removePattern(index: number) {
    setDrafts((prev) => prev.filter((_, i) => i !== index))
    setErrors((prev) => prev.filter((_, i) => i !== index))
  }

  function onError(err: Error) {
    addToast(err.message, 'error')
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const newErrors = drafts.map((d) => {
      const trimmed = d.regex.trim()
      if (!trimmed) return 'required' as const
      try {
        new RegExp(trimmed)
      } catch {
        return 'invalidRegex' as const
      }
      return null
    })
    setErrors(newErrors)
    if (newErrors.some((e) => e)) return

    const patterns: TocRulePattern[] = drafts.map((d) => ({
      level: d.level,
      regex: d.regex.trim(),
      replacement: d.replacement === '' ? null : d.replacement,
      enabled: d.enabled,
    }))

    const done = () => {
      addToast(_('toast.tocRuleSaved'), 'success')
      onClose()
    }
    if (editing) {
      updateRule.mutate({ id: initial.id, body: { name: name.trim(), enabled, patterns } }, { onSuccess: done, onError })
    } else {
      createRule.mutate({ name: name.trim(), enabled, patterns }, { onSuccess: done, onError })
    }
  }

  return (
    <Modal title={editing ? _('settings.tocRulesEdit') : _('settings.tocRulesNew')} onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4">
          <label className="block min-w-0">
            <span className="mb-1 block text-xs text-stone-400 dark:text-stone-500">{_('settings.tocRulesName')}</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={_('settings.tocRulesNamePlaceholder')}
              className={inputClass}
            />
          </label>
        </div>

        <p className="text-xs text-stone-400 dark:text-stone-500">{_('settings.tocRulesLevelHint')}</p>

        <div className="flex flex-col gap-2">
          {drafts.map((d, index) => (
            <div key={index} className="flex flex-col gap-2 rounded-lg border border-stone-200 p-3 dark:border-stone-700">
              <div className="flex items-center gap-2">
                <label className="flex shrink-0 items-center gap-1.5">
                  <span className="text-xs text-stone-400 dark:text-stone-500">{_('settings.tocRulesLevel')}</span>
                  <input
                    type="number"
                    min={1}
                    value={d.level}
                    onChange={(e) => setDraft(index, { level: Math.max(1, Number(e.target.value)) })}
                    className="h-8 w-16 rounded-lg border border-stone-200 bg-white px-2 text-sm text-stone-700 outline-none focus:border-stone-400 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => removePattern(index)}
                  title={_('settings.tocRulesRemovePattern')}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/40"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div>
                <label className="block">
                  <span className="mb-1 block text-xs text-stone-400 dark:text-stone-500">
                    {_('settings.tocRulesRegex')}
                    <span className="text-red-500"> *</span>
                  </span>
                  <input
                    type="text"
                    value={d.regex}
                    onChange={(e) => setDraft(index, { regex: e.target.value })}
                    className={cn(inputClass, 'font-mono')}
                  />
                </label>
                {errors[index] === 'required' && (
                  <p className="mt-1 text-xs text-red-500">{_('settings.tocRulesPatternRequired')}</p>
                )}
                {errors[index] === 'invalidRegex' && (
                  <p className="mt-1 text-xs text-red-500">{_('settings.tocRulesRegexInvalid')}</p>
                )}
              </div>
              <label className="block">
                <span className="mb-1 block text-xs text-stone-400 dark:text-stone-500">{_('settings.tocRulesReplacement')}</span>
                <input
                  type="text"
                  value={d.replacement}
                  onChange={(e) => setDraft(index, { replacement: e.target.value })}
                  placeholder={_('settings.tocRulesReplacementPlaceholder')}
                  className={inputClass}
                />
              </label>
            </div>
          ))}
        </div>

        <Button type="button" variant="secondary" size="sm" onClick={addPattern} className="self-start">
          {_('settings.tocRulesAddPattern')}
        </Button>

        <p className="text-xs text-amber-600 dark:text-amber-400">{_('settings.tocRulesLookbehindHint')}</p>

        <div className="flex items-center justify-between">
          <Toggle label={_('settings.tocRulesEnabled')} checked={enabled} onChange={setEnabled} />
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={saving}>
            {_('library.cancel')}
          </Button>
          <Button type="submit" size="sm" disabled={saving}>
            {_('library.save')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

const inputClass = 'h-9 w-full rounded-lg border border-stone-200 bg-white px-2.5 text-sm text-stone-700 outline-none transition-colors placeholder:text-stone-400 focus:border-stone-400 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:focus:border-stone-500'
