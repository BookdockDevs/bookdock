import { useRef, useState, type ReactNode } from 'react'

import { closestCenter, DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { arrayMove, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'

import { isValidTocRegex, type ResourceAvailability, type TocRulePattern, type TocRuleRes } from '@bookdock/shared'

import { useCreateTocRule, useUpdateTocRule } from '@/api/hooks/useTocRules'
import { Button } from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import SegmentedControl from '@/components/ui/SegmentedControl'
import Select from '@/components/ui/Select'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
import { useAuthStore } from '@/stores/auth.store'

import SettingsFormField from './SettingsFormField'
import TocPatternRow, { type TocPatternError } from './TocPatternRow'
import { settingsInputClass } from './settingsForm'

export type TocRuleFormMode = 'create' | 'edit-global' | 'edit-custom'
type TocRuleScope = 'book' | ResourceAvailability

interface PatternDraft {
  id: string
  regex: string
  replacement: string
  enabled: boolean
}

function toDrafts(patterns: readonly TocRulePattern[]): PatternDraft[] {
  return patterns.map((p, index) => ({
    id: `toc-pat-${index}-${Date.now()}`,
    regex: p.regex,
    replacement: p.replacement ?? '',
    enabled: p.enabled !== false,
  }))
}

interface TocRuleFormModalProps {
  mode: TocRuleFormMode
  rules: TocRuleRes[]
  initialRule?: TocRuleRes | null
  initialPatterns?: readonly TocRulePattern[] | null
  externalSaving?: boolean
  submitLabel?: string
  onClose: () => void
  onGlobalSaved?: (rule: TocRuleRes) => void
  onCustomSaved?: (patterns: TocRulePattern[]) => void
  renderTestSection?: (args: { validatePatterns: () => TocRulePattern[] | null; saving: boolean }) => ReactNode
}

export default function TocRuleFormModal({
  mode,
  rules,
  initialRule,
  initialPatterns,
  externalSaving = false,
  submitLabel,
  onClose,
  onGlobalSaved,
  onCustomSaved,
  renderTestSection,
}: TocRuleFormModalProps) {
  const _ = useTranslation()
  const user = useAuthStore((state) => state.user)
  const isOwner = user?.role === 'owner'
  const createRule = useCreateTocRule()
  const updateRule = useUpdateTocRule()
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const [scope, setScope] = useState<TocRuleScope>(
    mode === 'edit-custom'
      ? 'book'
      : mode === 'edit-global'
        ? (initialRule?.availability ?? 'user')
        : 'user',
  )
  const isBookOnly = mode === 'edit-custom' || (mode === 'create' && scope === 'book')
  const publishable = mode === 'create' || (mode === 'edit-global' && initialRule?.builtIn !== true)

  const [name, setName] = useState(mode === 'edit-global' ? (initialRule?.name ?? '') : '')
  const [nameError, setNameError] = useState(false)

  const defaultPatterns: readonly TocRulePattern[] =
    mode === 'edit-global' && initialRule?.patterns.length
      ? initialRule.patterns
      : mode === 'edit-custom' && initialPatterns?.length
        ? initialPatterns
        : [{ level: 1, regex: '', replacement: '', enabled: true }]

  const [drafts, setDrafts] = useState<PatternDraft[]>(() => toDrafts(defaultPatterns))
  const nextPatternId = useRef(drafts.length)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const patternInputRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const [errors, setErrors] = useState<TocPatternError[]>(() => drafts.map(() => null))
  const [formError, setFormError] = useState('')

  const saving = externalSaving || createRule.isPending || updateRule.isPending

  function setDraft(index: number, patch: Partial<Pick<PatternDraft, 'regex' | 'replacement' | 'enabled'>>) {
    setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)))
    setFormError('')
    if (patch.regex !== undefined) {
      setErrors((prev) => prev.map((e, i) => (i === index ? null : e)))
    }
  }

  function addPattern() {
    const id = `toc-pat-${nextPatternId.current++}-${Date.now()}`
    setDrafts((prev) => [...prev, { id, regex: '', replacement: '', enabled: true }])
    setErrors((prev) => [...prev, null])
    setFormError('')
  }

  function removePattern(index: number) {
    setDrafts((prev) => prev.filter((_, i) => i !== index))
    setErrors((prev) => prev.filter((_, i) => i !== index))
    setFormError('')
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    if (saving || !over || active.id === over.id) return
    const oldIndex = drafts.findIndex((d) => d.id === active.id)
    const newIndex = drafts.findIndex((d) => d.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    setDrafts((prev) => arrayMove(prev, oldIndex, newIndex))
    setErrors((prev) => arrayMove(prev, oldIndex, newIndex))
  }

  function handleImportRule(ruleId: string) {
    if (!ruleId) return
    const found = rules.find((r) => r.id === ruleId)
    if (found && found.patterns.length > 0) {
      setDrafts(toDrafts(found.patterns))
      setErrors(found.patterns.map(() => null))
      setFormError('')
    }
  }

  function validatePatterns(): TocRulePattern[] | null {
    if (drafts.length === 0) {
      setFormError(_('settings.tocRulesAtLeastOne'))
      return null
    }
    const newErrors = drafts.map((d) => {
      const trimmed = d.regex.trim()
      if (!trimmed) return 'required' as const
      if (!isValidTocRegex(trimmed)) return 'invalidRegex' as const
      return null
    })
    setErrors(newErrors)
    const firstErrIndex = newErrors.findIndex((e) => e !== null)
    if (firstErrIndex >= 0) {
      patternInputRefs.current[drafts[firstErrIndex]?.id ?? '']?.focus()
      return null
    }
    return drafts.map((d, index) => ({
      level: index + 1,
      regex: d.regex.trim(),
      replacement: d.replacement === '' ? null : d.replacement,
      enabled: d.enabled,
    }))
  }

  function handleSubmit() {
    if (saving) return

    if (!isBookOnly) {
      const emptyName = !name.trim()
      setNameError(emptyName)
      const patterns = validatePatterns()
      if (emptyName) {
        nameInputRef.current?.focus()
        return
      }
      if (!patterns) return

      const onError = (err: unknown) => {
        notify.error(getUserErrorNotification(err, 'settings.tocRuleOperationFailed'))
      }

      const availability: ResourceAvailability = scope === 'instance' ? 'instance' : 'user'

      if (mode === 'edit-global' && initialRule) {
        updateRule.mutate(
          {
            id: initialRule.id,
            body: {
              name: name.trim(),
              patterns,
              ...(publishable && isOwner ? { availability } : {}),
            },
          },
          {
            onSuccess: (res) => {
              notify.success({ key: 'toast.tocRuleSaved' })
              onGlobalSaved?.(res.data)
              onClose()
            },
            onError,
          },
        )
      } else {
        createRule.mutate(
          {
            name: name.trim(),
            patterns,
            ...(isOwner ? { availability } : {}),
          },
          {
            onSuccess: (res) => {
              notify.success({ key: 'toast.tocRuleSaved' })
              onGlobalSaved?.(res.data)
              onClose()
            },
            onError,
          },
        )
      }
      return
    }

    const patterns = validatePatterns()
    if (!patterns) return
    onCustomSaved?.(patterns)
  }

  const scopeOptions: Array<{ value: TocRuleScope; label: string }> =
    mode === 'create'
      ? isOwner
        ? [
            { value: 'book', label: _('library.tocRuleBookOnly') || '仅本书' },
            { value: 'user', label: _('settings.resourceScopeUser') || '仅自己' },
            { value: 'instance', label: _('settings.resourceScopeInstance') || '共享' },
          ]
        : [
            { value: 'book', label: _('library.tocRuleBookOnly') || '仅本书' },
            { value: 'user', label: _('library.tocRuleScopeGlobal') || '通用' },
          ]
      : mode === 'edit-global' && publishable && isOwner
        ? [
            { value: 'user', label: _('settings.resourceScopeUser') || '仅自己' },
            { value: 'instance', label: _('settings.resourceScopeInstance') || '共享' },
          ]
        : []

  const title =
    mode === 'create'
      ? (_('settings.tocRulesNew') || '新建目录规则')
      : (_('settings.tocRulesEdit') || '编辑目录规则')

  return (
    <Modal title={title} onClose={onClose} size="wide">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <div className="min-w-0 flex-1">
            <SettingsFormField
              label={_('settings.tocRulesName')}
              required={!isBookOnly}
              error={!isBookOnly && nameError ? _('settings.tocRulesNameRequired') : undefined}
            >
              <input
                ref={nameInputRef}
                type="text"
                autoFocus
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  setNameError(false)
                }}
                aria-invalid={(!isBookOnly && nameError) || undefined}
                disabled={saving}
                className={settingsInputClass}
              />
            </SettingsFormField>
          </div>
          {scopeOptions.length > 0 && (
            <fieldset className="shrink-0 space-y-1.5">
              <legend className="text-xs text-stone-500 dark:text-stone-400">{_('settings.resourceScope')}</legend>
              <SegmentedControl
                ariaLabel={_('settings.resourceScope')}
                size="md"
                pending={saving}
                value={scope}
                onChange={(nextScope) => {
                  setScope(nextScope)
                  setNameError(false)
                }}
                options={scopeOptions}
              />
            </fieldset>
          )}
        </div>

        {/* Pattern list */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-stone-700 dark:text-stone-200">
              {_('settings.tocRulesLevels') || '目录层级'}
            </span>
            <div className="flex items-center gap-2">
              {rules.length > 0 && (
                <Select
                  size="sm"
                  value=""
                  aria-label={_('library.tocRuleCopyTemplate') || '从现有规则复制'}
                  placeholder={_('library.tocRuleImportTemplate') || '导入规则'}
                  onValueChange={handleImportRule}
                  disabled={saving}
                  options={rules.map((rule) => ({ value: rule.id, label: rule.name }))}
                />
              )}
              <button
                type="button"
                onClick={addPattern}
                disabled={saving}
                aria-label={_('settings.tocRulesAddPattern') || '添加层级'}
                title={_('settings.tocRulesAddPattern') || '添加层级'}
                className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-xs font-medium text-stone-700 transition-colors hover:bg-stone-100 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-40 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-stone-100"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                <span>{_('settings.tocRulesAddPattern') || '添加层级'}</span>
              </button>
            </div>
          </div>

          {drafts.length === 0 ? (
            <p className="rounded-xl border border-dashed border-stone-200 py-6 text-center text-xs text-stone-400 dark:border-stone-700 dark:text-stone-500">
              {_('library.tocRuleLevelsEmpty')}
            </p>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={drafts.map((d) => d.id)} strategy={verticalListSortingStrategy}>
                <div className="flex flex-col gap-2">
                  {drafts.map((draft, index) => (
                    <TocPatternRow
                      key={draft.id}
                      id={draft.id}
                      level={index + 1}
                      regex={draft.regex}
                      replacement={draft.replacement}
                      enabled={draft.enabled}
                      disabled={saving}
                      canRemove
                      error={errors[index] ?? null}
                      onChange={(patch) => setDraft(index, patch)}
                      onRemove={() => removePattern(index)}
                      inputRef={(el) => {
                        patternInputRefs.current[draft.id] = el
                      }}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}

          {formError && (
            <div role="alert" className="rounded-lg bg-red-50 p-2.5 text-xs text-red-600 dark:bg-red-950/40 dark:text-red-400">
              {formError}
            </div>
          )}
        </div>

        {renderTestSection?.({ validatePatterns, saving })}

        <div className="flex items-center justify-end gap-2 border-t border-stone-100 pt-3 dark:border-stone-800">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {_('common.cancel') || '取消'}
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={saving}>
            {submitLabel ?? (_('library.tocRuleSaveAndApply') || '保存并应用')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
