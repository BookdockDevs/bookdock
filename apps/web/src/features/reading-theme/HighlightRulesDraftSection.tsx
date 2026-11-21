import { type ReactNode, useState } from 'react'

import type { HighlightLineStyle, HighlightRuleDef, HighlightRuleLine, HighlightRuleStyle } from '@bookdock/shared'

import SmartMenu, { readerMenuItemClass } from '@/components/ui/SmartMenu'
import Toggle from '@/components/ui/Toggle'
import SettingsFormField from '@/features/settings/components/SettingsFormField'
import { settingsInputClass, settingsTextareaClass } from '@/features/settings/components/settingsForm'
import { useMenuAnchor } from '@/hooks/useMenuAnchor'
import { useTranslation } from '@/hooks/useTranslation'
import { HIGHLIGHT_LIMITS, highlightLineOf, ruleGroupCount } from '@/lib/highlight-match'
import { cn } from '@/lib/utils'

import ColorPickerPopover from './ColorPickerPopover'
import HighlightSamplePreview from './HighlightSamplePreview'
import ThemeIcon from './ThemeIcon'
import { createHighlightRuleId, highlightRuleIssue, highlightRulePreset, HIGHLIGHT_PRESET_SAMPLE_KEY, type HighlightPresetKind } from './draft'

export interface HighlightRulesDraftSectionProps {
  rules: HighlightRuleDef[]
  single?: boolean
  scopeControl?: ReactNode
  onChange: (rules: HighlightRuleDef[]) => void
}

const LINE_STYLES: HighlightLineStyle[] = ['solid', 'wavy', 'dashed']

function styleComplete(style: HighlightRuleStyle | undefined): boolean {
  return !!style && (style.textColor !== undefined || style.backgroundColor !== undefined || highlightLineOf(style) !== undefined)
}

// Same geometry as the selection toolbar's line glyphs (annotation-icons
// `StyleGlyph`): apex (12,5), feet at y 16.5, rule at y 20.
const A_GLYPH_PATH = 'M7.5 16.5 12 5l4.5 11.5M9 12.8h6'

function LineStyleGlyph({ kind, color, size = 20 }: { kind: HighlightLineStyle; color?: string; size?: number }) {
  const stroke = color ?? 'currentColor'
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path d={A_GLYPH_PATH} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      {kind === 'wavy' ? (
        <path d="M4 20q2 -2.2 4 0t4 0t4 0t4 0" fill="none" stroke={stroke} strokeWidth="2.4" strokeLinecap="round" />
      ) : (
        <path
          d="M4 20h16"
          fill="none"
          stroke={stroke}
          strokeWidth="2.4"
          // Butt caps on purpose: round caps fatten a 3.6-unit dash into a pill
          // and close the 2.4 gap, which is what turned this one into blobs.
          strokeLinecap={kind === 'dashed' ? 'butt' : 'round'}
          strokeDasharray={kind === 'dashed' ? '3.6 2.4' : undefined}
        />
      )}
    </svg>
  )
}

function cloneStyle(style: HighlightRuleStyle): HighlightRuleStyle {
  return { ...style, ...(style.line ? { line: { ...style.line } } : {}) }
}

function cloneRules(rules: HighlightRuleDef[]): HighlightRuleDef[] {
  return rules.map((rule) => ({
    ...rule,
    style: rule.style ? cloneStyle(rule.style) : undefined,
    groups: rule.groups?.map((group) => ({ ...group, style: cloneStyle(group.style) })),
  }))
}

interface ColorFieldProps {
  label: string
  value: string | undefined
  placeholder: string
  /** Shown inside the swatch while the field is empty. */
  emptyGlyph: ReactNode
  onOpenPicker: (anchorRect: DOMRect) => void
  onInput: (value: string) => void
  onClear: () => void
}

// One control for every color in a rule. Text, background and line used to be
// three near-identical blocks with their own quirks, which is what pushed the
// line into needing a "follow text color" chip and a remove link; sharing the
// markup makes an empty line color behave exactly like an empty text color.
function ColorField({ label, value, placeholder, emptyGlyph, onOpenPicker, onInput, onClear }: ColorFieldProps) {
  const _ = useTranslation()
  const filled = Boolean(value)
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-xs font-normal text-current/55">{label}</span>
      <div className="flex h-[42px] min-w-0 items-center gap-2 rounded-lg border border-stone-300/80 bg-transparent p-1.5 pr-2.5 transition-colors focus-within:border-stone-400 focus-within:bg-stone-500/5 focus-within:ring-1 focus-within:ring-stone-400/20 dark:border-stone-700/80">
        <button
          type="button"
          aria-label={label}
          title={label}
          onClick={(e) => onOpenPicker(e.currentTarget.getBoundingClientRect())}
          className="relative h-7 w-7 shrink-0 cursor-pointer overflow-hidden rounded-md border border-black/15 shadow-2xs transition-transform hover:scale-105 active:scale-95"
        >
          {filled ? (
            <span className="absolute inset-0" style={{ backgroundColor: value }} />
          ) : (
            <span className="absolute inset-0 flex items-center justify-center bg-stone-500/10 text-[11px] font-bold text-current/40">
              {emptyGlyph}
            </span>
          )}
        </button>
        <input
          value={value ?? ''}
          placeholder={placeholder}
          maxLength={9}
          aria-label={`${label} HEX`}
          spellCheck={false}
          className="w-full min-w-0 bg-transparent font-mono text-xs uppercase text-current outline-none placeholder:font-sans placeholder:text-current/40"
          onChange={(e) => onInput(e.target.value)}
        />
        {filled && (
          <button
            type="button"
            onClick={onClear}
            aria-label={`${label} ✕`}
            title={_('library.cancel')}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-current/40 hover:bg-current/10 hover:text-current transition-colors cursor-pointer"
          >
            <ThemeIcon name="close" size={11} />
          </button>
        )}
      </div>
    </div>
  )
}

interface RuleStyleEditorProps {
  style: HighlightRuleStyle | undefined
  onChange: (style: HighlightRuleStyle | undefined) => void
}

// Four independent fields: text color, background color, line style and line
// color. The line style row doubles as the on/off switch — picking the active
// style again clears the line — so nothing else has to explain how to remove it.
function RuleStyleEditor({ style, onChange }: RuleStyleEditorProps) {
  const _ = useTranslation()
  const [picker, setPicker] = useState<{
    key: 'textColor' | 'backgroundColor' | 'lineColor'
    anchorRect: DOMRect
  } | null>(null)

  const commit = (next: HighlightRuleStyle) => {
    onChange(next.textColor !== undefined || next.backgroundColor !== undefined || highlightLineOf(next) !== undefined
      ? next
      : undefined)
  }

  const setColor = (key: 'textColor' | 'backgroundColor', value: string) => {
    const trimmed = value.trim()
    if (!trimmed) {
      clearField(key)
      return
    }
    commit({ ...style, [key]: trimmed })
  }

  const clearField = (key: 'textColor' | 'backgroundColor') => {
    const next = { ...style }
    delete next[key]
    commit(next)
  }

  // Legacy rules stored `underline: true`; editing the line normalizes them to
  // the explicit shape so the old meaning (solid, text color) stays visible.
  const line = highlightLineOf(style)
  const lineDrawn = line !== undefined && line !== null
  // Narrowed for the rendered controls: a drawn line always has a style.
  const drawnLine: HighlightRuleLine = line ?? { style: 'solid' }
  const setLine = (next: HighlightRuleLine | undefined) => {
    const base = { ...style }
    delete base.underline
    delete base.line
    commit(next ? { ...base, line: next } : base)
  }
  // An empty line color is not a mode of its own, it just leaves the color to the
  // renderer's fallback (the text color), same way an empty text color leaves it
  // to the theme. Both are cleared with the field's ✕. Typing or picking a color
  // while no line is drawn starts a solid one: the field is independent of the
  // style row rather than gated on it.
  const setLineColor = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) {
      if (lineDrawn) setLine({ style: drawnLine.style })
      return
    }
    setLine({ ...drawnLine, color: trimmed })
  }

  const pickerValue = picker?.key === 'lineColor'
    ? (drawnLine.color ?? style?.textColor ?? '#8A8A8A')
    : picker?.key === 'textColor'
      ? (style?.textColor ?? '#8A8A8A')
      : (style?.backgroundColor ?? '#F5E3B8')

  return (
    <div className="grid grid-cols-1 gap-3 @[300px]:grid-cols-2 @[560px]:grid-cols-4">
      <ColorField
        label={_('reader.themeHighlightTextColor')}
        value={style?.textColor}
        placeholder={_('reader.themeHighlightColorDefault')}
        emptyGlyph="A"
        onOpenPicker={(anchorRect) => setPicker({ key: 'textColor', anchorRect })}
        onInput={(value) => setColor('textColor', value)}
        onClear={() => clearField('textColor')}
      />
      <ColorField
        label={_('reader.themeHighlightBg')}
        value={style?.backgroundColor}
        placeholder={_('reader.themeHighlightBgTransparent')}
        emptyGlyph="✕"
        onOpenPicker={(anchorRect) => setPicker({ key: 'backgroundColor', anchorRect })}
        onInput={(value) => setColor('backgroundColor', value)}
        onClear={() => clearField('backgroundColor')}
      />

      {/* Line style. The row is the switch: clicking the active style again
          clears the line, so there is no separate remove button. */}
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="text-xs font-medium text-current/80">{_('reader.themeHighlightLineStyle')}</span>
        <div className="flex h-[42px] min-w-0 items-center gap-1 rounded-lg border border-stone-300/70 bg-stone-500/5 p-1.5 dark:border-stone-700/80">
          {LINE_STYLES.map((kind) => {
            const active = lineDrawn && drawnLine.style === kind
            const styleLabel = _(
              kind === 'solid'
                ? 'reader.themeHighlightLineSolid'
                : kind === 'wavy'
                  ? 'reader.themeHighlightLineWavy'
                  : 'reader.themeHighlightLineDashed',
            )
            return (
              <button
                key={kind}
                type="button"
                aria-pressed={active}
                aria-label={styleLabel}
                title={styleLabel}
                onClick={() => setLine(active ? undefined : { ...drawnLine, style: kind })}
                className={cn(
                  'flex h-7 min-w-0 flex-1 items-center justify-center rounded-md transition-all cursor-pointer',
                  active
                    ? 'border border-stone-400/60 bg-stone-500/20 text-current shadow-2xs'
                    : 'border border-transparent text-current/60 hover:bg-stone-500/10 hover:text-current',
                )}
              >
                <LineStyleGlyph kind={kind} color={lineDrawn ? drawnLine.color : undefined} />
              </button>
            )
          })}
        </div>
      </div>

      <ColorField
        label={_('reader.themeHighlightLineColor')}
        value={lineDrawn ? drawnLine.color : undefined}
        placeholder={_('reader.themeHighlightColorDefault')}
        emptyGlyph={<LineStyleGlyph kind={drawnLine.style} size={14} />}
        onOpenPicker={(anchorRect) => setPicker({ key: 'lineColor', anchorRect })}
        onInput={setLineColor}
        onClear={() => setLine({ style: drawnLine.style })}
      />

      {picker && (
        <ColorPickerPopover
          value={pickerValue}
          anchorRect={picker.anchorRect}
          onClose={() => setPicker(null)}
          onChange={(newColor) => {
            if (picker.key === 'lineColor') {
              setLine({ ...drawnLine, color: newColor })
              return
            }
            setColor(picker.key, newColor)
          }}
        />
      )}
    </div>
  )
}

interface PresetDropdownProps {
  onSelect: (kind: HighlightPresetKind) => void
  label?: string
  disabled?: boolean
  compact?: boolean
  className?: string
}

const PRESET_OPTIONS: { kind: HighlightPresetKind; labelKey: string; hint: string }[] = [
  { kind: 'dialogue', labelKey: 'reader.themeHighlightPresetDialogue', hint: '「…」"…"' },
  { kind: 'book-title', labelKey: 'reader.themeHighlightPresetBookTitle', hint: '《…》' },
  { kind: 'bracket', labelKey: 'reader.themeHighlightPresetBracket', hint: '（…）【…】' },
  { kind: 'punctuation', labelKey: 'reader.themeHighlightPresetPunctuation', hint: '，。！？' },
]

function PresetDropdown({ onSelect, label, disabled, compact = false, className }: PresetDropdownProps) {
  const _ = useTranslation()
  const menu = useMenuAnchor()

  return (
    <div className={cn('relative inline-flex items-center', className)}>
      <button
        ref={menu.btnRef}
        type="button"
        disabled={disabled}
        onClick={(e) => menu.toggleFromButton(e, 'below')}
        aria-expanded={menu.open}
        aria-label={label ?? _('reader.themeHighlightPresetsLabel')}
        title={label ?? _('reader.themeHighlightPresetsLabel')}
        className={compact
          ? 'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-current/70 transition-colors hover:bg-stone-500/10 hover:text-current disabled:opacity-40 cursor-pointer'
          : 'inline-flex items-center gap-1 rounded-lg border border-stone-300/70 bg-stone-500/5 px-2 py-1 text-xs font-medium text-current/75 transition-colors hover:border-stone-400 hover:bg-stone-500/10 hover:text-current disabled:opacity-40 cursor-pointer'}
      >
        <span>{label ?? _('reader.themeHighlightPresetsLabel')}</span>
        <ThemeIcon name="down" size={11} className="opacity-60" />
      </button>

      {menu.open && (
        <SmartMenu
          triggerRef={menu.btnRef}
          innerRef={menu.menuRef}
          anchor={menu.anchor}
          size={{ width: 'auto', height: PRESET_OPTIONS.length * 32 + 8 }}
          minWidth={110}
          maxWidth={160}
          onClose={menu.close}
          variant="reader"
        >
          <div className="flex flex-col gap-0.5">
            {PRESET_OPTIONS.map(({ kind, labelKey, hint }) => (
              <button
                key={kind}
                type="button"
                onClick={() => {
                  onSelect(kind)
                  menu.close()
                }}
                className={readerMenuItemClass}
              >
                <span className="font-medium text-xs text-current">{_(labelKey)}</span>
                <span className="font-mono text-[11px] text-current/45">{hint}</span>
              </button>
            ))}
          </div>
        </SmartMenu>
      )}
    </div>
  )
}

export default function HighlightRulesDraftSection({ rules, single = false, scopeControl, onChange }: HighlightRulesDraftSectionProps) {
  const _ = useTranslation()
  const [editingId, setEditingId] = useState<string | null>(null)

  const update = (index: number, next: HighlightRuleDef) => {
    const rules_ = cloneRules(rules)
    rules_[index] = next
    onChange(rules_)
  }

  const move = (index: number, delta: number) => {
    const target = index + delta
    if (target < 0 || target >= rules.length) return
    const next = cloneRules(rules)
    const [rule] = next.splice(index, 1)
    next.splice(target, 0, rule!)
    onChange(next)
  }

  const duplicate = (index: number) => {
    const next = cloneRules(rules)
    const source = next[index]!
    const copy: HighlightRuleDef = {
      ...source,
      id: createHighlightRuleId(),
      name: `${source.name.slice(0, 48)} 2`,
      style: source.style ? cloneStyle(source.style) : undefined,
      groups: source.groups?.map((group) => ({ ...group, style: cloneStyle(group.style) })),
    }
    next.splice(index + 1, 0, copy)
    onChange(next)
    setEditingId(copy.id)
  }

  const remove = (index: number) => {
    onChange(cloneRules(rules).filter((_, i) => i !== index))
    if (rules[index]?.id === editingId) setEditingId(null)
  }

  const applyPreset = (kind: HighlightPresetKind, targetIndex?: number) => {
    const preset = highlightRulePreset(kind)
    preset.sampleText = _(HIGHLIGHT_PRESET_SAMPLE_KEY[kind])
    if (single && rules[0]) {
      preset.id = rules[0].id
      preset.sampleText = rules[0].sampleText ?? preset.sampleText
      onChange([preset])
      setEditingId(preset.id)
      return
    }
    if (targetIndex !== undefined && rules[targetIndex]) {
      preset.id = rules[targetIndex].id
      preset.sampleText = rules[targetIndex].sampleText ?? preset.sampleText
      const next = cloneRules(rules)
      next[targetIndex] = preset
      onChange(next)
      setEditingId(preset.id)
      return
    }
    onChange([...cloneRules(rules), preset])
    setEditingId(preset.id)
  }

  const addBlank = () => {
    const rule: HighlightRuleDef = {
      id: createHighlightRuleId(),
      name: _('reader.themeHighlightNewRule'),
      pattern: '',
      isRegex: false,
      enabled: true,
      style: { backgroundColor: '#F5E3B8' },
    }
    onChange([...cloneRules(rules), rule])
    setEditingId(rule.id)
  }

  const groupCount = (rule: HighlightRuleDef) => (rule.isRegex ? ruleGroupCount(rule) : 0)

  return (
    <div className="flex flex-col gap-3">
      {/* List header in multi-rule mode */}
      {!single && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-current/80">
            {_('reader.themeHighlightRulesTitle')}
          </span>
          <div className="flex items-center gap-2">
            <PresetDropdown onSelect={(kind) => applyPreset(kind)} />
            <button
              type="button"
              onClick={addBlank}
              className="inline-flex items-center gap-1 rounded-lg border border-stone-300/70 bg-stone-500/5 px-2.5 py-1 text-xs font-medium text-current/75 transition-colors hover:border-stone-400 hover:bg-stone-500/10 hover:text-current cursor-pointer"
            >
              <ThemeIcon name="plus" size={12} />
              <span>{_('reader.themeHighlightAdd')}</span>
            </button>
          </div>
        </div>
      )}

      {rules.length === 0 && (
        <p className="rounded-lg border border-dashed border-stone-300/60 p-4 text-center text-xs text-current/50 dark:border-stone-700/60">
          {_('reader.themeHighlightEmpty')}
        </p>
      )}

      <ul className="flex flex-col gap-2.5">
        {rules.map((rule, index) => {
          const issue = highlightRuleIssue(rule)
          const showError = issue === 'regex' || issue === 'group'
          const editing = single || editingId === rule.id
          const groups = rule.groups ?? []
          const count = groupCount(rule)
          const line = highlightLineOf(rule.style)
          const availableGroup = Array.from({ length: count }, (_, i) => i + 1).find(
            (index_) => !groups.some((group) => group.index === index_),
          )

          return (
            <li
              key={rule.id}
              className={
                single
                  ? 'flex flex-col gap-3.5'
                  : 'rounded-xl border border-stone-300/70 bg-stone-500/5 p-3 transition-colors dark:border-stone-700/80'
              }
            >
              {/* List item summary header (hidden in single card edit modal) */}
              {!single && (
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={rule.enabled}
                    onChange={(e) => update(index, { ...rule, enabled: e.target.checked })}
                    aria-label={rule.name}
                    className="accent-current cursor-pointer"
                  />
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-current">
                    {rule.name}
                  </span>
                  <span className="rounded bg-stone-500/10 px-1.5 py-0.5 text-[10px] text-current/60">
                    {rule.isRegex ? _('reader.themeHighlightRegex') : _('reader.themeHighlightLiteral')}
                  </span>
                  {styleComplete(rule.style) || groups.length > 0 ? (
                    <span className="flex items-center gap-1">
                      {rule.style?.textColor && (
                        <span
                          className="h-2.5 w-2.5 rounded-full border border-black/15 shadow-2xs"
                          style={{ backgroundColor: rule.style.textColor }}
                        />
                      )}
                      {rule.style?.backgroundColor && (
                        <span
                          className="h-2.5 w-2.5 rounded border border-black/15 shadow-2xs"
                          style={{ backgroundColor: rule.style.backgroundColor }}
                        />
                      )}
                      {line ? (
                        <span className="inline-flex items-center text-current/70" aria-hidden="true">
                          <LineStyleGlyph kind={line.style} color={line.color ?? rule.style?.textColor} size={13} />
                        </span>
                      ) : null}
                      {groups.length > 0 && (
                        <span className="text-[10px] text-current/60">
                          G{groups.map((group) => group.index).join('/')}
                        </span>
                      )}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setEditingId(editing ? null : rule.id)}
                    className="rounded px-1.5 py-0.5 text-xs text-current/70 hover:bg-stone-500/10 hover:text-current transition-colors cursor-pointer"
                  >
                    {editing ? _('reader.themeHighlightCollapse') : _('reader.themeHighlightEdit')}
                  </button>
                  <button
                    type="button"
                    onClick={() => duplicate(index)}
                    className="flex h-6 w-6 items-center justify-center rounded text-current/60 transition-colors hover:bg-stone-500/10 hover:text-current cursor-pointer"
                    title={_('reader.themeHighlightDuplicate')}
                  >
                    <ThemeIcon name="copy" size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    className="flex h-6 w-6 items-center justify-center rounded text-current/60 transition-colors hover:bg-stone-500/10 hover:text-current disabled:opacity-30 cursor-pointer"
                    title={_('reader.themeHighlightMoveUp')}
                  >
                    <ThemeIcon name="up" size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(index, 1)}
                    disabled={index === rules.length - 1}
                    className="flex h-6 w-6 items-center justify-center rounded text-current/60 transition-colors hover:bg-stone-500/10 hover:text-current disabled:opacity-30 cursor-pointer"
                    title={_('reader.themeHighlightMoveDown')}
                  >
                    <ThemeIcon name="down" size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(index)}
                    className="flex h-6 w-6 items-center justify-center rounded text-red-500 transition-colors hover:bg-red-500/10 cursor-pointer"
                    title={_('reader.themeHighlightDelete')}
                  >
                    <ThemeIcon name="close" size={12} />
                  </button>
                </div>
              )}

              {/* Editing form block */}
              {editing && (
                <div
                  className={
                    single
                      ? 'flex flex-col gap-3.5'
                      : 'mt-3 flex flex-col gap-3.5 border-t border-stone-200/60 pt-3 dark:border-stone-800/60'
                  }
                >
                  {/* Name field */}
                  <div className={single && scopeControl ? 'flex flex-col gap-3 sm:flex-row sm:items-end' : ''}>
                    <div className={single && scopeControl ? 'min-w-0 flex-1' : ''}>
                      <SettingsFormField
                        label={_('reader.themeHighlightName')}
                        labelExtra={
                          <PresetDropdown
                            compact={single}
                            onSelect={(kind) => applyPreset(kind, index)}
                          />
                        }
                      >
                        <input
                          type="text"
                          value={rule.name}
                          maxLength={50}
                          onChange={(e) => update(index, { ...rule, name: e.target.value })}
                          aria-label={_('reader.themeHighlightName')}
                          className={settingsInputClass}
                        />
                      </SettingsFormField>
                    </div>
                    {single && scopeControl}
                  </div>

                  {/* Pattern field with Regex toggle on the label row */}
                  <SettingsFormField
                    labelFor={`pattern-${rule.id}`}
                    label={_('settings.replacementsPattern')}
                    required
                    error={
                      showError
                        ? issue === 'regex'
                          ? _('reader.themeHighlightRegexInvalid')
                          : issue === 'group'
                            ? _('reader.themeHighlightGroupInvalid')
                            : _('reader.themeHighlightEmptyPattern')
                        : undefined
                    }
                    labelExtra={
                      <Toggle
                        label={_('settings.replacementsRegex')}
                        checked={rule.isRegex}
                        onChange={(val) =>
                          update(index, {
                            ...rule,
                            isRegex: val,
                            groups: val ? rule.groups : undefined,
                          })
                        }
                      />
                    }
                  >
                    <textarea
                      id={`pattern-${rule.id}`}
                      rows={2}
                      value={rule.pattern}
                      maxLength={HIGHLIGHT_LIMITS.maxPatternLength}
                      onChange={(e) => update(index, { ...rule, pattern: e.target.value })}
                      spellCheck={false}
                      aria-label={_('settings.replacementsPattern')}
                      aria-invalid={showError || undefined}
                      placeholder={rule.isRegex ? _('settings.replacementsRegexHint') : undefined}
                      className={settingsTextareaClass}
                    />
                    {rule.isRegex && count > 0 && (
                      <p className="mt-1.5 text-[11px] text-current/55">
                        {_('reader.themeHighlightGroupCount', { count })}
                      </p>
                    )}
                  </SettingsFormField>

                  {/* Whole match styling */}
                  <div className="flex flex-col gap-2 border-t border-current/10 pt-3.5 @container">
                    <span className="text-[13px] font-semibold text-current/90">
                      {_('reader.themeHighlightWholeMatch')}
                    </span>
                    <RuleStyleEditor
                      style={rule.style}
                      onChange={(style) => update(index, { ...rule, style })}
                    />
                  </div>

                  {/* Capture-group styles sit under the whole-match block as
                      siblings, not behind a disclosure: only groups the user
                      has styled render, and the pattern field already states how
                      many the regex has. */}
                  {rule.isRegex && (groups.length > 0 || availableGroup !== undefined) && (
                    <div className="flex flex-col gap-2">
                      {groups.map((group) => (
                        <div
                          key={group.index}
                          className="flex flex-col gap-1.5 rounded-lg border border-stone-200/60 bg-stone-500/5 p-2.5 dark:border-stone-800/60 @container"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-current">
                              {_('reader.themeHighlightGroup', { index: group.index })}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                update(index, {
                                  ...rule,
                                  groups: groups.filter((g) => g.index !== group.index),
                                })
                              }
                              className="flex h-5 w-5 items-center justify-center rounded text-current/40 hover:bg-current/10 hover:text-red-500 transition-colors cursor-pointer"
                            >
                              <ThemeIcon name="close" size={11} />
                            </button>
                          </div>
                          <RuleStyleEditor
                            style={group.style}
                            onChange={(style) =>
                              update(index, {
                                ...rule,
                                groups: groups.map((g) =>
                                  g.index === group.index ? { ...g, style: style ?? {} } : g,
                                ),
                              })
                            }
                          />
                        </div>
                      ))}
                      {availableGroup !== undefined && (
                        <button
                          type="button"
                          onClick={() =>
                            update(index, {
                              ...rule,
                              groups: [
                                ...groups,
                                { index: availableGroup, style: { textColor: '#B8860B' } },
                              ],
                            })
                          }
                          className="flex h-[38px] w-full items-center justify-center rounded-lg border border-dashed border-stone-300/70 text-xs font-medium text-current/60 transition-colors hover:border-stone-400 hover:bg-stone-500/5 hover:text-current dark:border-stone-700/70 cursor-pointer"
                        >
                          + {_('reader.themeHighlightAddGroup')}
                        </button>
                      )}
                    </div>
                  )}

                  <HighlightSamplePreview
                    rule={rule}
                    onChange={(sampleText) => update(index, { ...rule, sampleText: sampleText || undefined })}
                  />
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
