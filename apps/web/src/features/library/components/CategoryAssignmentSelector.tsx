import { useId, useMemo, useState } from 'react'

import { CATEGORY_TEMPLATES, categoryTemplatePath, type Category } from '@bookdock/shared'

import { useTranslation } from '@/hooks/useTranslation'

import { categoryPath } from '../taxonomy'
import { inputClass } from './book-detail/ui'
import TaxonomyChoiceRow from './TaxonomyChoiceRow'
import TaxonomyIcon from './TaxonomyIcon'

interface CategoryAssignmentSelectorProps {
  categories: Category[]
  categoryId: string | null | undefined
  categoryTemplateKey: string | undefined
  allowTemplates: boolean
  allowKeep?: boolean
  onKeep?: () => void
  onChange: (value: { categoryId: string | null; categoryTemplateKey?: undefined } | { categoryId?: undefined; categoryTemplateKey: string }) => void
}

export default function CategoryAssignmentSelector({ categories, categoryId, categoryTemplateKey, allowTemplates, allowKeep = false, onKeep, onChange }: CategoryAssignmentSelectorProps) {
  const _ = useTranslation()
  const radioName = `category-${useId()}`
  const [query, setQuery] = useState('')
  const [expandedRoots, setExpandedRoots] = useState<Set<string>>(() => new Set())
  const paths = useMemo(() => new Map(categories.map((category) => [category.id, categoryPath(categories, category.id).map((node) => node.name).join(' / ')])), [categories])
  const existingPathKeys = useMemo(() => new Set(categories.map((category) => categoryPath(categories, category.id).map((node) => node.name).join('\u0000'))), [categories])
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const selectedTemplateRoot = CATEGORY_TEMPLATES.find((root) => root.key === categoryTemplateKey || root.children?.some((child) => child.key === categoryTemplateKey))
  const selectedTemplateLabel = selectedTemplateRoot
    ? `${_(`library.categoryTemplate.${selectedTemplateRoot.key}.name`)}${selectedTemplateRoot.key === categoryTemplateKey ? '' : ` / ${_(`library.categoryTemplate.${categoryTemplateKey}`)}`}`
    : undefined
  const templateGroups = useMemo(() => CATEGORY_TEMPLATES.map((root) => {
    const rootPath = categoryTemplatePath(root.key)!
    const rootName = _(`library.categoryTemplate.${root.key}.name`)
    const rootMatches = `${rootPath.join(' / ')} ${rootName}`.toLocaleLowerCase().includes(normalizedQuery)
    const children = (root.children ?? []).filter((child) => {
      const childPath = categoryTemplatePath(child.key)!
      const localizedPath = `${rootName} / ${_(`library.categoryTemplate.${child.key}`)}`
      return !existingPathKeys.has(childPath.join('\u0000')) && (!normalizedQuery || `${childPath.join(' / ')} ${localizedPath}`.toLocaleLowerCase().includes(normalizedQuery))
    })
    const rootExists = existingPathKeys.has(rootPath.join('\u0000'))
    return { root, rootName, rootExists, rootMatches, children }
  }).filter((group) => (!group.rootExists && (!normalizedQuery || group.rootMatches)) || group.children.length > 0), [normalizedQuery, existingPathKeys, _])

  function toggleRoot(key: string) {
    setExpandedRoots((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="space-y-2.5">
      {selectedTemplateLabel && <p className="flex items-center gap-2 px-2 text-xs text-stone-500 dark:text-stone-400"><TaxonomyIcon kind="category" size={14} /><span>{selectedTemplateLabel}</span></p>}
      {allowKeep && (
        <TaxonomyChoiceRow
          label={_('library.keepCategory')}
          checked={categoryId === undefined && !categoryTemplateKey}
          name={radioName}
          onChange={() => onKeep?.()}
        />
      )}
      <TaxonomyChoiceRow
        label={_('library.uncategorized')}
        checked={categoryId === null && !categoryTemplateKey}
        name={radioName}
        onChange={() => onChange({ categoryId: null })}
      />
      {categories.length > 0 && (
        <section>
          <p className="px-2 pb-1 text-xs font-semibold text-stone-500">{_('library.existingCategories')}</p>
          <div className="space-y-0.5">
            {categories.map((category) => (
              <TaxonomyChoiceRow
                key={category.id}
                label={paths.get(category.id) ?? category.name}
                checked={categoryId === category.id && !categoryTemplateKey}
                name={radioName}
                onChange={() => onChange({ categoryId: category.id })}
              />
            ))}
          </div>
        </section>
      )}
      {allowTemplates && (
        <details>
          <summary className="cursor-pointer px-2 py-1.5 text-xs font-semibold text-stone-500">{_('library.recommendedCategories')}</summary>
          <div className="mt-2 space-y-2">
            <input
              value={query}
              onChange={(event) => {
                const value = event.target.value
                setQuery(value)
                setExpandedRoots(new Set(value.trim() ? CATEGORY_TEMPLATES.map((root) => root.key) : []))
              }}
              placeholder={_('library.searchCategoryTemplates')}
              aria-label={_('library.searchCategoryTemplates')}
              className={inputClass}
            />
            <div className="space-y-1">
              {templateGroups.map(({ root, rootName, rootExists, rootMatches, children }) => {
                const expanded = expandedRoots.has(root.key)
                const hasChildren = children.length > 0
                return (
                  <section key={root.key}>
                    <div className="flex items-center gap-1">
                      {rootExists || (normalizedQuery && !rootMatches) ? (
                        <div className="flex min-h-9 min-w-0 flex-1 items-center rounded-lg px-2.5 py-2 text-sm text-stone-500 dark:text-stone-400">
                          <span className="truncate">{rootName}</span>
                        </div>
                      ) : (
                        <TaxonomyChoiceRow
                          label={rootName}
                          checked={categoryTemplateKey === root.key}
                          name={radioName}
                          onChange={() => onChange({ categoryTemplateKey: root.key })}
                        />
                      )}
                      {hasChildren && (
                        <button
                          type="button"
                          aria-expanded={expanded}
                          aria-label={`${_(`library.${expanded ? 'collapse' : 'expand'}`)} ${rootName}`}
                          onClick={() => toggleRoot(root.key)}
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200"
                        >
                          <svg className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="m6 9 6 6 6-6" />
                          </svg>
                        </button>
                      )}
                    </div>
                    {expanded && children.length > 0 && (
                      <div className="ml-5 space-y-0.5 border-l border-stone-200 pl-2 dark:border-stone-700">
                        {children.map((child) => (
                          <TaxonomyChoiceRow
                            key={child.key}
                            label={_(`library.categoryTemplate.${child.key}`)}
                            ariaLabel={`${rootName} / ${_(`library.categoryTemplate.${child.key}`)}`}
                            checked={categoryTemplateKey === child.key}
                            name={radioName}
                            onChange={() => onChange({ categoryTemplateKey: child.key })}
                          />
                        ))}
                      </div>
                    )}
                  </section>
                )
              })}
              {templateGroups.length === 0 && <p className="px-2 py-2 text-xs text-stone-400">{_('library.noCategories')}</p>}
            </div>
          </div>
        </details>
      )}
    </div>
  )
}
