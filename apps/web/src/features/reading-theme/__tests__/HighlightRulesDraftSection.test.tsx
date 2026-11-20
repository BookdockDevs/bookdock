import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, cleanup } from '@testing-library/react'
import i18n from '@/i18n/i18n'
import type { HighlightRuleDef } from '@bookdock/shared'

import { computeHighlightSegments } from '@/lib/highlight-match'

import HighlightRulesDraftSection from '../HighlightRulesDraftSection'
import { INITIAL_THEME_LIBRARY, readThemeLibrary, serializeThemeLibrary } from '../theme-library'

const dialogueRule: HighlightRuleDef = { id: 'r1', name: '对白', pattern: '「[^」]*」', isRegex: true, enabled: true, style: { backgroundColor: '#F5E3B8' } }

function renderSection(rules: HighlightRuleDef[], onChange = vi.fn()) {
  render(<HighlightRulesDraftSection rules={rules} onChange={onChange} />)
  return onChange
}

/** Single-rule editor that keeps its own draft, so toggles can be clicked twice. */
function StatefulSection({ initial, onRules }: { initial: HighlightRuleDef[]; onRules?: (rules: HighlightRuleDef[]) => void }) {
  const [rules, setRules] = useState(initial)
  return (
    <HighlightRulesDraftSection
      rules={rules}
      single
      onChange={(next) => {
        setRules(next)
        onRules?.(next)
      }}
    />
  )
}

describe('HighlightRulesDraftSection', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
  })

  afterEach(cleanup)

  it('inserts the dialogue preset as an editable rule', () => {
    const onChange = renderSection([])
    fireEvent.click(screen.getByRole('button', { name: '快速模板' }))
    fireEvent.click(screen.getByRole('button', { name: /对白/ }))
    expect(onChange).toHaveBeenCalledTimes(1)
    const rules = onChange.mock.calls[0]![0] as HighlightRuleDef[]
    expect(rules).toHaveLength(1)
    expect(rules[0]).toMatchObject({ name: '对白', pattern: '「[^」]*」|『[^』]*』|“[^”]*”', isRegex: true, enabled: true, style: { textColor: '#A86911' } })
  })

  it('gives every template a demo line its own pattern matches, in both languages', async () => {
    const buttons: Record<string, { trigger: string; labels: string[] }> = {
      'zh-CN': { trigger: '快速模板', labels: ['对白', '书名号', '括号', '标点'] },
      en: { trigger: 'Templates', labels: ['Dialogue', 'Book-title marks', 'Brackets', 'Punctuation'] },
    }
    for (const [language, { trigger, labels }] of Object.entries(buttons)) {
      await i18n.changeLanguage(language)
      for (const label of labels) {
        const onChange = vi.fn()
        const { unmount } = render(<HighlightRulesDraftSection rules={[]} onChange={onChange} />)
        fireEvent.click(screen.getByRole('button', { name: trigger }))
        fireEvent.click(screen.getByRole('button', { name: new RegExp(label) }))
        const rule = (onChange.mock.calls[0]![0] as HighlightRuleDef[])[0]!
        expect(rule.sampleText).toBeTruthy()
        // The point of the sample is to show the pattern working, so it has to
        // hit at least once under that same rule — in either language.
        expect(computeHighlightSegments(rule.sampleText!, [rule]).length).toBeGreaterThan(0)
        unmount()
      }
    }
  })

  it('moves a rule up and down without changing identity', () => {
    const rules = [dialogueRule, { ...dialogueRule, id: 'r2', name: '书名号' }]
    const onChange = renderSection(rules)
    const downButtons = screen.getAllByTitle('下移')
    fireEvent.click(downButtons[0]!)
    const moved = onChange.mock.calls[0]![0] as HighlightRuleDef[]
    expect(moved.map((rule) => rule.id)).toEqual(['r2', 'r1'])
  })

  it('opens the replacement template in the single-rule editor', () => {
    function Editor() {
      const [rules, setRules] = useState([{ ...dialogueRule, sampleText: '《三体》' }] as HighlightRuleDef[])
      return <HighlightRulesDraftSection rules={rules} onChange={setRules} single />
    }
    render(<Editor />)
    fireEvent.click(screen.getByRole('button', { name: '快速模板' }))
    fireEvent.click(screen.getByRole('button', { name: /书名号/ }))
    expect(screen.getByLabelText('匹配内容')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '高亮预览' })).toHaveValue('《三体》')
  })

  it('starts empty, previews typed text in place, and restores only the saved sample', () => {
    function Editor({ initial, save }: { initial: HighlightRuleDef; save: (rule: HighlightRuleDef) => void }) {
      const [rules, setRules] = useState([initial])
      return <>
        <HighlightRulesDraftSection rules={rules} onChange={setRules} single />
        <button onClick={() => save(rules[0]!)}>保存</button>
      </>
    }
    const save = vi.fn<(rule: HighlightRuleDef) => void>()
    const initial = { ...dialogueRule, isRegex: false, pattern: '三体' }
    const editor = render(<Editor initial={initial} save={save} />)
    const input = screen.getByRole('textbox', { name: '高亮预览' })
    expect(input).toHaveValue('')
    fireEvent.change(input, { target: { value: '我在读《三体》。\n这一行没有命中。' } })
    expect(screen.getByText('三体', { selector: 'span' })).toHaveStyle({ backgroundColor: '#F5E3B8' })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    const library = readThemeLibrary(serializeThemeLibrary({ ...INITIAL_THEME_LIBRARY, highlights: [save.mock.calls[0]![0]] }))
    editor.unmount()
    render(<Editor initial={library!.highlights[0]!} save={save} />)
    expect(screen.getByRole('textbox', { name: '高亮预览' })).toHaveValue('我在读《三体》。\n这一行没有命中。')
    fireEvent.change(screen.getByRole('textbox', { name: '高亮预览' }), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(save.mock.calls[1]![0].sampleText).toBeUndefined()
  })

  it('inserts a book title preset that colors punctuation and title independently inside dialogue', () => {
    const onChange = renderSection([dialogueRule])
    fireEvent.click(screen.getByRole('button', { name: '快速模板' }))
    fireEvent.click(screen.getByRole('button', { name: /书名号/ }))
    const rules = onChange.mock.calls[0]![0] as HighlightRuleDef[]
    const text = '「我在读《三体》。」'
    expect(computeHighlightSegments(text, rules).map(({ start, end, textColor, backgroundColor }) =>
      [text.slice(start, end), textColor, backgroundColor],
    )).toEqual([
      ['「我在读', undefined, '#F5E3B8'],
      ['《', '#6B7280', '#F5E3B8'],
      ['三体', '#3B8282', '#F5E3B8'],
      ['》', '#6B7280', '#F5E3B8'],
      ['。」', undefined, '#F5E3B8'],
    ])
  })

  it('duplicates a rule with a fresh id', () => {
    const onChange = renderSection([dialogueRule])
    fireEvent.click(screen.getAllByTitle('复制规则')[0]!)
    const copied = onChange.mock.calls[0]![0] as HighlightRuleDef[]
    expect(copied).toHaveLength(2)
    expect(copied[1]!.id).not.toBe(dialogueRule.id)
    expect(copied[1]!.name).toBe('对白 2')
  })

  it('shows a located error for an invalid regex and keeps the draft', () => {
    renderSection([{ ...dialogueRule, pattern: '[bad' }])
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    expect(screen.getByRole('alert')).toHaveTextContent('正则表达式无效，已保留草稿')
    expect(screen.getByLabelText('匹配内容')).toHaveValue('[bad')
  })

  it('flags a group style beyond the regex group count', () => {
    renderSection([{ ...dialogueRule, groups: [{ index: 3, style: { textColor: '#111111' } }] }])
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    expect(screen.getByRole('alert')).toHaveTextContent('捕获组编号超出该正则的分组数')
  })

  it('toggles a rule without touching the others', () => {
    const other = { ...dialogueRule, id: 'r2', name: '书名号' }
    const onChange = renderSection([dialogueRule, other])
    fireEvent.click(screen.getByRole('checkbox', { name: '对白' }))
    const toggled = onChange.mock.calls[0]![0] as HighlightRuleDef[]
    expect(toggled[0]!.enabled).toBe(false)
    expect(toggled[1]!.enabled).toBe(true)
    expect(toggled[1]!.id).toBe('r2')
  })

  it('reports the regex group count under the pattern field', () => {
    renderSection([{ ...dialogueRule, pattern: '「([^」]*)」', groups: [{ index: 1, style: { textColor: '#B8860B' } }] }])
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    expect(screen.getByText('共 1 个捕获组')).toBeInTheDocument()
    // Group styles are listed straight away — no disclosure to open first.
    expect(screen.getByText('组 1')).toBeInTheDocument()
  })

  it('presents text, background, line style and line color as four separate fields', () => {
    render(<StatefulSection initial={[dialogueRule]} />)
    for (const label of ['匹配样式', '文字颜色', '背景颜色', '线条样式', '线条颜色']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: '移除线条' })).toBeNull()
    expect(screen.queryByText('跟字色')).toBeNull()
  })

  it('clears the line by clicking the active style again', () => {
    const onRules = vi.fn()
    render(<StatefulSection initial={[dialogueRule]} onRules={onRules} />)
    const wavy = screen.getByRole('button', { name: '波浪线' })

    fireEvent.click(wavy)
    expect(wavy).toHaveAttribute('aria-pressed', 'true')
    expect(onRules.mock.calls.at(-1)![0][0].style.line).toEqual({ style: 'wavy' })

    fireEvent.click(wavy)
    expect(wavy).toHaveAttribute('aria-pressed', 'false')
    expect(onRules.mock.calls.at(-1)![0][0].style.line).toBeUndefined()
  })

  it('edits the line color independently of the style row and clears only the color', () => {
    const onRules = vi.fn()
    render(<StatefulSection initial={[dialogueRule]} onRules={onRules} />)

    const input = screen.getByLabelText('线条颜色 HEX')
    expect(input).toBeEnabled()
    expect(input).toHaveValue('')

    fireEvent.change(input, { target: { value: '#ff0000' } })
    // A color with no line yet starts a solid one instead of being rejected.
    expect(onRules.mock.calls.at(-1)![0][0].style.line).toEqual({ style: 'solid', color: '#ff0000' })

    fireEvent.click(screen.getByRole('button', { name: '线条颜色 ✕' }))
    // Clearing the color keeps the line itself, it only drops the explicit color.
    expect(onRules.mock.calls.at(-1)![0][0].style.line).toEqual({ style: 'solid' })
  })
})
