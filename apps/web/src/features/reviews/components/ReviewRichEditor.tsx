import { useEffect, useRef, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

import {
  BlockTypeSelect, BoldItalicUnderlineToggles,
  ListsToggle, MDXEditor, StrikeThroughSupSubToggles, UndoRedo,
  codeBlockPlugin, codeMirrorPlugin,
  convertSelectionToNode$, currentBlockType$,
  defaultSvgIcons, headingsPlugin, imagePlugin, linkDialogPlugin,
  linkDialogState$, linkPlugin, listsPlugin, openLinkEditDialog$,
  quotePlugin,
  tablePlugin, toolbarPlugin, useCellValue,
  usePublisher, type IconKey, type MDXEditorMethods,
} from '@mdxeditor/editor'
import { $createQuoteNode } from '@lexical/rich-text'
import { $createParagraphNode } from 'lexical'

import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/stores/ui.store'

interface ReviewRichEditorProps {
  body: string
  disabled: boolean
  onChange: (body: string) => void
  onUnsupported: () => void
  insertRef: RefObject<((text: string) => void) | null>
  toolbarContainer?: HTMLElement | null
  toolbarExtras?: ReactNode
}

function customIconComponentFor(name: IconKey) {
  if (name === 'strikeThrough') {
    return (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M16 5c-1-1-2.5-1.5-4-1.5-2.8 0-4.5 1.6-4.5 3.8 0 4.5 9 2.5 9 7.2 0 2.2-1.8 4-4.5 4-2 0-3.8-.8-4.8-2" />
        <line x1="3" y1="12" x2="21" y2="12" strokeWidth="2.2" />
      </svg>
    )
  }
  if (name === 'format_list_numbered') {
    return (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 6.5h1.5v5M4 11.5h3" strokeWidth="1.8" />
        <line x1="10.5" y1="9" x2="20.5" y2="9" />
        <path d="M4 15.5c.3-.8 1.2-1.5 2-1.5 1 0 1.5.7 1.5 1.4 0 .9-.8 1.6-1.5 2.1L4 19.5h3.5" strokeWidth="1.8" />
        <line x1="10.5" y1="17.5" x2="20.5" y2="17.5" />
      </svg>
    )
  }
  if (name === 'arrow_drop_down') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="6 9 12 15 18 9" />
      </svg>
    )
  }
  return defaultSvgIcons[name]
}

function BlockTypeSync() {
  const currentBlockType = useCellValue(currentBlockType$)
  const setCurrentBlockType = usePublisher(currentBlockType$)

  useEffect(() => {
    if (!currentBlockType) {
      setCurrentBlockType('paragraph')
    }
  }, [currentBlockType, setCurrentBlockType])

  return null
}

function QuoteToggle() {
  const currentBlockType = useCellValue(currentBlockType$)
  const convertSelectionToNode = usePublisher(convertSelectionToNode$)
  const _ = useTranslation()
  const isQuote = currentBlockType === 'quote'

  return (
    <button
      type="button"
      title={_('reviewEditor.toolbar.blockTypes.quote', { defaultValue: '引用' })}
      aria-label={_('reviewEditor.toolbar.blockTypes.quote', { defaultValue: '引用' })}
      aria-pressed={isQuote}
      data-state={isQuote ? 'on' : 'off'}
      onClick={() => {
        if (isQuote) {
          convertSelectionToNode(() => $createParagraphNode())
        } else {
          convertSelectionToNode(() => $createQuoteNode())
        }
      }}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-lg p-1.5 transition-colors',
        isQuote
          ? 'bg-stone-200 text-stone-900 dark:bg-stone-700 dark:text-stone-100'
          : 'text-stone-600 hover:bg-stone-100 hover:text-stone-800 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-stone-100',
      )}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z" />
      </svg>
    </button>
  )
}

function LinkToggle() {
  const openLinkDialog = usePublisher(openLinkEditDialog$)
  const linkDialogState = useCellValue(linkDialogState$)
  const _ = useTranslation()
  const isLinkActive = linkDialogState.type !== 'inactive'

  return (
    <button
      type="button"
      title={_('reviewEditor.toolbar.link', { defaultValue: '插入链接' })}
      aria-label={_('reviewEditor.toolbar.link', { defaultValue: '插入链接' })}
      aria-pressed={isLinkActive}
      data-state={isLinkActive ? 'on' : 'off'}
      onPointerDown={(e) => e.preventDefault()}
      onClick={() => openLinkDialog()}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-lg p-1.5 transition-colors',
        isLinkActive
          ? 'bg-stone-200 text-stone-900 dark:bg-stone-700 dark:text-stone-100'
          : 'text-stone-600 hover:bg-stone-100 hover:text-stone-800 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-stone-100',
      )}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </svg>
    </button>
  )
}

export default function ReviewRichEditor({ body, disabled, onChange, onUnsupported, insertRef, toolbarContainer, toolbarExtras }: ReviewRichEditorProps) {
  const _ = useTranslation()
  const dark = useUiStore((state) => state.systemTheme === 'dark')
  const editor = useRef<MDXEditorMethods>(null)
  const lastBody = useRef(body)

  useEffect(() => {
    insertRef.current = (text) => editor.current?.focus(() => editor.current?.insertMarkdown(text), { defaultSelection: 'rootEnd' })
    return () => { insertRef.current = null }
  }, [insertRef])
  useEffect(() => {
    if (body !== lastBody.current) {
      lastBody.current = body
      editor.current?.setMarkdown(body)
    }
  }, [body])

  return (
    <MDXEditor
      ref={editor}
      markdown={body}
      readOnly={disabled}
      placeholder={_('review.bodyPlaceholder')}
      iconComponentFor={customIconComponentFor}
      className={cn(dark && 'dark-theme', "review-rich-editor flex min-h-0 flex-1 flex-col text-stone-800 [--basePageBg:var(--color-white)] [--baseText:var(--color-stone-800)] [&.mdxeditor-popup-container]:z-[60] dark:text-stone-100 dark:[--basePageBg:var(--color-stone-900)] dark:[--baseText:var(--color-stone-100)] [&_.cm-editor]:bg-transparent! [&_.cm-editor]:text-stone-800! [&_.cm-gutters]:bg-transparent! [&_.cm-gutters]:text-stone-500! [&_.cm-content]:text-stone-800 [&_.cm-activeLine]:bg-stone-100! [&_.cm-activeLineGutter]:bg-stone-100! [&_.cm-cursor]:border-stone-800! dark:[&_.cm-editor]:text-stone-100! dark:[&_.cm-content]:text-stone-100 dark:[&_.cm-activeLine]:bg-stone-800! dark:[&_.cm-activeLineGutter]:bg-stone-800! dark:[&_.cm-cursor]:border-stone-100!")}
      contentEditableClassName="min-h-full flex-1 break-words px-0! py-1 pr-1 text-base leading-7 [&_p]:my-3 [&_p]:whitespace-pre-wrap [&_h1]:mb-4 [&_h1]:mt-6 [&_h2]:mb-3 [&_h2]:mt-5 [&_h3]:mb-2 [&_h3]:mt-4 [&>:first-child]:mt-0! [&_li]:my-1 [&_li_p]:my-0 [&_blockquote]:my-4 [&_blockquote]:text-stone-500 dark:[&_blockquote]:text-stone-400 [&_table]:my-4 [&_h1]:text-xl [&_h1]:font-bold [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:font-semibold [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-stone-300 [&_blockquote]:pl-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_img]:max-w-full"
      translation={(key, defaultValue, values) => _(`reviewEditor.${key}`, { defaultValue, ...values })}
      onChange={(markdown, initialNormalize) => {
        if (initialNormalize) return
        lastBody.current = markdown
        onChange(markdown)
      }}
      onError={onUnsupported}
      plugins={[
        headingsPlugin({ allowedHeadingLevels: [1, 2, 3] }),
        listsPlugin(),
        quotePlugin(),
        linkPlugin(),
        linkDialogPlugin({ showLinkTitleField: false }),
        tablePlugin(),
        codeBlockPlugin({ defaultCodeBlockLanguage: '' }),
        codeMirrorPlugin({ autoLoadLanguageSupport: false, codeBlockLanguages: { '': _('reviewEditor.codeBlock.plainText'), js: 'JavaScript', ts: 'TypeScript', javascript: 'JavaScript', typescript: 'TypeScript', python: 'Python', json: 'JSON', css: 'CSS', html: 'HTML', bash: 'Shell', sql: 'SQL' } }),
        imagePlugin({
          disableImageResize: true,
          disableImageSettingsButton: true,
          allowSetImageDimensions: false,
          imagePreviewHandler: async (url) => url,
        }),
        toolbarPlugin({
          toolbarPosition: 'top',
          toolbarClassName: 'hidden!',
          toolbarContents: () => toolbarContainer ? createPortal(
            <div
              role="toolbar"
              onMouseDown={(e) => {
                const target = e.target as HTMLElement
                if (target.closest('button') && !target.closest('[role="combobox"]')) {
                  e.preventDefault()
                  const active = document.activeElement
                  if (!active || !active.closest('.review-rich-editor')) {
                    editor.current?.focus()
                  }
                }
              }}
              className={cn(
                'mdxeditor flex min-w-0 flex-1 flex-wrap items-center gap-1 bg-transparent! text-stone-600 dark:text-stone-300',
                '[&_button]:min-h-8 [&_button]:min-w-8 [&_button]:rounded-lg [&_button]:p-1.5 [&_button]:transition-colors',
                '[&_button]:hover:bg-stone-100 dark:[&_button]:hover:bg-stone-800',
                '[&_button:disabled]:opacity-30 [&_button:disabled]:cursor-not-allowed [&_button:disabled]:hover:bg-transparent dark:[&_button:disabled]:hover:bg-transparent',
                '[&_button[data-disabled]]:opacity-30 [&_button[data-disabled]]:cursor-not-allowed [&_button[data-disabled]]:hover:bg-transparent dark:[&_button[data-disabled]]:hover:bg-transparent',
                '[&_button[data-state=on]]:bg-stone-200 [&_button[data-state=on]]:text-stone-900 dark:[&_button[data-state=on]]:bg-stone-700 dark:[&_button[data-state=on]]:text-stone-100',
                '[&_button[data-state=on]:hover]:bg-stone-300 dark:[&_button[data-state=on]:hover]:bg-stone-600',
                '[&_button[aria-pressed=true]]:bg-stone-200 [&_button[aria-pressed=true]]:text-stone-900 dark:[&_button[aria-pressed=true]]:bg-stone-700 dark:[&_button[aria-pressed=true]]:text-stone-100',
                '[&_button[aria-pressed=true]:hover]:bg-stone-300 dark:[&_button[aria-pressed=true]:hover]:bg-stone-600',
                '[&_button]:focus-visible:outline-2 [&_button]:focus-visible:outline-stone-400 [&_svg]:h-4.5 [&_svg]:w-4.5',
                dark && 'dark-theme',
              )}
            >
              <BlockTypeSelect />
              <BlockTypeSync />
              <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-stone-200 dark:bg-stone-700" />
              <BoldItalicUnderlineToggles options={['Bold', 'Italic']} />
              <StrikeThroughSupSubToggles options={['Strikethrough']} />
              <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-stone-200 dark:bg-stone-700" />
              <ListsToggle options={['bullet', 'number']} />
              <QuoteToggle />
              <LinkToggle />
              {toolbarExtras}
              <div className="ml-auto flex items-center gap-1 pl-2"><UndoRedo /></div>
            </div>, toolbarContainer,
          ) : null,
        }),
      ]}
    />
  )
}
