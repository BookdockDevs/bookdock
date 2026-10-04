import { z } from 'zod'

import { bookFormatSchema, bookUpdateSchema } from './schema'

export const librarySearchFields = ['tag', 'shelf', 'category', 'author', 'format', 'status'] as const
export type LibrarySearchField = typeof librarySearchFields[number]
export const librarySearchFormats = bookFormatSchema.options
export const librarySearchStatuses = bookUpdateSchema.shape.readStatus.unwrap().options

export type LibrarySearchExpression =
  | { kind: 'text'; value: string; start: number; end: number }
  | { kind: 'field'; field: LibrarySearchField; value: string; id?: string; start: number; end: number }
  | { kind: 'and' | 'or'; left: LibrarySearchExpression; right: LibrarySearchExpression; start: number; end: number }
  | { kind: 'not'; child: LibrarySearchExpression; start: number; end: number }

export class LibrarySearchError extends Error {
  constructor(message: string, public start: number, public end = start + 1) {
    super(message)
    this.name = 'LibrarySearchError'
  }
}

const location = { start: z.number().int().min(0).max(4096), end: z.number().int().min(0).max(4096) }
const expressionSchema: z.ZodType<LibrarySearchExpression> = z.lazy(() => z.union([
  z.object({ kind: z.literal('text'), value: z.string().min(1).max(4096), ...location }).strict(),
  z.object({ kind: z.literal('field'), field: z.enum(librarySearchFields), value: z.string().min(1).max(4096), id: z.string().min(1).max(128).optional(), ...location }).strict(),
  z.object({ kind: z.enum(['and', 'or']), left: expressionSchema, right: expressionSchema, ...location }).strict(),
  z.object({ kind: z.literal('not'), child: expressionSchema, ...location }).strict(),
]))

function checkBounds(input: unknown, depth = 0, count = { value: 0 }): void {
  if (depth > 16 || ++count.value > 128) throw new LibrarySearchError('表达式过于复杂（最多 128 项、16 层）', 0)
  if (!input || typeof input !== 'object') return
  const node = input as Record<string, unknown>
  if ('left' in node) checkBounds(node.left, depth + 1, count)
  if ('right' in node) checkBounds(node.right, depth + 1, count)
  if ('child' in node) checkBounds(node.child, depth + 1, count)
}

export function readLibrarySearchExpression(input: unknown): LibrarySearchExpression {
  let value = input
  if (typeof input === 'string') {
    if (input.length > 24000) throw new LibrarySearchError('表达式过长', 0)
    try { value = JSON.parse(input) } catch { throw new LibrarySearchError('链接中的搜索表达式无效', 0) }
  }
  checkBounds(value)
  const parsed = expressionSchema.safeParse(value)
  if (!parsed.success) throw new LibrarySearchError('搜索表达式结构无效', 0)
  visitLibrarySearch(parsed.data, (node) => {
    if (node.kind !== 'field') return
    if (node.id && !['tag', 'shelf', 'category'].includes(node.field)) throw new LibrarySearchError('仅标签、书架和分类可绑定 ID', node.start, node.end)
    if (node.field === 'format' && !bookFormatSchema.safeParse(node.value).success) throw new LibrarySearchError(`format 可用值：${librarySearchFormats.join(', ')}`, node.start, node.end)
    if (node.field === 'status' && !bookUpdateSchema.shape.readStatus.safeParse(node.value).success) throw new LibrarySearchError(`status 可用值：${librarySearchStatuses.join(', ')}`, node.start, node.end)
  })
  return parsed.data
}

export function visitLibrarySearch(expression: LibrarySearchExpression, visit: (node: LibrarySearchExpression) => void): void {
  visit(expression)
  if (expression.kind === 'and' || expression.kind === 'or') {
    visitLibrarySearch(expression.left, visit)
    visitLibrarySearch(expression.right, visit)
  } else if (expression.kind === 'not') visitLibrarySearch(expression.child, visit)
}

interface Token { value: string; field?: string; values: string[]; start: number; end: number; symbol?: boolean }

export function parseLibrarySearch(source: string): LibrarySearchExpression | undefined {
  if (source.length > 4096) throw new LibrarySearchError('搜索最多 4096 个字符', 4096)
  const tokens: Token[] = []
  let i = 0
  while (i < source.length) {
    if (/\s/.test(source[i])) { i++; continue }
    const start = i
    if ('&|!()'.includes(source[i])) {
      tokens.push({ value: source[i], values: [], start, end: ++i, symbol: true })
      continue
    }
    let value = ''
    let field: string | undefined
    const values: string[] = []
    while (i < source.length && !/[\s&|!()]/.test(source[i])) {
      const char = source[i++]
      if (char === '"') {
        const quoteStart = i - 1
        let closed = false
        while (i < source.length) {
          const next = source[i++]
          if (next === '"') { closed = true; break }
          if (next === '\\') {
            const escaped = source[i++]
            if (escaped !== '"' && escaped !== '\\') throw new LibrarySearchError('引号内仅支持 \\" 和 \\\\ 转义', i - 2, i)
            value += escaped
          } else value += next
        }
        if (!closed) throw new LibrarySearchError('双引号未闭合', quoteStart, source.length)
      } else if (char === ':' && field === undefined && values.length === 0 && /^[^\s:]+$/.test(value)) {
        field = value
        value = ''
      } else if (char === ',' && field !== undefined) {
        values.push(value)
        value = ''
      } else value += char
    }
    values.push(value)
    tokens.push({ value, field, values, start, end: i })
  }
  if (!tokens.length) return undefined
  let at = 0
  let nesting = 0
  const fail = (message: string, token = tokens[at]) => { throw new LibrarySearchError(message, token?.start ?? source.length, token?.end ?? source.length) }
  const binary = (kind: 'and' | 'or', left: LibrarySearchExpression, right: LibrarySearchExpression): LibrarySearchExpression => ({ kind, left, right, start: left.start, end: right.end })
  const operand = (): LibrarySearchExpression => {
    const token = tokens[at++]
    if (!token) return fail('运算符缺少操作数')
    if (++nesting > 16) return fail('括号或 NOT 嵌套过深', token)
    let result: LibrarySearchExpression
    if (token.symbol && token.value === '!') {
      const child = operand()
      result = { kind: 'not', child, start: token.start, end: child.end }
    } else if (token.symbol && token.value === '(') {
      result = disjunction()
      if (tokens[at]?.value !== ')' || !tokens[at]?.symbol) return fail('括号未闭合', token)
      at++
    } else if (token.symbol) return fail('运算符缺少操作数', token)
    else if (token.field !== undefined) {
      if (!librarySearchFields.includes(token.field as LibrarySearchField)) return fail(`未知字段：${token.field}`, token)
      if (token.values.length > 1 && token.field !== 'tag') return fail('逗号列表仅用于 tag', token)
      if (token.values.some((value) => !value.length)) return fail(`${token.field} 缺少值`, token)
      const leaves = token.values.map((value): LibrarySearchExpression => ({ kind: 'field', field: token.field as LibrarySearchField, value, start: token.start, end: token.end }))
      result = leaves.reduce((left, right) => binary('and', left, right))
    } else {
      let value = token.value
      let end = token.end
      while (tokens[at] && !tokens[at].symbol && tokens[at].field === undefined) {
        value += source.slice(end, tokens[at].start) + tokens[at].value
        end = tokens[at++].end
      }
      if (!value.length) return fail('搜索项不能为空', token)
      result = { kind: 'text', value, start: token.start, end }
    }
    nesting--
    return result
  }
  const conjunction = (): LibrarySearchExpression => {
    let left = operand()
    while (at < tokens.length && !(tokens[at].symbol && ['|', ')'].includes(tokens[at].value))) {
      if (tokens[at].symbol && tokens[at].value === '&') at++
      left = binary('and', left, operand())
    }
    return left
  }
  const disjunction = (): LibrarySearchExpression => {
    let left = conjunction()
    while (tokens[at]?.symbol && tokens[at].value === '|') { at++; left = binary('or', left, conjunction()) }
    return left
  }
  const result = disjunction()
  if (at !== tokens.length) fail('多余的右括号')
  return readLibrarySearchExpression(result)
}

export interface SearchName { id: string; name: string; parentId?: string | null }
export interface LibrarySearchNames { shared: boolean; tags: SearchName[]; categories: SearchName[]; authors?: string[] }

export function librarySearchCategoryName(categories: SearchName[], id: string): string {
  const path: string[] = []
  const seen = new Set<string>()
  let current = categories.find((entry) => entry.id === id)
  while (current && !seen.has(current.id)) {
    path.unshift(current.name)
    seen.add(current.id)
    current = categories.find((entry) => entry.id === current?.parentId)
  }
  return path.join('/')
}

export function bindLibrarySearch(expression: LibrarySearchExpression, names: LibrarySearchNames): LibrarySearchExpression {
  const node = readLibrarySearchExpression(expression)
  if (node.kind === 'and' || node.kind === 'or') return { ...node, left: bindLibrarySearch(node.left, names), right: bindLibrarySearch(node.right, names) }
  if (node.kind === 'not') return { ...node, child: bindLibrarySearch(node.child, names) }
  if (node.kind !== 'field') return node
  if ((node.field === 'shelf' && names.shared) || (node.field === 'category' && !names.shared) || (node.field === 'status' && names.shared)) {
    throw new LibrarySearchError(`${node.field} ${node.field === 'category' ? '仅用于共享库' : '仅用于私库'}`, node.start, node.end)
  }
  if (!['tag', 'shelf', 'category'].includes(node.field)) return node
  const entries = node.field === 'tag' ? names.tags : names.categories
  const matches = node.id
    ? entries.filter((entry) => entry.id === node.id)
    : entries.filter((entry) => entry.name === node.value || (node.field === 'category' && librarySearchCategoryName(names.categories, entry.id) === node.value))
  if (matches.length !== 1) throw new LibrarySearchError(`${node.field}:${node.value} ${matches.length ? '名称有歧义，请使用完整分类路径' : '名称不存在或不可访问'}`, node.start, node.end)
  return { ...node, id: matches[0].id }
}

export function quoteLibrarySearch(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

export function printLibrarySearch(node: LibrarySearchExpression, parentPrecedence = 0): string {
  if (node.kind === 'text') return /[&|!()":\\]/.test(node.value) || node.value !== node.value.trim() ? quoteLibrarySearch(node.value) : node.value
  if (node.kind === 'field') return `${node.field}:${/[\s&|!()",:\\]/.test(node.value) ? quoteLibrarySearch(node.value) : node.value}`
  const precedence = node.kind === 'not' ? 3 : node.kind === 'and' ? 2 : 1
  const value = node.kind === 'not' ? `!${printLibrarySearch(node.child, precedence)}`
    : `${printLibrarySearch(node.left, precedence)} ${node.kind === 'and' ? '&' : '|'} ${printLibrarySearch(node.right, precedence)}`
  return precedence < parentPrecedence ? `(${value})` : value
}

export function normalizeLibrarySearch(node: LibrarySearchExpression): LibrarySearchExpression {
  const leaves: Array<Extract<LibrarySearchExpression, { kind: 'field' | 'text' }>> = []
  visitLibrarySearch(node, (entry) => { if (entry.kind === 'field' || entry.kind === 'text') leaves.push(entry) })
  const normalized = parseLibrarySearch(printLibrarySearch(node))!
  let index = 0
  visitLibrarySearch(normalized, (entry) => {
    if (entry.kind !== 'field' && entry.kind !== 'text') return
    const original = leaves[index++]
    if (entry.kind === 'field' && original.kind === 'field') entry.id = original.id
  })
  return normalized
}

export function simpleLibrarySearch(node: LibrarySearchExpression): Array<Extract<LibrarySearchExpression, { kind: 'field' | 'text' }>> | undefined {
  if (node.kind === 'not' || node.kind === 'or') return undefined
  if (node.kind === 'text' || node.kind === 'field') return [node]
  const left = simpleLibrarySearch(node.left)
  const right = simpleLibrarySearch(node.right)
  return left && right ? [...left, ...right] : undefined
}
