// The Kindle browser lacks these APIs used by Foliate and the reader UI.
const arrayPrototype = Array.prototype as any
if (!arrayPrototype.at) {
  arrayPrototype.at = function (index: number) {
    const offset = Math.trunc(index) || 0
    const actual = offset < 0 ? this.length + offset : offset
    return this[actual]
  }
}
if (!arrayPrototype.findLastIndex) {
  arrayPrototype.findLastIndex = function (predicate: (value: any, index: number, array: any[]) => boolean, thisArg?: any) {
    for (let index = this.length - 1; index >= 0; index--) {
      if (predicate.call(thisArg, this[index], index, this)) return index
    }
    return -1
  }
}
if (!Element.prototype.replaceChildren) {
  Element.prototype.replaceChildren = function (...nodes: (Node | string)[]) {
    while (this.firstChild) this.removeChild(this.firstChild)
    this.append(...nodes)
  }
}

const objectConstructor = Object as any
if (!objectConstructor.groupBy) {
  objectConstructor.groupBy = function (items: Iterable<any>, keyFor: (item: any, index: number) => PropertyKey) {
    const groups = Object.create(null)
    let index = 0
    for (const item of items) {
      const key = keyFor(item, index++)
      if (!Object.prototype.hasOwnProperty.call(groups, key)) groups[key] = []
      groups[key].push(item)
    }
    return groups
  }
}

const mapConstructor = Map as any
if (!mapConstructor.groupBy) {
  mapConstructor.groupBy = function (items: Iterable<any>, keyFor: (item: any, index: number) => unknown) {
    const groups = new Map<unknown, any[]>()
    let index = 0
    for (const item of items) {
      const key = keyFor(item, index++)
      const group = groups.get(key)
      if (group) group.push(item)
      else groups.set(key, [item])
    }
    return groups
  }
}

const stringPrototype = String.prototype as any
if (!stringPrototype.matchAll) {
  stringPrototype.matchAll = function (pattern: RegExp) {
    if (!pattern.global) throw new TypeError('matchAll requires a global regular expression')
    const text = String(this)
    const expression = new RegExp(pattern.source, pattern.flags)
    expression.lastIndex = pattern.lastIndex
    return (function* () {
      let match: RegExpExecArray | null
      while ((match = expression.exec(text)) !== null) {
        yield match
        if (match[0] === '') {
          const position = expression.lastIndex
          const first = text.charCodeAt(position)
          const second = text.charCodeAt(position + 1)
          const surrogate = expression.unicode && first >= 0xd800 && first <= 0xdbff && second >= 0xdc00 && second <= 0xdfff
          expression.lastIndex += surrogate ? 2 : 1
        }
      }
    })()
  }
}
if (!stringPrototype.replaceAll) {
  stringPrototype.replaceAll = function (search: string | RegExp, replacement: string) {
    if (search instanceof RegExp && !search.global) throw new TypeError('replaceAll requires a global regular expression')
    const expression = search instanceof RegExp ? search : new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
    return String(this).replace(expression, replacement)
  }
}
