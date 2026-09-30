import { extractVersionNameFromFileName, VERSION_NAME_BLACKLIST } from '@bookdock/shared'

// Filename-to-metadata normalization for fields missing from the book file.
// Deliberately conservative: every rule whitelists known noise so a clean
// filename passes through untouched.

const MAX_TITLE_LENGTH = 120

// A bracket is noise only when its whole content is made of edition chatter
// or chapter/word count progress tags.
// Morphemes concatenate, so 精校版全本 / 完结+番外 qualify while anything
// containing an unlisted character (明朝那些事儿, 校对：某某) survives.
const NOISE_MORPHEMES = /^(?:精校|精排|精编|校对|校订|校注|修订|注释|评点|插图|完整|全本|完本|全集|全套|合集|套装|系列|番外|完结|未完结|未完|连载中|连载|更新中|断更|暂停|暂完|待续|太监|已完结|已完|全文|纯净|净化|未删减|无删减|未删节|删节|分卷|全卷|无广告|广告|电子书|网络|扫描|简体|繁体|中英|双语|高清|超清|试读|免费|最终|最新|正版|合订|上册|下册|中册|上下册|无障碍|ocr|txt|epub|mobi|azw3|pdf|word|excel|beta|alpha|v(?:ol(?:ume)?)?\.?\d+(?:\.\d+)*|\d+(?:\.\d+)+|\d+[kmgt]b|版|本|全|完|册)*$/i

const CHAPTER_PROGRESS_BRACKET = /^(?:第?\s*\d+\s*[-~～至到—–_]\s*第?\s*\d+\s*[章节回集]?(?:\s*(?:完结|未完结|全本|完|已完结|全))?|(?:更新至|连载至|更新到|连载到|至|到)\s*第?\s*\d+\s*[章节回集]?|(?:全|共)\s*\d+\s*[章节回集]|\d+\s*[章节回集]|\d+(?:\.\d+)?\s*[万千]?字(?:\s*(?:完结|全本|完|已完结))?)$/i

const BRACKET = /\s*[（(【[［{｛]([^()（）【[\]］}｝]{0,24})[）)】\]］}｝]/g

const SITE_DOMAIN_SUFFIX = /\s*[-_－—–]+\s*(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+\s*$/i
const SITE_CN_SUFFIX = /\s*[-_－—–]+\s*[^\s-_－—–]{0,14}(?:笔趣阁|顶点小说|极点中文|纵横中文|起点中文|晋江文学|海棠文学|书旗小说|txt下载|电子书下载|全文下载|网盘分享|百度云盘|阿里云盘|资源下载)[^\s-_－—–]{0,14}\s*$/

// Colon form is unambiguous anywhere; the loose form requires a visible
// separator so titles that merely contain "作者" survive.
// A name character: letters, numbers, Han characters, middle dots, periods, apostrophes.
// Excludes brackets, punctuation, colons, slashes, ampersands, hyphens/dashes.
const NAME_CHAR = '[^\\s，,。、；;：:（()）【】［］《》\\[\\]{}｛｝/／&＆\\-_－—–]'
// Internal whitespace is allowed between words in a name (e.g. English first & last names).
const SINGLE_NAME = `${NAME_CHAR}+(?:\\s+${NAME_CHAR}+)*`
const AUTHOR_SEP = '(?:\\s*(?:[、/／&＆]|\\band\\b|[,，])\\s*)'
const MULTI_AUTHORS = `${SINGLE_NAME}(?:${AUTHOR_SEP}${SINGLE_NAME})*`

const AUTHOR_COLON = new RegExp(`作\\s*者\\s*[:：]\\s*(${MULTI_AUTHORS})`, 'i')
const AUTHOR_LABEL = new RegExp(`(?:^|[\\s\\-_－—–、，,。（(【《[［{｛])\\s*(?:作\\s*者|by)\\s+(${MULTI_AUTHORS})(?=$|[\\s\\-_－—–、，,。；;：:。）)】》\\]］}｝（(【[［{｛])`, 'i')

const ZHU_CHINESE_SINGLE = '[\\u4e00-\\u9fa5·]{2,6}'
const ZHU_NAME = '(?:[\\u4e00-\\u9fa5·]{2,12}|[a-zA-Z.\\s\'-]+)'
const ZHU_MULTI = `${ZHU_NAME}(?:${AUTHOR_SEP}${ZHU_NAME})+`
const AUTHOR_TRAILING_ZHU = new RegExp(`(?:(${ZHU_MULTI})|(${ZHU_CHINESE_SINGLE}))\\s*著\\s*(?:[（(【]\\s*\\d{4}\\s*[)）】])?\\s*$`, 'i')

function isNoiseBracket(inner: string): boolean {
  const trimmed = inner.trim()
  if (!trimmed) return true
  if (CHAPTER_PROGRESS_BRACKET.test(trimmed)) return true

  const cleaned = trimmed.replace(/[\s\-_/＋+&＆、·]+/g, '')
  if (cleaned === '' || NOISE_MORPHEMES.test(cleaned)) return true

  const parts = trimmed.split(/[\s\-_/＋+&＆、·]+/).filter(Boolean)
  if (parts.length > 1 && parts.every((p) => CHAPTER_PROGRESS_BRACKET.test(p) || NOISE_MORPHEMES.test(p))) {
    return true
  }

  return false
}

function isValidAuthorCandidate(str: string): boolean {
  if (!str || str.length > 40) return false
  // Skip volume / chapter / progress terms
  if (/^(?:第?\s*\d+\s*[章节回卷册部集期话]|全[一二三四五六七八九十\d]+[卷册部集])/i.test(str)) return false
  // Skip publisher / studio / platform / category suffix
  if (/(?:出版社|书店|文库|工作室|公司|小说网|中文网|文学城|论坛|贴吧|制作组|汉化组|整理|校对|排版|推荐|点评|导读|分卷|合集|系列)$/i.test(str)) return false
  // Skip purely digits or punctuation
  if (/^[\d\s\-_.]+$/.test(str)) return false
  return true
}

export function cleanAuthor(raw: string): string {
  return raw
    .replace(/^[\s\-_－—–·、，,。；;：:.[\]（()）【】［］{}｛｝]+|[\s\-_－—–·、，,。；;：:.[\]（()）【】［］{}｛｝]+$/g, '')
    .trim()
}

export function splitAuthors(raw: string): string[] {
  const cleaned = cleanAuthor(raw)
  if (!cleaned) return []
  const parts = cleaned
    .split(/\s*(?:[、/／&＆]|(?:\s+and\s+)|\s*[,，]\s*)\s*/i)
    .map((p) => cleanAuthor(p))
    .filter(Boolean)
  return [...new Set(parts)].slice(0, 10)
}

export function normalizeBookTitle(fileName: string): { title: string; author?: string; authors?: string[]; versionName?: string } {
  let base = fileName.replace(/\.[^.]+$/, '')
  let authorRaw: string | undefined

  const versionName = extractVersionNameFromFileName(fileName)

  const labelMatch = base.match(AUTHOR_COLON) ?? base.match(AUTHOR_LABEL)
  const zhuMatch = base.match(AUTHOR_TRAILING_ZHU)
  if (labelMatch?.[1] && labelMatch.index !== undefined) {
    authorRaw = labelMatch[1]
    base = base.slice(0, labelMatch.index) + base.slice(labelMatch.index + labelMatch[0].length)
  } else if ((zhuMatch?.[1] || zhuMatch?.[2]) && zhuMatch.index !== undefined) {
    authorRaw = zhuMatch[1] || zhuMatch[2]
    base = base.slice(0, zhuMatch.index)
  }

  for (;;) {
    const next = base.replace(SITE_DOMAIN_SUFFIX, '').replace(SITE_CN_SUFFIX, '')
    if (next === base) break
    base = next
  }

  const angleMatches = Array.from(base.matchAll(/《([^》]{1,200})》/g))
  if (angleMatches.length === 1) {
    const match = angleMatches[0]!
    const titleCandidate = match[1].trim()

    if (!authorRaw && match.index !== undefined) {
      const before = base.slice(0, match.index)
      const after = base.slice(match.index + match[0].length)

      const cleanCandidate = (fragment: string): string => {
        return fragment
          .replace(BRACKET, (whole, inner: string) => (isNoiseBracket(inner) || extractVersionNameFromFileName(whole) || VERSION_NAME_BLACKLIST.test(inner) ? '' : whole))
          .replace(/^[\s\-_－—–·、，,。；;：:.[\]（()）【】［］{}｛｝]+|[\s\-_－—–·、，,。；;：:.[\]（()）【】［］{}｛｝]+$/g, '')
          .trim()
      }

      const beforeClean = cleanCandidate(before)
      const afterClean = cleanCandidate(after)

      if (afterClean && isValidAuthorCandidate(afterClean)) {
        authorRaw = afterClean
      } else if (beforeClean && isValidAuthorCandidate(beforeClean)) {
        authorRaw = beforeClean
      }
    }

    base = titleCandidate
  } else {
    base = base.replace(BRACKET, (whole, inner: string) => (isNoiseBracket(inner) ? '' : whole))
    base = base.replace(/[《》]/g, '')
  }

  base = base
    .replace(/^[\s\-_－—–·、，,。；;：:.]+|[\s\-_－—–·、，,。；;：:.]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, MAX_TITLE_LENGTH)

  const authors = authorRaw ? splitAuthors(authorRaw) : []
  const author = authors[0]

  return {
    title: base,
    ...(author ? { author } : {}),
    ...(authors.length > 0 ? { authors } : {}),
    ...(versionName ? { versionName } : {}),
  }
}
