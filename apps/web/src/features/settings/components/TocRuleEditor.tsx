import { useRef, useState } from 'react'

import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable'

import type { TocRulePattern, TocRuleRes } from '@bookdock/shared'

import { useCreateTocRule, useUpdateTocRule } from '@/api/hooks/useTocRules'
import Modal from '@/components/ui/Modal'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'

import TocPatternRow, { type TocPatternError } from './TocPatternRow'
import SettingsFormActions from './SettingsFormActions'
import SettingsFormField from './SettingsFormField'
import { settingsFormClass, settingsInputClass } from './settingsForm'

interface TocRuleEditorProps {
  /** Null = create mode */
  initial?: TocRuleRes | null
  onClose: () => void
}

interface PatternDraft {
  id: string
  regex: string
  replacement: string
  enabled: boolean
}

function toDrafts(patterns: TocRulePattern[]): Omit<PatternDraft, 'id'>[] {
  return patterns.map((p) => ({
    regex: p.regex,
    replacement: p.replacement ?? '',
    enabled: p.enabled,
  }))
}

export default function TocRuleEditor({ initial, onClose }: TocRuleEditorProps) {
  const _ = useTranslation()
  const createRule = useCreateTocRule()
  const updateRule = useUpdateTocRule()

  const editing = initial != null
  const [name, setName] = useState(initial?.name ?? '')
  const [nameError, setNameError] = useState(false)
  const initialPatterns = initial?.patterns ?? [{ level: 1, regex: '', replacement: '', enabled: true }]
  const [drafts, setDrafts] = useState<PatternDraft[]>(() => toDrafts(initialPatterns).map((draft, index) => ({ ...draft, id: `pattern-${index}` })))
  const nextPatternId = useRef(initialPatterns.length)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const patternInputRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const [errors, setErrors] = useState<TocPatternError[]>(drafts.map(() => null))
  const saving = createRule.isPending || updateRule.isPending
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  function setDraft(index: number, patch: Partial<Pick<PatternDraft, 'regex' | 'replacement'>>) {
    setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)))
    if (patch.regex !== undefined) {
      setErrors((prev) => prev.map((e, i) => (i === index ? null : e)))
    }
  }

  function addPattern() {
    const id = `pattern-${nextPatternId.current++}`
    setDrafts((prev) => [...prev, { id, regex: '', replacement: '', enabled: true }])
    setErrors((prev) => [...prev, null])
  }

  function removePattern(index: number) {
    if (drafts.length <= 1) return
    setDrafts((prev) => prev.filter((_, i) => i !== index))
    setErrors((prev) => prev.filter((_, i) => i !== index))
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    if (saving || !over || active.id === over.id) return
    const oldIndex = drafts.findIndex((draft) => draft.id === active.id)
    const newIndex = drafts.findIndex((draft) => draft.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    setDrafts((current) => arrayMove(current, oldIndex, newIndex))
    setErrors((current) => arrayMove(current, oldIndex, newIndex))
  }

  function onError(err: unknown) {
    notify.error(getUserErrorNotification(err))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const emptyName = !name.trim()
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
    setNameError(emptyName)
    setErrors(newErrors)
    if (emptyName || newErrors.some((e) => e)) {
      if (emptyName) nameInputRef.current?.focus()
      else {
        const firstErrorIndex = newErrors.findIndex((error) => error !== null)
        if (firstErrorIndex >= 0) patternInputRefs.current[drafts[firstErrorIndex]?.id ?? '']?.focus()
      }
      return
    }

    const patterns: TocRulePattern[] = drafts.map((d, index) => ({
      level: index + 1,
      regex: d.regex.trim(),
      replacement: d.replacement === '' ? null : d.replacement,
      enabled: d.enabled,
    }))

    const done = () => {
      notify.success({ key: 'toast.tocRuleSaved' })
      onClose()
    }
    if (editing) {
      updateRule.mutate({ id: initial.id, body: { name: name.trim(), enabled: initial.enabled, patterns } }, { onSuccess: done, onError })
    } else {
      createRule.mutate({ name: name.trim(), enabled: true, patterns }, { onSuccess: done, onError })
    }
  }

  return (
    <Modal title={editing ? _('settings.tocRulesEdit') : _('settings.tocRulesNew')} onClose={onClose} size="wide">
      <form onSubmit={handleSubmit} noValidate className={settingsFormClass}>
        <SettingsFormField label={_('settings.tocRulesName')} required error={nameError ? _('settings.tocRulesNameRequired') : undefined}>
          <input
            ref={nameInputRef}
            type="text"
            autoFocus
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setNameError(false)
            }}
            aria-invalid={nameError || undefined}
            disabled={saving}
            className={settingsInputClass}
          />
        </SettingsFormField>

        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-stone-700 dark:text-stone-200">{_('settings.tocRulesLevels')}</span>
          <button
            type="button"
            onClick={addPattern}
            disabled={saving}
            aria-label={_('settings.tocRulesAddPattern')}
            title={_('settings.tocRulesAddPattern')}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-stone-800 dark:hover:text-stone-200"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={drafts.map((draft) => draft.id)} strategy={verticalListSortingStrategy}>
            <div className="flex flex-col gap-2">
              {drafts.map((draft, index) => (
                <TocPatternRow
                  key={draft.id}
                  id={draft.id}
                  level={index + 1}
                  regex={draft.regex}
                  replacement={draft.replacement}
                  error={errors[index] ?? null}
                  disabled={saving}
                  canRemove={drafts.length > 1}
                  inputRef={(element) => { patternInputRefs.current[draft.id] = element }}
                  onChange={(patch) => setDraft(index, patch)}
                  onRemove={() => removePattern(index)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>

        <SettingsFormActions onCancel={onClose} cancelDisabled={saving} saveDisabled={saving} />
      </form>
    </Modal>
  )
}
