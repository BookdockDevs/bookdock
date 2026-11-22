import { useMemo } from 'react'

import { cn } from '@/lib/utils'

export interface EpubArchiveEntry {
  path: string
  mediaType: string
  size: number
}

interface TreeFolderNode {
  kind: 'folder'
  name: string
  path: string
  children: TreeNode[]
}

interface TreeFileNode {
  kind: 'file'
  name: string
  entry: EpubArchiveEntry
}

type TreeNode = TreeFolderNode | TreeFileNode

const FOLDER_PRIORITY: Record<string, number> = {
  text: 0,
  xhtml: 0,
  html: 0,
  styles: 1,
  style: 1,
  css: 1,
  images: 2,
  image: 2,
  img: 2,
  fonts: 3,
  font: 3,
  audio: 4,
  video: 4,
  media: 4,
  misc: 5,
}

function folderPriority(name: string): number {
  return FOLDER_PRIORITY[name.toLowerCase()] ?? 6
}

function buildFileTree(entries: readonly EpubArchiveEntry[], spineOrder: readonly string[] = []): TreeNode[] {
  const root: TreeFolderNode = { kind: 'folder', name: '', path: '', children: [] }
  const folderMap = new Map<string, TreeFolderNode>([['', root]])
  const spineIndex = new Map(spineOrder.map((href, index) => [href, index]))

  for (const entry of entries) {
    const parts = entry.path.split('/').filter(Boolean)
    if (parts.length === 0) continue
    let parentPath = ''
    for (let i = 0; i < parts.length - 1; i += 1) {
      const part = parts[i]!
      const folderPath = parentPath ? `${parentPath}/${part}` : part
      let folder = folderMap.get(folderPath)
      if (!folder) {
        folder = { kind: 'folder', name: part, path: folderPath, children: [] }
        folderMap.set(folderPath, folder)
        folderMap.get(parentPath)!.children.push(folder)
      }
      parentPath = folderPath
    }
    const fileName = parts.at(-1)!
    folderMap.get(parentPath)!.children.push({ kind: 'file', name: fileName, entry })
  }

  function sortNodes(nodes: TreeNode[]) {
    nodes.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
      if (a.kind === 'folder' && b.kind === 'folder') {
        const prioDiff = folderPriority(a.name) - folderPriority(b.name)
        if (prioDiff !== 0) return prioDiff
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
      }
      if (a.kind === 'file' && b.kind === 'file') {
        const idxA = spineIndex.get(a.entry.path)
        const idxB = spineIndex.get(b.entry.path)
        if (idxA !== undefined && idxB !== undefined) return idxA - idxB
        if (idxA !== undefined) return -1
        if (idxB !== undefined) return 1
      }
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    })
    for (const node of nodes) {
      if (node.kind === 'folder') sortNodes(node.children)
    }
  }

  sortNodes(root.children)
  return root.children
}

interface EpubFileTreeProps {
  entries: readonly EpubArchiveEntry[]
  spineOrder?: readonly string[]
  activeHref: string | null
  changedHrefs: ReadonlySet<string>
  collapsedDirs: ReadonlySet<string>
  onToggleDir: (path: string) => void
  onSelect: (path: string) => void
}

export default function EpubFileTree({
  entries,
  spineOrder,
  activeHref,
  changedHrefs,
  collapsedDirs,
  onToggleDir,
  onSelect,
}: EpubFileTreeProps) {
  const tree = useMemo(() => buildFileTree(entries, spineOrder), [entries, spineOrder])

  function renderNodes(nodes: TreeNode[], depth = 0) {
    return (
      <ul className="space-y-0.5" role={depth === 0 ? 'tree' : 'group'} aria-label={depth === 0 ? 'EPUB 文件树' : undefined}>
        {nodes.map((node) => {
          if (node.kind === 'folder') {
            const isExpanded = !collapsedDirs.has(node.path)
            return (
              <li key={node.path} role="treeitem" aria-expanded={isExpanded}>
                <button
                  type="button"
                  onClick={() => onToggleDir(node.path)}
                  style={{ paddingLeft: `${8 + depth * 12}px` }}
                  className="flex w-full items-center gap-1.5 rounded-lg py-1.5 pr-2 text-left text-xs font-medium text-stone-600 transition-colors hover:bg-stone-500/5 hover:text-stone-900 dark:text-stone-300 dark:hover:text-stone-100"
                >
                  <svg
                    className={cn('h-3 w-3 shrink-0 text-stone-400 transition-transform', isExpanded && 'rotate-90')}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                  <svg className="h-3.5 w-3.5 shrink-0 text-stone-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
                  </svg>
                  <span className="min-w-0 flex-1 truncate">{node.name}</span>
                </button>
                {isExpanded && renderNodes(node.children, depth + 1)}
              </li>
            )
          }

          const active = activeHref === node.entry.path
          const changed = changedHrefs.has(node.entry.path)
          return (
            <li key={node.entry.path} role="treeitem" aria-selected={active}>
              <button
                type="button"
                onClick={() => onSelect(node.entry.path)}
                aria-current={active ? 'location' : undefined}
                style={{ paddingLeft: `${20 + depth * 12}px` }}
                className={cn(
                  'flex w-full items-center gap-1.5 rounded-lg py-1.5 pr-2 text-left text-xs transition-colors',
                  active
                    ? 'bg-stone-500/12 font-medium text-stone-900 dark:text-stone-100'
                    : 'text-stone-600 hover:bg-stone-500/5 dark:text-stone-400',
                )}
              >
                <svg className="h-3.5 w-3.5 shrink-0 text-stone-400/80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
                <span className="min-w-0 flex-1 truncate">{node.name}</span>
                {changed && <span aria-label="已修改" className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />}
              </button>
            </li>
          )
        })}
      </ul>
    )
  }

  if (tree.length === 0) {
    return <p className="p-3 text-xs text-stone-400">暂无文件。</p>
  }

  return <>{renderNodes(tree)}</>
}
