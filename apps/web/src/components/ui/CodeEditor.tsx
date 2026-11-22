import { forwardRef, useCallback, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import CodeMirror, { EditorState, EditorView, type ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { css } from '@codemirror/lang-css'
import { xml } from '@codemirror/lang-xml'
import { linter, type Diagnostic } from '@codemirror/lint'
import { githubLightInit, githubDarkInit } from '@uiw/codemirror-theme-github'

import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'
import { selectReadingTone, useUiStore } from '@/stores/ui.store'

export interface CodeIssue {
  line: number
  message: string
}

export interface CodeEditorHandle {
  insertText: (text: string) => void
  focus: () => void
  getSelection: () => { from: number; to: number } | null
  getEditorView: () => EditorView | undefined
}

export interface CodeEditorProps {
  value: string
  onChange: (value: string) => void
  language?: string
  label?: string
  ariaLabel?: string
  placeholder?: string
  readOnly?: boolean
  height?: string
  minHeight?: string
  maxHeight?: string
  issues?: CodeIssue[]
  extraHeaderActions?: ReactNode
  className?: string
}

const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(function CodeEditor(
  {
    value,
    onChange,
    language = 'css',
    label,
    ariaLabel,
    placeholder,
    readOnly = false,
    height = '100%',
    minHeight = '280px',
    maxHeight,
    issues = [],
    extraHeaderActions,
    className,
  },
  ref,
) {
  const _ = useTranslation()
  const textareaId = useId()
  const cmRef = useRef<ReactCodeMirrorRef>(null)
  const hasInteractedRef = useRef(false)
  const [copied, setCopied] = useState(false)
  const [showIssuesDrawer, setShowIssuesDrawer] = useState(false)

  useImperativeHandle(
    ref,
    () => ({
      insertText(text: string) {
        const view = cmRef.current?.view
        if (!view) {
          const trimmed = value.trimEnd()
          onChange(trimmed ? `${trimmed}\n\n${text}\n` : `${text}\n`)
          return
        }
        const doc = view.state.doc
        const sel = view.state.selection.main
        const atStartWithoutInteraction =
          !hasInteractedRef.current && sel.from === 0 && sel.to === 0 && doc.length > 0
        if (atStartWithoutInteraction) {
          const end = doc.length
          const prevChar = doc.sliceString(Math.max(0, end - 1))
          const insertion = prevChar === '\n' ? `\n${text}\n` : `\n\n${text}\n`
          view.dispatch({
            changes: { from: end, to: end, insert: insertion },
            selection: { anchor: end + insertion.length },
            scrollIntoView: true,
          })
        } else {
          view.dispatch({
            changes: { from: sel.from, to: sel.to, insert: text },
            selection: { anchor: sel.from + text.length },
            scrollIntoView: true,
          })
        }
        view.focus()
      },
      focus() {
        cmRef.current?.view?.focus()
      },
      getSelection() {
        const view = cmRef.current?.view
        if (!view) return null
        const sel = view.state.selection.main
        return { from: sel.from, to: sel.to }
      },
      getEditorView() {
        return cmRef.current?.view
      },
    }),
    [onChange, value],
  )

  // The syntax theme follows the surface the editor sits on, not the system
  // preference: reader dialogs can run a light reading theme inside a dark app,
  // and a github-dark token palette there painted near-white code on cream.
  // A `.bd-tone-*` ancestor (reader chrome, reader modals) is authoritative;
  // without one — settings pages, library dialogs — the app's dark class wins.
  const readingTone = useUiStore(selectReadingTone)
  const rootRef = useRef<HTMLDivElement>(null)
  const [isDark, setIsDark] = useState(readingTone === 'bd-tone-dark')
  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    const tone = el.closest('.bd-tone-dark, .bd-tone-light')
    setIsDark(tone ? tone.classList.contains('bd-tone-dark') : document.documentElement.classList.contains('dark'))
  }, [readingTone])

  const lineCount = useMemo(() => {
    return value ? value.split('\n').length : 0
  }, [value])

  const placeholderGutterLines = useMemo(() => {
    if (!placeholder) return ''
    const count = placeholder.split('\n').length
    if (count <= 1) return ''
    return Array.from({ length: count - 1 }, (_, i) => `\\A ${i + 2}`).join('')
  }, [placeholder])

  const charCount = value.length

  const handleCopy = async () => {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore clipboard error
    }
  }

  const jumpToLine = useCallback((lineNum: number) => {
    const view = cmRef.current?.view
    if (!view) return
    const doc = view.state.doc
    const clampedLine = Math.max(1, Math.min(lineNum, doc.lines))
    const line = doc.line(clampedLine)
    view.dispatch({
      selection: { anchor: line.from, head: line.to },
      scrollIntoView: true,
    })
    view.focus()
  }, [])

  // CodeMirror Extensions & Theme
  const themeExtension = useMemo(() => {
    if (isDark) {
      return githubDarkInit({
        settings: {
          background: 'transparent',
          gutterBackground: 'transparent',
          gutterBorder: 'transparent',
          lineHighlight: 'rgba(255, 255, 255, 0.05)',
          selection: 'rgba(255, 255, 255, 0.16)',
          caret: '#e6edf3',
        },
      })
    }
    return githubLightInit({
      settings: {
        background: 'transparent',
        gutterBackground: 'transparent',
        gutterBorder: 'transparent',
        lineHighlight: 'color-mix(in srgb, currentColor 5%, transparent)',
        selection: 'color-mix(in srgb, currentColor 18%, transparent)',
        caret: 'currentColor',
      },
    })
  }, [isDark])

  const searchPhrases = useMemo(() => {
    return EditorState.phrases.of({
      'Find': _('common.searchFind'),
      'Replace': _('common.searchReplace'),
      'next': _('common.searchNext'),
      'previous': _('common.searchPrev'),
      'all': _('common.searchAll'),
      'match case': _('common.searchMatchCase'),
      'by word': _('common.searchByWord'),
      'regexp': _('common.searchRegexp'),
      'replace': _('common.searchDoReplace'),
      'replace all': _('common.searchReplaceAll'),
      'close': _('common.searchClose'),
    })
  }, [_])

  const extensions = useMemo(() => {
    const langExt =
      language === 'xml' || language === 'xhtml' || language === 'html'
        ? [xml()]
        : language === 'css'
          ? [css()]
          : []
    return [
      ...langExt,
      EditorView.lineWrapping,
      themeExtension,
      searchPhrases,
      EditorView.theme({
        '&': {
          height: '100%',
          fontSize: '13px',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
          backgroundColor: 'transparent !important',
          color: 'inherit',
        },
        '.cm-scroller': {
          overflow: 'auto',
          fontFamily: 'inherit',
        },
        '.cm-content': {
          padding: '10px 0',
          caretColor: 'currentColor',
        },
        '.cm-line': {
          padding: '0 12px',
          lineHeight: '1.6',
        },
        '.cm-gutters': {
          backgroundColor: 'color-mix(in srgb, currentColor 3%, transparent) !important',
          borderRight: '1px solid color-mix(in srgb, currentColor 10%, transparent) !important',
          color: 'color-mix(in srgb, currentColor 45%, transparent)',
          userSelect: 'none',
        },
        '.cm-activeLineGutter': {
          backgroundColor: 'color-mix(in srgb, currentColor 8%, transparent) !important',
          color: 'currentColor',
          fontWeight: '600',
        },
        '.cm-activeLine': {
          backgroundColor: 'color-mix(in srgb, currentColor 4%, transparent) !important',
        },
        '&:has(.cm-placeholder) .cm-activeLine': {
          backgroundColor: 'transparent !important',
        },
        '&:has(.cm-placeholder) .cm-activeLineGutter': {
          backgroundColor: 'transparent !important',
        },
        '&:has(.cm-placeholder) .cm-lineNumbers .cm-gutterElement.cm-activeLineGutter::after': {
          content: placeholderGutterLines ? `"${placeholderGutterLines}"` : 'none',
          whiteSpace: 'pre',
          display: 'block',
          opacity: '0.45',
        },
        '.cm-cursor': {
          borderLeftColor: 'currentColor',
        },
        '.cm-placeholder': {
          color: 'color-mix(in srgb, currentColor 40%, transparent) !important',
          fontStyle: 'normal !important',
          fontFamily: 'inherit !important',
        },
        '.cm-selectionBackground, ::selection': {
          backgroundColor: 'color-mix(in srgb, currentColor 18%, transparent) !important',
        },
        // Search & Panels styling
        '.cm-panels': {
          backgroundColor: 'color-mix(in srgb, currentColor 4%, transparent) !important',
          backdropFilter: 'blur(16px)',
          borderColor: 'color-mix(in srgb, currentColor 10%, transparent) !important',
          color: 'inherit',
        },
        '.cm-panels-bottom': {
          borderTop: '1px solid color-mix(in srgb, currentColor 10%, transparent) !important',
        },
        '.cm-panels-top': {
          borderBottom: '1px solid color-mix(in srgb, currentColor 10%, transparent) !important',
        },
        '.cm-panel.cm-search': {
          display: 'flex !important',
          flexWrap: 'wrap !important',
          alignItems: 'center !important',
          gap: '6px 8px !important',
          padding: '10px 40px 10px 12px !important',
          position: 'relative !important',
          fontSize: '12px !important',
          fontFamily: 'inherit !important',
          lineHeight: '1.4 !important',
        },
        '.cm-panel.cm-search br': {
          display: 'block !important',
          width: '100% !important',
          flexBasis: '100% !important',
          height: '0 !important',
          margin: '0 !important',
          border: 'none !important',
        },
        '.cm-panels .cm-textfield, .cm-search .cm-textfield, .cm-textfield': {
          backgroundImage: 'none !important',
          backgroundColor: 'color-mix(in srgb, currentColor 5%, transparent) !important',
          border: '1px solid color-mix(in srgb, currentColor 14%, transparent) !important',
          borderRadius: '6px !important',
          padding: '3px 8px !important',
          color: 'currentColor !important',
          fontSize: '12px !important',
          fontFamily: 'inherit !important',
          outline: 'none !important',
          minWidth: '150px !important',
          height: '26px !important',
          boxSizing: 'border-box !important',
          boxShadow: 'none !important',
          transition: 'all 0.15s ease !important',
        },
        '.cm-panels .cm-textfield:focus, .cm-search .cm-textfield:focus, .cm-textfield:focus': {
          borderColor: 'color-mix(in srgb, currentColor 45%, transparent) !important',
          boxShadow: '0 0 0 2px color-mix(in srgb, currentColor 10%, transparent) !important',
          backgroundColor: 'color-mix(in srgb, currentColor 8%, transparent) !important',
        },
        '.cm-search .cm-textfield::placeholder': {
          color: 'color-mix(in srgb, currentColor 40%, transparent) !important',
        },
        '.cm-panels .cm-button, .cm-search .cm-button, .cm-button': {
          backgroundImage: 'none !important',
          backgroundColor: 'color-mix(in srgb, currentColor 6%, transparent) !important',
          border: '1px solid color-mix(in srgb, currentColor 14%, transparent) !important',
          borderRadius: '6px !important',
          padding: '3px 10px !important',
          color: 'currentColor !important',
          fontSize: '12px !important',
          fontWeight: '500 !important',
          fontFamily: 'inherit !important',
          cursor: 'pointer !important',
          height: '26px !important',
          boxSizing: 'border-box !important',
          display: 'inline-flex !important',
          alignItems: 'center !important',
          justifyContent: 'center !important',
          boxShadow: 'none !important',
          textShadow: 'none !important',
          transition: 'all 0.15s ease !important',
          userSelect: 'none !important',
        },
        '.cm-panels .cm-button:hover, .cm-search .cm-button:hover, .cm-button:hover': {
          backgroundImage: 'none !important',
          backgroundColor: 'color-mix(in srgb, currentColor 12%, transparent) !important',
          borderColor: 'color-mix(in srgb, currentColor 24%, transparent) !important',
          color: 'currentColor !important',
        },
        '.cm-panels .cm-button:active, .cm-search .cm-button:active, .cm-button:active': {
          backgroundImage: 'none !important',
          backgroundColor: 'color-mix(in srgb, currentColor 16%, transparent) !important',
          transform: 'scale(0.97)',
        },
        '.cm-search label': {
          display: 'inline-flex !important',
          alignItems: 'center !important',
          gap: '5px !important',
          fontSize: '12px !important',
          color: 'color-mix(in srgb, currentColor 70%, transparent) !important',
          cursor: 'pointer !important',
          userSelect: 'none !important',
          margin: '0 4px !important',
        },
        '.cm-search label:hover': {
          color: 'currentColor !important',
        },
        '.cm-search input[type="checkbox"]': {
          accentColor: 'currentColor',
          cursor: 'pointer',
          margin: '0 !important',
          width: '13px !important',
          height: '13px !important',
        },
        '.cm-search [name="close"], .cm-panels [name="close"]': {
          position: 'absolute !important',
          top: '10px !important',
          right: '10px !important',
          width: '24px !important',
          height: '24px !important',
          display: 'flex !important',
          alignItems: 'center !important',
          justifyContent: 'center !important',
          borderRadius: '6px !important',
          border: 'none !important',
          backgroundColor: 'transparent !important',
          backgroundImage: 'none !important',
          boxShadow: 'none !important',
          color: 'color-mix(in srgb, currentColor 50%, transparent) !important',
          fontSize: '16px !important',
          cursor: 'pointer !important',
          padding: '0 !important',
          margin: '0 !important',
          lineHeight: '1 !important',
          transition: 'all 0.15s ease !important',
        },
        '.cm-search [name="close"]:hover, .cm-panels [name="close"]:hover': {
          backgroundColor: 'color-mix(in srgb, currentColor 10%, transparent) !important',
          color: 'currentColor !important',
        },
        '.cm-searchMatch': {
          backgroundColor: 'color-mix(in srgb, #eab308 30%, transparent) !important',
          borderRadius: '2px',
        },
        '.cm-searchMatch-selected': {
          backgroundColor: 'color-mix(in srgb, #f59e0b 60%, transparent) !important',
          outline: '1px solid #f59e0b',
          borderRadius: '2px',
        },
      }),
      linter((view) => {
        const diagnostics: Diagnostic[] = []
        if (!issues || issues.length === 0) return diagnostics
        for (const issue of issues) {
          const lineNum = Math.max(1, Math.min(issue.line, view.state.doc.lines))
          const line = view.state.doc.line(lineNum)
          diagnostics.push({
            from: line.from,
            to: line.to,
            severity: 'error',
            message: issue.message,
          })
        }
        return diagnostics
      }),
    ]
  }, [language, themeExtension, searchPhrases, issues, placeholderGutterLines])

  return (
    <div
      ref={rootRef}
      className={cn(
        'group flex flex-col overflow-hidden rounded-xl border border-stone-300/80 bg-stone-500/5 shadow-2xs transition-colors focus-within:border-stone-400 focus-within:ring-1 focus-within:ring-stone-400/20 dark:border-stone-700/80 dark:bg-stone-900/40',
        className,
      )}
      style={{ minHeight, maxHeight }}
    >
      {/* Accessible textarea for screen readers & integration tests */}
      <textarea
        id={textareaId}
        aria-label={ariaLabel ?? label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="sr-only"
        tabIndex={-1}
        readOnly={readOnly}
      />

      {/* Editor Header Bar */}
      <div className="flex shrink-0 items-center justify-between border-b border-stone-200/80 bg-stone-500/5 px-3 py-1.5 dark:border-stone-800/80">
        <div className="flex min-w-0 items-center gap-2">
          <span className="rounded bg-stone-500/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wider text-current/80 uppercase">
            {language}
          </span>
          {label && (
            <span className="truncate text-xs font-medium text-current/75">
              {label}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Status info: Issue counts or valid indicator */}
          {issues.length > 0 ? (
            <button
              type="button"
              onClick={() => setShowIssuesDrawer((prev) => !prev)}
              className="inline-flex items-center gap-1 rounded-md bg-red-500/10 px-1.5 py-0.5 text-[11px] font-medium text-red-600 transition-colors hover:bg-red-500/20 dark:text-red-400"
              title={`${issues.length} ${_('common.issuesCount')}`}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{issues.length}</span>
            </button>
          ) : value ? (
            <span
              className="inline-flex items-center gap-1 text-[11px] text-emerald-600/80 dark:text-emerald-400/80"
              title={_('common.syntaxValid')}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </span>
          ) : null}

          {/* Lines & chars counter (only when content exists) */}
          {lineCount > 0 && (
            <div className="hidden items-center gap-1.5 font-mono text-[11px] text-current/50 sm:flex">
              <span>{_('common.linesCount', { count: lineCount })}</span>
              <span>·</span>
              <span>{_('common.charsCount', { count: charCount })}</span>
            </div>
          )}

          <div className="h-3 w-px bg-stone-200 dark:bg-stone-700/60" />

          {extraHeaderActions}

          {/* Copy button */}
          <button
            type="button"
            onClick={handleCopy}
            disabled={!value}
            title={copied ? _('common.copied') : _('common.copy')}
            aria-label={copied ? _('common.copied') : _('common.copy')}
            className="flex h-6 w-6 items-center justify-center rounded-md text-current/60 transition-colors hover:bg-stone-500/10 hover:text-current disabled:opacity-30"
          >
            {copied ? (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-500">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="8" y="8" width="12" height="12" rx="2" />
                <path d="M16 4H6a2 2 0 0 0-2 2v10" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Editor Body: CodeMirror */}
      <div className="relative min-w-0 flex-1 overflow-hidden" style={{ height }}>
        <CodeMirror
          ref={cmRef}
          value={value}
          theme="none"
          height="100%"
          style={{ height: '100%' }}
          readOnly={readOnly}
          editable={!readOnly}
          placeholder={placeholder}
          extensions={extensions}
          basicSetup={{
            lineNumbers: true,
            highlightActiveLineGutter: true,
            highlightActiveLine: true,
            foldGutter: true,
            bracketMatching: true,
            closeBrackets: true,
            autocompletion: true,
            history: true,
            tabSize: 2,
          }}
          onFocus={() => {
            hasInteractedRef.current = true
          }}
          onUpdate={(viewUpdate) => {
            if (viewUpdate.selectionSet && viewUpdate.view.hasFocus) {
              hasInteractedRef.current = true
            }
          }}
          onChange={(val) => onChange(val)}
        />
      </div>

      {/* Issues drawer */}
      {showIssuesDrawer && issues.length > 0 && (
        <div className="shrink-0 max-h-36 overflow-y-auto border-t border-red-500/20 bg-red-500/5 p-2 font-mono text-xs dark:bg-red-950/20">
          <div className="mb-1 flex items-center justify-between text-red-600 dark:text-red-400">
            <span className="font-semibold">{issues.length} {_('common.issuesCount')}</span>
            <button
              type="button"
              onClick={() => setShowIssuesDrawer(false)}
              className="text-current/60 hover:text-current"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="space-y-1">
            {issues.map((issue, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => jumpToLine(issue.line)}
                className="flex w-full items-start gap-2 rounded px-1.5 py-1 text-left text-red-700 hover:bg-red-500/10 dark:text-red-300"
              >
                <span className="shrink-0 rounded bg-red-500/20 px-1 text-[10px] font-bold">
                  L{issue.line}
                </span>
                <span className="truncate">{issue.message}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
})

export default CodeEditor
