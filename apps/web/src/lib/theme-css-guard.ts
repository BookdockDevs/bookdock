// User reading-theme CSS validation (phase 2). One hand-rolled tokenizer +
// rule walker serves both blocks: content CSS (section documents) and UI CSS
// (reader chrome). Checks are structural, not keyword scans: comments, strings
// and identifier escapes are resolved before any name is compared, so obfuscated
// spellings (`u\72 l(`, `ur/**/l(`) cannot smuggle resource loads through.

export const MAX_THEME_CSS_LENGTH = 100_000
const MAX_NESTING_DEPTH = 32

export interface CssIssue {
  line: number
  message: string
}

export interface ContentCssValidation {
  ok: boolean
  /** '' when invalid; the trimmed input when valid */
  css: string
  /** Compiled stylesheet constrained to descendants of the publication body. */
  scopedCss: string
  issues: CssIssue[]
}

export interface UiCssValidation {
  ok: boolean
  /** '' when invalid; the trimmed input when valid */
  css: string
  /** '' when invalid; the author-form sheet with asset references resolved
   *  (same selectors, temporary URLs) — editor preview surface */
  resolvedCss: string
  /** '' when invalid; rules scoped to the live reader root. */
  hostCss: string
  /** '' when invalid; only the outside-rooted rules, injected into section documents */
  outsideCss: string
  /** '' when invalid; image-bearing outside rules compiled for the paginator's
   *  viewport-fixed decoration surface (only produced with a resolver) */
  decorationCss: string
  issues: CssIssue[]
}

/** Stable UI style targets (reader chrome roots). See docs/architecture.md. */
export const UI_CSS_TARGETS = ['header', 'footer', 'toolbar', 'outside'] as const
export type UiCssTarget = (typeof UI_CSS_TARGETS)[number]

/**
 * The one opened resource form (phase 4): `url("bd-asset:<id>")` references a
 * theme asset by stable id. Anything else inside url() — external, relative,
 * data:, blob:, escaped spellings — stays rejected. Stored CSS keeps this
 * author form; blob URLs exist only in compiled injection output.
 */
export const THEME_ASSET_URL_PREFIX = 'bd-asset:'
const ASSET_URL_PATTERN = /^("|\x27)bd-asset:([A-Za-z0-9_-]{1,100})\1$/
/** Shadow-root surface that renders image-bearing outside rules. */
const UI_DECORATION_TARGET = '#decoration'

export interface CssAssetContext {
  /** Known asset ids at save/preview time; unknown references are issues */
  ids?: ReadonlySet<string>
  decorationTarget?: string
  /** Render-time resolver: id → temporary URL; null = missing (declaration dropped) */
  resolve?: (id: string) => string | null
}

/** Synchronous id → temporary URL lookup used at injection boundaries. */
export type ThemeAssetResolver = NonNullable<CssAssetContext['resolve']>

const SAFE_VALUE_FUNCTIONS = new Set([
  'calc', 'min', 'max', 'clamp', 'round', 'mod', 'rem',
  'rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'color', 'color-mix', 'light-dark',
  'linear-gradient', 'radial-gradient', 'conic-gradient',
  'repeating-linear-gradient', 'repeating-radial-gradient', 'repeating-conic-gradient',
  'translate', 'translatex', 'translatey', 'scale', 'scalex', 'scaley', 'rotate', 'skew', 'skewx', 'skewy',
  'cubic-bezier', 'steps', 'counter', 'counters',
])

const NESTED_AT_RULES = new Set(['media', 'supports', 'container'])
const UI_PSEUDO_CLASSES = new Set(['hover', 'active', 'focus', 'focus-visible', 'focus-within'])

// Paint-only scope for UI roots: chrome must stay reachable so the user can
// always switch custom CSS off, so anything that hides, moves, resizes, or
// stacks the roots is rejected.
const UI_ALLOWED_PROPERTIES = new Set([
  'background',
  'background-attachment',
  'background-blend-mode',
  'background-clip',
  'background-color',
  'background-image',
  'background-origin',
  'background-position',
  'background-position-x',
  'background-position-y',
  'background-repeat',
  'background-size',
  'backdrop-filter',
  'border',
  'border-block-end',
  'border-block-end-color',
  'border-block-end-style',
  'border-block-end-width',
  'border-block-start',
  'border-block-start-color',
  'border-block-start-style',
  'border-block-start-width',
  'border-bottom',
  'border-bottom-color',
  'border-bottom-left-radius',
  'border-bottom-right-radius',
  'border-bottom-style',
  'border-bottom-width',
  'border-color',
  'border-end-end-radius',
  'border-end-start-radius',
  'border-image',
  'border-image-outset',
  'border-image-repeat',
  'border-image-slice',
  'border-image-source',
  'border-image-width',
  'border-inline-end',
  'border-inline-end-color',
  'border-inline-end-style',
  'border-inline-end-width',
  'border-inline-start',
  'border-inline-start-color',
  'border-inline-start-style',
  'border-inline-start-width',
  'border-left',
  'border-left-color',
  'border-left-style',
  'border-left-width',
  'border-radius',
  'border-right',
  'border-right-color',
  'border-right-style',
  'border-right-width',
  'border-start-end-radius',
  'border-start-start-radius',
  'border-style',
  'border-top',
  'border-top-color',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-top-style',
  'border-top-width',
  'border-width',
  'box-shadow',
  'caret-color',
  'color',
  'content',
  'fill',
  'filter',
  'font',
  'font-family',
  'font-size',
  'font-size-adjust',
  'font-stretch',
  'font-style',
  'font-variant',
  'font-weight',
  'letter-spacing',
  'line-height',
  'outline',
  'outline-color',
  'outline-offset',
  'outline-style',
  'outline-width',
  'stroke',
  'text-decoration',
  'text-decoration-color',
  'text-decoration-line',
  'text-decoration-style',
  'text-decoration-thickness',
  'text-shadow',
  'text-transform',
  'word-spacing',
])

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

type TokenType = 'ident' | 'function' | 'at-keyword' | 'string' | 'delim' | 'whitespace'
interface Token {
  type: TokenType
  /** Raw text, escapes unresolved (used to rebuild selector/declaration text) */
  text: string
  /** ident/function/at-keyword name with escapes resolved, lowercased */
  name: string
  line: number
  /** Strings only: the raw text carried escape sequences (dropped from `text`) */
  hasEscape?: boolean
}

class CssParseError extends Error {
  constructor(message: string, readonly line: number) {
    super(message)
  }
}

const IDENT_CHAR = /[a-zA-Z_0-9\u0080-\uFFFF-]/

class Tokenizer {
  private pos = 0
  private line = 1
  constructor(private readonly input: string) {}

  tokenize(): Token[] {
    const tokens: Token[] = []
    while (this.pos < this.input.length) {
      const startLine = this.line
      const ch = this.input[this.pos]
      if (ch === '"' || ch === "'") {
        tokens.push(this.readString(startLine))
        continue
      }
      if (ch === '\\' || IDENT_CHAR.test(ch)) {
        tokens.push(this.readIdentLike(startLine))
        continue
      }
      if (ch === '@') {
        this.pos += 1
        const name = this.peekIdentName()
        if (!name) throw new CssParseError('Unexpected "@"', this.line)
        tokens.push({ type: 'at-keyword', text: '@' + this.readIdentLike(startLine).text, name, line: startLine })
        continue
      }
      if (/\s/.test(ch)) {
        this.pos += 1
        if (ch === '\n') this.line += 1
        if (tokens[tokens.length - 1]?.type !== 'whitespace') {
          tokens.push({ type: 'whitespace', text: ' ', name: '', line: startLine })
        }
        continue
      }
      if (ch === '(' && tokens[tokens.length - 1]?.type === 'ident') {
        const ident = tokens.pop()!
        this.pos += 1
        tokens.push({ type: 'function', text: ident.text + '(', name: ident.name, line: ident.line })
        continue
      }
      tokens.push({ type: 'delim', text: ch, name: '', line: startLine })
      this.pos += 1
    }
    return tokens
  }

  private peekIdentName(): string | null {
    const save = this.pos
    const saveLine = this.line
    let name = ''
    for (;;) {
      const ch = this.input[this.pos]
      if (ch === '\\') {
        const savePos = this.pos
        try {
          name += this.readEscape()
        } catch {
          this.pos = savePos
          break
        }
        continue
      }
      if (IDENT_CHAR.test(ch ?? '')) {
        name += ch
        this.pos += 1
        continue
      }
      break
    }
    this.pos = save
    this.line = saveLine
    return name.length > 0 ? name.toLowerCase() : null
  }

  private readIdentLike(startLine: number): Token {
    let raw = ''
    let name = ''
    for (;;) {
      const ch = this.input[this.pos]
      if (ch === '\\') {
        const start = this.pos
        name += this.readEscape()
        raw += this.input.slice(start, this.pos)
        continue
      }
      if (IDENT_CHAR.test(ch ?? '')) {
        raw += ch
        name += ch
        this.pos += 1
        continue
      }
      break
    }
    return { type: 'ident', text: raw, name: name.toLowerCase(), line: startLine }
  }

  private readEscape(): string {
    const ch = this.input[this.pos + 1]
    if (ch === undefined || ch === '\n') throw new CssParseError('Invalid escape', this.line)
    if (!/[\da-fA-F]/.test(ch)) {
      this.pos += 2
      return ch
    }
    let hex = ''
    let end = this.pos + 1
    while (end < this.input.length && hex.length < 6 && /[\da-fA-F]/.test(this.input[end])) {
      hex += this.input[end]
      end += 1
    }
    if (this.input[end] === '\n') this.line += 1
    if (/\s/.test(this.input[end] ?? '')) end += 1
    this.pos = end
    return String.fromCodePoint(parseInt(hex, 16))
  }

  private readString(startLine: number): Token {
    const quote = this.input[this.pos]
    let raw = quote
    let hasEscape = false
    this.pos += 1
    for (;;) {
      const ch = this.input[this.pos]
      if (ch === undefined) throw new CssParseError('Unterminated string', startLine)
      this.pos += 1
      if (ch === '\\') {
        hasEscape = true
        const next = this.input[this.pos]
        if (next === '\n') {
          this.line += 1
          raw += this.input.slice(this.pos, this.pos + 2)
          this.pos += 2
          continue
        }
        const start = this.pos
        this.readEscape()
        raw += this.input.slice(start, this.pos)
        continue
      }
      raw += ch
      if (ch === '\n') this.line += 1
      if (ch === quote) return { type: 'string', text: raw, name: '', line: startLine, hasEscape }
    }
  }

}

// ---------------------------------------------------------------------------
// Rule tree
// ---------------------------------------------------------------------------

interface Declaration {
  property: string
  rawProperty: string
  valueTokens: Token[]
  line: number
  /** Set when asset resolution dropped this declaration (missing asset) */
  dropped?: boolean
  /** Marked before resolution: the declaration carried a bd-asset url */
  bearsAsset?: boolean
}

interface StyleRule {
  kind: 'style'
  selectorTokens: Token[]
  selectorText: string
  declarations: Declaration[]
  line: number
}

interface AtRule {
  kind: 'at'
  name: string
  preludeText: string
  rules: CssRule[]
  line: number
}

type CssRule = StyleRule | AtRule

function tokensToText(tokens: Token[]): string {
  return tokens.map((t) => (t.type === 'whitespace' ? ' ' : t.text)).join('')
}

class Parser {
  private index = 0
  constructor(private readonly tokens: Token[]) {}

  parseRules(stopAtBrace: boolean, depth = 0): CssRule[] {
    if (depth > MAX_NESTING_DEPTH) throw new CssParseError('CSS nesting is too deep', this.tokens[this.index]?.line ?? 1)
    const rules: CssRule[] = []
    for (;;) {
      this.skipWhitespace()
      if (this.index >= this.tokens.length) {
        if (stopAtBrace) throw new CssParseError('Unclosed block', 1)
        return rules
      }
      const token = this.tokens[this.index]
      if (token.type === 'delim' && token.text === '}') {
        if (!stopAtBrace) throw new CssParseError('Unexpected "}"', token.line)
        return rules
      }
      rules.push(token.type === 'at-keyword' ? this.parseAtRule(token, depth) : this.parseStyleRule(token.line))
    }
  }

  private parseAtRule(start: Token, depth: number): AtRule {
    const prelude: Token[] = []
    this.index += 1
    for (;;) {
      // whitespace is preserved so the prelude rebuilds into valid CSS
      const token = this.tokens[this.index]
      if (!token) throw new CssParseError(`Unclosed @${start.name}`, start.line)
      if (token.type === 'delim' && token.text === '{') break
      if (token.type === 'delim' && token.text === ';') {
        this.index += 1
        // statement at-rules (@import, @font-face is a block, so this only
        // reaches statement forms) are rejected wholesale
        throw new CssParseError(`@${start.name} is not allowed`, start.line)
      }
      prelude.push(token)
      this.index += 1
    }
    if (!NESTED_AT_RULES.has(start.name)) {
      throw new CssParseError(`@${start.name} is not allowed`, start.line)
    }
    assertBalanced(prelude, start.line)
    this.index += 1 // consume '{'
    const rules = this.parseRules(true, depth + 1)
    this.expect('}')
    return { kind: 'at', name: start.name, preludeText: tokensToText(prelude).trim(), rules, line: start.line }
  }

  private parseStyleRule(line: number): StyleRule {
    const selectorTokens = this.parseSelectorTokens()
    if (selectorTokens.length === 0) throw new CssParseError('Empty selector', line)
    assertBalanced(selectorTokens, line)
    this.expect('{')
    const declarations = this.parseDeclarations()
    this.expect('}')
    return { kind: 'style', selectorTokens, selectorText: tokensToText(selectorTokens).trim(), declarations, line }
  }

  private parseSelectorTokens(): Token[] {
    const tokens: Token[] = []
    for (;;) {
      // whitespace is preserved: descendant combinators and subject detection
      // depend on it
      const token = this.tokens[this.index]
      if (!token) throw new CssParseError('Unexpected end of input', 1)
      if (token.type === 'delim' && token.text === '{') return tokens
      if (token.type === 'delim' && (token.text === '}' || token.text === ';')) {
        throw new CssParseError('Selector ended unexpectedly', token.line)
      }
      tokens.push(token)
      this.index += 1
    }
  }

  private parseDeclarations(): Declaration[] {
    const declarations: Declaration[] = []
    let property: Token | null = null
    let valueTokens: Token[] = []
    const flush = () => {
      if (property) {
        assertBalanced(valueTokens, property.line)
        declarations.push({ property: property.name, rawProperty: property.text, valueTokens, line: property.line })
      }
      property = null
      valueTokens = []
    }
    for (;;) {
      // value tokens keep their whitespace so rebuilt text stays faithful
      if (!property) this.skipWhitespace()
      const token = this.tokens[this.index]
      if (!token) throw new CssParseError('Unclosed declaration block', 1)
      // values collect token by token: strings and function names are atomic,
      // so a `;` or `}` inside them can never split the declaration
      if (token.type === 'delim' && token.text === '}') {
        flush()
        return declarations
      }
      if (token.type === 'delim' && token.text === ';') {
        flush()
        this.index += 1
        continue
      }
      if (!property) {
        if (token.type !== 'ident') throw new CssParseError('Expected a property name', token.line)
        property = token
        this.index += 1
        this.skipWhitespace()
        const colon = this.tokens[this.index]
        if (!colon || !(colon.type === 'delim' && colon.text === ':')) {
          throw new CssParseError('Expected ":" after property name', colon?.line ?? token.line)
        }
        this.index += 1
        continue
      }
      valueTokens.push(token)
      this.index += 1
    }
  }

  private expect(text: string): void {
    this.skipWhitespace()
    const token = this.tokens[this.index]
    if (!token || !(token.type === 'delim' && token.text === text)) {
      throw new CssParseError(`Expected "${text}"`, token?.line ?? 1)
    }
    this.index += 1
  }

  private skipWhitespace(): void {
    while (this.tokens[this.index]?.type === 'whitespace') this.index += 1
  }
}

function assertBalanced(tokens: Token[], line: number): void {
  const stack: string[] = []
  for (const token of tokens) {
    if (token.type === 'function') stack.push(')')
    if (token.type !== 'delim') continue
    if (token.text === '(') stack.push(')')
    if (token.text === '[') stack.push(']')
    if (token.text === ')' || token.text === ']') {
      if (stack.pop() !== token.text) throw new CssParseError('Unbalanced CSS', line)
    }
    if (token.text === '{' || token.text === '}') throw new CssParseError('Unexpected brace', line)
  }
  if (stack.length) throw new CssParseError('Unbalanced CSS', line)
}

// ---------------------------------------------------------------------------
// Selector inspection
// ---------------------------------------------------------------------------

/** Split a selector list into complex selectors at top-level commas. */
function splitSelectorList(tokens: Token[]): Token[][] {
  const parts: Token[][] = [[]]
  let depth = 0
  for (const token of tokens) {
    if (token.type === 'delim' && token.text === '[') depth += 1
    else if (token.type === 'delim' && token.text === ']') depth -= 1
    else if (token.type === 'function') depth += 1
    else if (token.type === 'delim' && token.text === ')') depth -= 1
    if (depth === 0 && token.type === 'delim' && token.text === ',') {
      parts.push([])
      continue
    }
    parts[parts.length - 1].push(token)
  }
  return parts.map((part) => {
    const start = part[0]?.type === 'whitespace' ? 1 : 0
    const end = part.at(-1)?.type === 'whitespace' ? part.length - 1 : part.length
    return part.slice(start, end)
  }).filter((part) => part.length > 0)
}

/** The subject (rightmost) compound selector of a complex selector. */
function subjectCompound(tokens: Token[]): Token[] {
  let start = 0
  let depth = 0
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]
    if (token.type === 'delim' && token.text === '[') depth += 1
    else if (token.type === 'delim' && token.text === ']') depth -= 1
    else if (token.type === 'function') depth += 1
    else if (token.type === 'delim' && token.text === ')') depth -= 1
    if (depth !== 0) continue
    if (token.type === 'delim' && (token.text === '>' || token.text === '+' || token.text === '~')) {
      start = i + 1
      continue
    }
    if (token.type === 'whitespace' && i > 0 && i < tokens.length - 1) start = i + 1
  }
  return tokens.slice(start)
}

function compoundMatchesType(tokens: Token[], names: string[]): boolean {
  const first = tokens[0]
  return !!first && first.type === 'ident' && names.includes(first.name)
}

function compoundIsRootPseudo(tokens: Token[]): boolean {
  const [first, second] = tokens
  return !!first && first.type === 'delim' && first.text === ':' && !!second && second.type === 'ident' && second.name === 'root'
}

function isCombinatorDelim(token: Token): boolean {
  return token.type === 'delim' && (token.text === '>' || token.text === '+' || token.text === '~')
}

/**
 * Parse a UI root selector: exactly `[data-bd-ui="…"]` with optional
 * pseudo-classes/elements attached, no combinators or ancestors.
 */
function uiTargetOfSelector(tokens: Token[]): UiCssTarget | null {
  let depth = 0
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]
    if (token.type === 'delim' && token.text === '[') depth += 1
    else if (token.type === 'delim' && token.text === ']') depth -= 1
    else if (token.type === 'function') depth += 1
    else if (token.type === 'delim' && token.text === ')') depth -= 1
    if (depth !== 0) continue
    if (isCombinatorDelim(token)) return null
    if (token.type === 'whitespace' && i > 0 && i < tokens.length - 1) return null
  }
  if (!tokens[0] || !(tokens[0].type === 'delim' && tokens[0].text === '[')) return null
  let text = ''
  let closedAt = -1
  depth = 0
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]
    if (token.type === 'delim' && token.text === '[') depth += 1
    if (depth > 0) text += token.text
    if (token.type === 'delim' && token.text === ']') {
      depth -= 1
      if (depth === 0) {
        closedAt = i
        break
      }
    }
  }
  const match = /^\[\s*data-bd-ui\s*=\s*(?:"([a-z-]+)"|'([a-z-]+)'|([a-z-]+))\s*\]$/.exec(text)
  if (!match) return null
  const value = (match[1] ?? match[2] ?? match[3] ?? '').toLowerCase()
  if (!(UI_CSS_TARGETS as readonly string[]).includes(value)) return null
  const suffix = tokens.slice(closedAt + 1).filter((token) => token.type !== 'whitespace')
  if (suffix.length) {
    const [colon, next, element] = suffix
    if (colon.text !== ':') return null
    const pseudoClass = suffix.length === 2 && next?.type === 'ident' && UI_PSEUDO_CLASSES.has(next.name)
    const pseudoElement = suffix.length === 3 && next?.text === ':' && element?.type === 'ident'
      && (element.name === 'before' || element.name === 'after')
    if (!pseudoClass && !pseudoElement) return null
  }
  return value as UiCssTarget
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

interface AssetUrlMatch {
  argument: number
  id: string
  /** Index just past the closing paren */
  end: number
}

/** Match `url("bd-asset:<id>")` starting at a url( function token. Whitespace
 *  around the argument is tolerated; the id grammar itself is strict (no
 *  escapes — escape bodies are dropped from the token text, so an escaped
 *  string can never resolve to a stable asset id), and obfuscated spellings
 *  cannot slip through. */
function matchAssetUrl(tokens: Token[], start: number): AssetUrlMatch | null {
  let argument = start + 1
  while (tokens[argument]?.type === 'whitespace') argument += 1
  const string = tokens[argument]
  if (!string || string.type !== 'string' || string.hasEscape) return null
  const match = ASSET_URL_PATTERN.exec(string.text)
  if (!match) return null
  let end = argument + 1
  while (tokens[end]?.type === 'whitespace') end += 1
  const close = tokens[end]
  if (!close || !(close.type === 'delim' && close.text === ')')) return null
  return { id: match[2]!, end: end + 1, argument }
}

/**
 * Rewrite `url("bd-asset:<id>")` tokens to their temporary URLs in place and
 * drop declarations whose asset is missing. Runs on the parsed rule tree of
 * already-validated CSS, never on raw text.
 */
function resolveAssetDeclarations(declarations: Declaration[], resolve: (id: string) => string | null): void {
  for (const declaration of declarations) {
    const tokens = declaration.valueTokens
    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i]!
      if (!(token.type === 'function' && token.name === 'url')) continue
      const match = matchAssetUrl(tokens, i)
      if (!match) continue
      const url = resolve(match.id)
      if (url === null) {
        declaration.dropped = true
        break
      }
      const string = tokens[match.argument]!
      tokens[match.argument] = { ...string, text: `"${url}"` }
      i = match.end - 1
    }
  }
}

function declarationBearsAsset(declaration: Declaration): boolean {
  if (declaration.dropped) return false
  const tokens = declaration.valueTokens
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!
    if (token.type === 'function' && token.name === 'url' && matchAssetUrl(tokens, i)) return true
  }
  return false
}

// Comments are stripped before tokenizing (see stripCssComments) so a comment
// inside an identifier (`ur/**/l(`) cannot split one token into two.
function stripCssComments(input: string): string {
  const newline = '\n'
  let out = ''
  let pos = 0
  let line = 1
  while (pos < input.length) {
    const ch = input[pos]
    if (ch === '/' && input[pos + 1] === '*') {
      const end = input.indexOf('*/', pos + 2)
      if (end === -1) throw new CssParseError('Unterminated comment', line)
      for (const c of input.slice(pos, end + 2)) if (c === newline) line += 1
      pos = end + 2
      continue
    }
    if (ch === '"' || ch === "'") {
      const start = pos
      pos += 1
      for (;;) {
        const c = input[pos]
        if (c === undefined) throw new CssParseError('Unterminated string', line)
        if (c === '\\') {
          pos += 2
          continue
        }
        pos += 1
        if (c === ch) break
      }
      out += input.slice(start, pos)
      for (const c of input.slice(start, pos)) if (c === newline) line += 1
      continue
    }
    out += ch
    if (ch === newline) line += 1
    pos += 1
  }
  return out
}

function parseStyleSheet(css: string, issues: CssIssue[]): CssRule[] | null {
  if (css.length > MAX_THEME_CSS_LENGTH) {
    issues.push({ line: 1, message: `CSS exceeds ${MAX_THEME_CSS_LENGTH} characters` })
    return null
  }
  let tokens: Token[]
  try {
    tokens = new Tokenizer(stripCssComments(css)).tokenize()
  } catch (error) {
    issues.push({ line: error instanceof CssParseError ? error.line : 1, message: error instanceof Error ? error.message : 'Invalid CSS' })
    return null
  }
  try {
    return new Parser(tokens).parseRules(false)
  } catch (error) {
    issues.push({ line: error instanceof CssParseError ? error.line : 1, message: error instanceof Error ? error.message : 'Invalid CSS' })
    return null
  }
}

export const THEME_CONTENT_FONT_PROPERTY = '--bd-theme-content-font-family'

function checkDeclarations(declarations: Declaration[], scope: 'content' | 'ui', issues: CssIssue[], assetIds?: ReadonlySet<string>): void {
  for (const declaration of declarations) {
    if (declaration.property === THEME_CONTENT_FONT_PROPERTY) {
      issues.push({ line: declaration.line, message: `Property "${declaration.rawProperty}" is reserved by the reader` })
      continue
    }
    if (scope === 'ui' && !UI_ALLOWED_PROPERTIES.has(declaration.property)) {
      issues.push({ line: declaration.line, message: `Property "${declaration.rawProperty}" is not allowed in UI CSS` })
      continue
    }
    const tokens = declaration.valueTokens
    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i]!
      if (token.type === 'function' && token.name === 'url') {
        // url() opens exactly one resource form; every other payload keeps
        // the phase-2 rejection (external/relative/data:/blob:, escapes)
        const match = matchAssetUrl(tokens, i)
        if (!match) {
          issues.push({ line: token.line, message: `url() may only reference a theme asset: url("${THEME_ASSET_URL_PREFIX}<id>")` })
          break
        }
        if (assetIds && !assetIds.has(match.id)) {
          issues.push({ line: token.line, message: `Unknown theme asset: ${match.id}` })
          break
        }
        i = match.end - 1
        continue
      }
      if (token.type === 'function' && !SAFE_VALUE_FUNCTIONS.has(token.name)) {
        issues.push({ line: token.line, message: `Unsupported CSS function: ${token.name}()` })
        break
      }
    }
  }
}

function declarationText(declaration: Declaration): string {
  return `${declaration.rawProperty}: ${tokensToText(declaration.valueTokens).trim()};`
}

/** Validation pass: syntax, targets, properties, resource values. No text is
 *  built here — compilation happens after asset resolution so resolved URLs
 *  never re-enter validation. */
function checkRules(rules: CssRule[], scope: 'content' | 'ui', issues: CssIssue[], assetIds?: ReadonlySet<string>): void {
  for (const rule of rules) {
    if (rule.kind === 'at') {
      checkRules(rule.rules, scope, issues, assetIds)
      continue
    }
    const selectors = splitSelectorList(rule.selectorTokens)
    checkDeclarations(rule.declarations, scope, issues, assetIds)
    if (scope === 'content') {
      for (const complex of selectors) {
        const subject = subjectCompound(complex)
        if (compoundMatchesType(subject, ['html', 'body']) || compoundIsRootPseudo(subject)) {
          issues.push({ line: rule.line, message: 'html/body belong to the reader and cannot be restyled by content CSS' })
        }
      }
      continue
    }
    for (const complex of selectors) {
      const target = uiTargetOfSelector(complex)
      if (!target) {
        issues.push({ line: rule.line, message: 'UI CSS may only target the [data-bd-ui="…"] roots (header/footer/toolbar/outside), without combinators' })
        break
      }
    }
  }
}

/** Rebuild an injectable rule text (used for the outside-rooted subset). */
function ruleText(rule: StyleRule, selector = rule.selectorText): string {
  const declarations = rule.declarations.map(declarationText).join(' ')
  return `${selector} { ${declarations} }`
}

function restrictSelector(tokens: Token[], restriction: string): string {
  const subject = subjectCompound(tokens)
  const start = tokens.length - subject.length
  let depth = 0
  for (let i = start; i < tokens.length; i += 1) {
    const token = tokens[i]!
    if (token.type === 'function' || token.text === '[') depth += 1
    if (token.text === ')' || token.text === ']') depth -= 1
    if (depth !== 0 || token.text !== ':') continue
    const next = tokens[i + 1]
    if (next?.text === ':' || (next?.type === 'ident' && ['before', 'after', 'first-line', 'first-letter'].includes(next.name))) {
      return `${tokensToText(tokens.slice(0, i))}${restriction}${tokensToText(tokens.slice(i)).trimEnd()}`
    }
  }
  return `${tokensToText(tokens).trim()}${restriction}`
}

/** Rebuild a validated outside selector against the shadow decoration
 *  surface, preserving the optional pseudo suffix (`::after` etc.). */
function decorationSelectorOf(tokens: Token[], target: string): string {
  let depth = 0
  let closedAt = -1
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!
    if (token.type === 'delim' && token.text === '[') depth += 1
    if (token.type === 'delim' && token.text === ']') {
      depth -= 1
      if (depth === 0) {
        closedAt = i
        break
      }
    }
  }
  const suffix = tokensToText(tokens.slice(closedAt + 1).filter((token) => token.type !== 'whitespace')).trim()
  return suffix ? `${target}${suffix}` : target
}

interface CompiledUi {
  /** Outside-rooted rules for the section-canvas mirror */
  compiled: string[]
  /** All rules scoped to the live reader root */
  hostRules: string[]
  /** Image-bearing outside rules for the viewport-fixed decoration surface */
  decorationRules: string[]
}

/** Compilation pass: runs after validation (and asset resolution), rebuilds
 *  injectable text from the parsed tokens. */
function compileRules(rules: CssRule[], scope: 'content' | 'ui', decorationTarget?: string): string[] | CompiledUi {
  if (scope === 'content') {
    const compiled: string[] = []
    for (const rule of rules) {
      if (rule.kind === 'at') {
        const nested = compileRules(rule.rules, scope) as string[]
        if (nested.length) compiled.push(`@${rule.name} ${rule.preludeText} { ${nested.join('\n')} }`)
        continue
      }
      const declarations = rule.declarations.filter((declaration) => !declaration.dropped).flatMap((declaration) =>
        declaration.property === 'font-family'
          ? [declaration, { ...declaration, property: THEME_CONTENT_FONT_PROPERTY, rawProperty: THEME_CONTENT_FONT_PROPERTY }]
          : [declaration],
      )
      if (!declarations.length && rule.declarations.length) continue
      const selectors = splitSelectorList(rule.selectorTokens)
      compiled.push(ruleText({ ...rule, declarations }, selectors.map((selector) => restrictSelector(selector, ':where(body *)')).join(', ')))
    }
    return compiled
  }
  const result: CompiledUi = { compiled: [], hostRules: [], decorationRules: [] }
  for (const rule of rules) {
    if (rule.kind === 'at') {
      const nested = compileRules(rule.rules, scope, decorationTarget) as CompiledUi
      if (nested.compiled.length) result.compiled.push(`@${rule.name} ${rule.preludeText} { ${nested.compiled.join('\n')} }`)
      if (nested.hostRules.length) result.hostRules.push(`@${rule.name} ${rule.preludeText} { ${nested.hostRules.join('\n')} }`)
      if (nested.decorationRules.length) result.decorationRules.push(`@${rule.name} ${rule.preludeText} { ${nested.decorationRules.join('\n')} }`)
      continue
    }
    const declarations = rule.declarations.filter((declaration) => !declaration.dropped)
    const fullyDropped = rule.declarations.length > 0 && declarations.length === 0
    if (fullyDropped) continue
    const selectors = splitSelectorList(rule.selectorTokens)
    const outside = selectors.filter((selector) => uiTargetOfSelector(selector) === 'outside')
    const decorated = outside.length > 0 && declarations.some((declaration) => declaration.bearsAsset)
    const effective = { ...rule, declarations }
    const host = decorated ? selectors.filter((selector) => uiTargetOfSelector(selector) !== 'outside') : selectors
    if (decorated) {
      result.decorationRules.push(ruleText(effective, outside.map((selector) => decorationSelectorOf(selector, decorationTarget ?? UI_DECORATION_TARGET)).join(', ')))
    } else if (outside.length) {
      result.compiled.push(ruleText(effective, outside.map((selector) => tokensToText(selector).trim()).join(', ')))
    }
    if (host.length) {
      result.hostRules.push(ruleText(effective, host.map((selector) => decorationTarget
        ? tokensToText(selector).trim()
        : restrictSelector(selector, ':where([data-bd-user-ui-root], [data-bd-user-ui-root] *)')).join(', ')))
    }
  }
  return result
}

/** Rebuild the author-form stylesheet from the (possibly resolved) tokens. */
function rebuildSheet(rules: CssRule[]): string {
  const out: string[] = []
  for (const rule of rules) {
    if (rule.kind === 'at') {
      const nested = rebuildSheet(rule.rules)
      if (nested) out.push(`@${rule.name} ${rule.preludeText} { ${nested} }`)
      continue
    }
    out.push(ruleText(rule))
  }
  return out.join('\n')
}

function resolveAssetRules(rules: CssRule[], resolve: (id: string) => string | null): void {
  for (const rule of rules) {
    if (rule.kind === 'at') {
      resolveAssetRules(rule.rules, resolve)
      continue
    }
    resolveAssetDeclarations(rule.declarations, resolve)
  }
}

/** Classify declarations before resolution rewrites their url tokens away. */
function markAssetBearingDeclarations(rules: CssRule[]): void {
  for (const rule of rules) {
    if (rule.kind === 'at') {
      markAssetBearingDeclarations(rule.rules)
      continue
    }
    for (const declaration of rule.declarations) declaration.bearsAsset = declarationBearsAsset(declaration)
  }
}

export function validateContentCss(rawCss: string, assetCtx?: CssAssetContext): ContentCssValidation {
  const trimmed = rawCss.trim()
  if (!trimmed) return { ok: true, css: '', scopedCss: '', issues: [] }
  const issues: CssIssue[] = []
  const rules = parseStyleSheet(trimmed, issues)
  if (rules) {
    checkRules(rules, 'content', issues, assetCtx?.ids)
    if (!issues.length && assetCtx?.resolve) resolveAssetRules(rules, assetCtx.resolve)
  }
  const ok = issues.length === 0
  const compiled = rules && ok ? compileRules(rules, 'content') as string[] : []
  return { ok, css: ok ? trimmed : '', scopedCss: ok ? compiled.join('\n') : '', issues }
}

export function validateUiCss(rawCss: string, assetCtx?: CssAssetContext): UiCssValidation {
  const trimmed = rawCss.trim()
  if (!trimmed) return { ok: true, css: '', resolvedCss: '', hostCss: '', outsideCss: '', decorationCss: '', issues: [] }
  const issues: CssIssue[] = []
  const rules = parseStyleSheet(trimmed, issues)
  let compiled: CompiledUi = { compiled: [], hostRules: [], decorationRules: [] }
  let resolvedCss = ''
  if (rules) {
    checkRules(rules, 'ui', issues, assetCtx?.ids)
    if (!issues.length) {
      markAssetBearingDeclarations(rules)
      if (assetCtx?.resolve) resolveAssetRules(rules, assetCtx.resolve)
      compiled = compileRules(rules, 'ui', assetCtx?.decorationTarget) as CompiledUi
      resolvedCss = assetCtx?.decorationTarget
        ? compiled.hostRules.join('\n')
        : rebuildSheet(rules)
    }
  }
  const ok = issues.length === 0
  return {
    ok,
    css: ok ? trimmed : '',
    resolvedCss: ok ? resolvedCss : '',
    hostCss: ok ? compiled.hostRules.join('\n') : '',
    outsideCss: ok ? compiled.compiled.join('\n') : '',
    decorationCss: ok ? compiled.decorationRules.join('\n') : '',
    issues,
  }
}

/** Remap validated author-form CSS when importing a portable theme. */
export function remapCssAssetRefs(css: string, ids: ReadonlyMap<string, string>): string {
  const rules = parseStyleSheet(css, [])
  if (!rules) return css
  resolveAssetRules(rules, (id) => `${THEME_ASSET_URL_PREFIX}${ids.get(id) ?? id}`)
  return rebuildSheet(rules)
}

/**
 * Asset ids referenced by a stylesheet's `url("bd-asset:<id>")` forms.
 * Parse-based (never a string scan over raw text); unparseable CSS yields no
 * refs — callers treat that as "nothing referenced", never as "all missing".
 */
export function collectCssAssetRefs(rawCss: string): string[] {
  return [...new Set(cssAssetLocations(rawCss).map(({ id }) => id))]
}

export function cssAssetLocations(rawCss: string): Array<{ id: string; line: number }> {
  if (!rawCss.trim()) return []
  const issues: CssIssue[] = []
  const rules = parseStyleSheet(rawCss, issues)
  if (!rules) return []
  const locations: Array<{ id: string; line: number }> = []
  const walk = (rules: CssRule[]): void => {
    for (const rule of rules) {
      if (rule.kind === 'at') {
        walk(rule.rules)
        continue
      }
      for (const declaration of rule.declarations) {
        const tokens = declaration.valueTokens
        for (let i = 0; i < tokens.length; i += 1) {
          const token = tokens[i]!
          if (token.type === 'function' && token.name === 'url') {
            const match = matchAssetUrl(tokens, i)
            if (match) {
              locations.push({ id: match.id, line: token.line })
              i = match.end - 1
            }
          }
        }
      }
    }
  }
  walk(rules)
  return locations
}

// ---------------------------------------------------------------------------
// Phase-5 font references
// ---------------------------------------------------------------------------

/**
 * Font references are author-form `font-family: "bd-font:<fontId>"` family
 * strings. They are ordinary quoted strings to the validator (never resource
 * values), so `@import`/`@font-face`/`url()` stay rejected and a theme can
 * only name a face the font library already owns.
 */
export const THEME_FONT_REF_PREFIX = 'bd-font:'

function fontRefIdOf(token: Token | undefined): string | null {
  if (!token || token.type !== 'string') return null
  const value = token.text.replace(/^['"]|['"]$/g, '')
  if (!value.startsWith(THEME_FONT_REF_PREFIX)) return null
  const id = value.slice(THEME_FONT_REF_PREFIX.length).trim()
  return id ? id : null
}

function isFontFamilyDeclaration(declaration: Declaration): boolean {
  return !declaration.dropped
    && (declaration.property === 'font-family' || declaration.property === THEME_CONTENT_FONT_PROPERTY)
}

function walkFontDeclarations(rules: CssRule[], visit: (declaration: Declaration) => void): void {
  for (const rule of rules) {
    if (rule.kind === 'at') {
      walkFontDeclarations(rule.rules, visit)
      continue
    }
    for (const declaration of rule.declarations) {
      if (isFontFamilyDeclaration(declaration)) visit(declaration)
    }
  }
}

/** Font ids a stylesheet references through the author-form `bd-font:` token. */
export function collectThemeFontRefs(rawCss: string): string[] {
  if (!rawCss.trim()) return []
  const rules = parseStyleSheet(rawCss, [])
  if (!rules) return []
  const ids: string[] = []
  walkFontDeclarations(rules, (declaration) => {
    for (const token of declaration.valueTokens) {
      const id = fontRefIdOf(token)
      if (id && !ids.includes(id)) ids.push(id)
    }
  })
  return ids
}

/**
 * Rewrite known font references to their ready-to-use family stack. Unknown
 * ids are left untouched on purpose: they stay an unknown family name and the
 * declaration falls through to the author's own fallback chain, so a deleted
 * font or a face that lives on another device never breaks the stylesheet.
 */
export function rewriteThemeFontRefs(rawCss: string, stacks: ReadonlyMap<string, string>): string {
  if (!rawCss.trim() || !stacks.size) return rawCss
  const rules = parseStyleSheet(rawCss, [])
  if (!rules) return rawCss
  let changed = false
  walkFontDeclarations(rules, (declaration) => {
    declaration.valueTokens = declaration.valueTokens.flatMap((token) => {
      const id = fontRefIdOf(token)
      const stack = id ? stacks.get(id) : undefined
      if (!stack) return [token]
      changed = true
      // `stack` is a validated catalog value (family names + generic keywords),
      // never author text: it is spliced in as raw declaration text.
      return [{ ...token, type: 'ident' as const, text: stack, name: stack.toLowerCase(), hasEscape: false }]
    })
  })
  return changed ? rebuildSheet(rules) : rawCss
}

/**
 * Ingest-side sanitizer for stored/synced theme CSS (same leniency as the
 * dual colors): an absent field stays undefined, an invalid or oversized block
 * is dropped to '' so a bad value can never half-apply. The kind decides which
 * validator runs, so saving, preview and loading share one rule set.
 */
export function sanitizeThemeCssField(value: unknown, kind: 'content' | 'ui'): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_THEME_CSS_LENGTH) return ''
  const result = kind === 'content' ? validateContentCss(value) : validateUiCss(value)
  return result.ok ? result.css : ''
}
