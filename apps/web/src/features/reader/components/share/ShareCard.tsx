import type { Ref } from 'react'

import { QuoteLeftIcon } from '../annotation-icons'
import { cardColors, type CardColors, type ShareCardBackground, type ShareCardBrand, type ShareCardTemplate } from './card-prefs'
import {
  NOTE_MAX_CHARS,
  QUOTE_MAX_CHARS,
  calendarDateParts,
  excerptParagraphs,
  excerptTypography,
  truncateExcerpt,
} from './share-text'

export const SHARE_CARD_WIDTH = 500

interface ShareCardProps {
  text: string
  title: string
  author: string
  chapter: string | null
  template?: ShareCardTemplate
  /** Pre-resolved CSS font stack (registry lookup lives in the dialog layer);
   *  undefined falls back to the browser default serif */
  fontStack?: string
  background?: ShareCardBackground
  /** Footer brand zone; 'off' hides it entirely */
  brand?: ShareCardBrand
  /** Idea (想法) sharing: the user's note becomes the card body and the excerpt
   *  drops to a small quote; absent for plain excerpt sharing */
  note?: string
  /** Identity rows for idea cards: author name + preformatted "写于 …" lines.
   *  `writtenAtCn` (Chinese numerals) is used by the ink template */
  authorName?: string
  /** Resolved avatar image URL for idea cards; absent falls back to the first-char circle */
  avatarUrl?: string
  writtenAt?: string
  writtenAtCn?: string
  /** Points at the untransformed card node — the export target for html-to-image */
  ref?: Ref<HTMLDivElement>
}

/** Body typography: uses dynamic font size, line-height and letter-spacing with CJK justification,
 *  anti-orphan formatting (text-wrap: pretty), strict punctuation line-breaking and punctuation compression */
function Body({
  paragraphs,
  fontSize,
  lineHeight,
  letterSpacing,
  center,
}: {
  paragraphs: string[]
  fontSize: number
  lineHeight?: number
  letterSpacing?: string
  center?: boolean
}) {
  return (
    <div
      style={{ fontSize, lineHeight: lineHeight ?? 1.8, letterSpacing }}
      className={`[text-wrap:pretty] [overflow-wrap:break-word] [line-break:strict] [font-feature-settings:'halt','chws'] ${
        center ? 'text-center' : 'text-justify'
      }`}
    >
      {paragraphs.map((p, i) => (
        <p key={i} style={i > 0 ? { marginTop: '0.85em' } : undefined}>
          {p}
        </p>
      ))}
    </div>
  )
}

function QuoteBlock({ quote, colors, center }: { quote: string; colors: CardColors; center?: boolean }) {
  return (
    <div className={`mt-10 w-full ${center ? 'flex flex-col items-center text-center' : 'text-left'}`}>
      <span aria-hidden style={{ color: colors.watermark }}>
        <QuoteLeftIcon height={22} />
      </span>
      <p className="mt-4 whitespace-pre-wrap text-lg [text-wrap:pretty]" style={{ color: colors.sub, lineHeight: 1.7 }}>
        {quote}
      </p>
    </div>
  )
}

/** The plain variant (ink/brocade idea cards) drops the avatar per the
 *  reference shots. `stacked` puts the avatar on its own row above the name
 *  (classic idea card); without an avatarUrl the first-char circle is shown */
function IdentityHeader({ authorName, avatarUrl, writtenAt, colors, avatar = true, stacked }: { authorName?: string; avatarUrl?: string; writtenAt?: string; colors: CardColors; avatar?: boolean; stacked?: boolean }) {
  if (!avatar) {
    return (
      <div>
        <p className="text-2xl font-semibold">{authorName}</p>
        {writtenAt && <p className="mt-3 text-base opacity-75" style={{ color: colors.sub }}>{writtenAt}</p>}
      </div>
    )
  }
  const circle = avatarUrl ? (
    <img src={avatarUrl} alt={authorName ?? ''} className="h-12 w-12 shrink-0 rounded-full object-cover" />
  ) : (
    <span
      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-lg font-medium"
      style={{ background: `${colors.watermark}35`, color: colors.text }}
    >
      {[...(authorName ?? '')][0] ?? ''}
    </span>
  )
  if (stacked) {
    return (
      <div data-identity="stacked">
        {circle}
        <p className="mt-4 text-2xl font-semibold">{authorName}</p>
        {writtenAt && <p className="mt-2 text-base opacity-75" style={{ color: colors.sub }}>{writtenAt}</p>}
      </div>
    )
  }
  return (
    <div className="flex items-center gap-3.5">
      {circle}
      <div>
        <p className="text-xl font-semibold">{authorName}</p>
        {writtenAt && <p className="mt-1 text-sm opacity-75" style={{ color: colors.sub }}>{writtenAt}</p>}
      </div>
    </div>
  )
}

function Divider({ colors, className = '' }: { colors: CardColors; className?: string }) {
  return <div className={`h-px w-full ${className}`} style={{ background: `${colors.watermark}60` }} />
}

function BrandMark({ brand, colors, align = 'right' }: { brand: ShareCardBrand; colors: CardColors; align?: 'left' | 'center' | 'right' }) {
  if (brand === 'off') return null
  const alignClass = align === 'center' ? 'text-center' : align === 'left' ? 'text-left' : 'text-right'
  return (
    <p
      translate="no"
      className={`notranslate mt-6 w-full text-xs font-mono tracking-[0.2em] uppercase opacity-75 ${alignClass}`}
      style={{ color: colors.watermark }}
    >
      {brand === 'zh' ? '书坞' : 'Bookdock'}
    </p>
  )
}

function SealMark({ text }: { text?: string }) {
  if (!text) return null
  const chars = [...text.trim()].slice(0, 2).join('')
  if (!chars) return null
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-[2px] border border-[#a12822] bg-[#be3730] px-1 py-1 text-[11px] font-medium leading-none text-[#fffbf0] opacity-90 shadow-xs select-none"
      style={{ writingMode: 'vertical-rl', letterSpacing: '0.08em' }}
    >
      {chars}
    </span>
  )
}

function InkBar({ colors, className = '' }: { colors: CardColors; className?: string }) {
  const nick = (x: number, y: number, r: number) =>
    `radial-gradient(circle ${r}px at ${x}% ${y}%, ${colors.bg} 60%, transparent 70%)`
  return (
    <div
      className={`h-2 rounded-full ${className}`}
      style={{
        backgroundColor: colors.accent,
        maskImage: 'linear-gradient(to right, transparent, black 10px, black calc(100% - 10px), transparent)',
        WebkitMaskImage: 'linear-gradient(to right, transparent, black 10px, black calc(100% - 10px), transparent)',
        backgroundImage: [
          nick(4, 20, 1.5), nick(9, 80, 1), nick(15, 45, 2), nick(21, 10, 1),
          nick(27, 60, 1.5), nick(33, 90, 1), nick(39, 30, 2), nick(46, 70, 1),
          nick(52, 15, 1.5), nick(58, 50, 1), nick(64, 85, 2), nick(70, 35, 1.5),
          nick(76, 65, 1), nick(82, 20, 2), nick(88, 55, 1.5), nick(94, 80, 1),
        ].join(','),
      }}
    />
  )
}

function VerticalTitle({
  title,
  author,
  colors,
  seal = false,
}: {
  title: string
  author: string
  colors: CardColors
  seal?: boolean
}) {
  return (
    <div className="flex items-start gap-5 self-start">
      <p
        className="overflow-hidden font-semibold tracking-widest"
        style={{ writingMode: 'vertical-rl', fontSize: 38, maxHeight: 400 }}
      >
        {title}
      </p>
      {(author || seal) && (
        <div className="flex flex-col items-center gap-2.5">
          {author && (
            <p className="text-base tracking-widest opacity-80" style={{ color: colors.sub, writingMode: 'vertical-rl' }}>
              {author}
            </p>
          )}
          {seal && <SealMark text={author || '书坞'} />}
        </div>
      )}
    </div>
  )
}

function TitleChapterAttribution({
  title,
  chapter,
  author,
  colors,
  align = 'left',
}: {
  title: string
  chapter: string | null
  author: string
  colors: CardColors
  align?: 'left' | 'center'
}) {
  const alignClass = align === 'center' ? 'text-center' : 'text-left'
  return (
    <div className={`mt-8 ${alignClass}`}>
      <p className="text-base font-medium tracking-wide" style={{ color: colors.text }}>
        {title}
        {chapter && <span className="font-normal opacity-75"> · {chapter}</span>}
      </p>
      {author && (
        <p className="mt-1.5 text-xs tracking-wider opacity-65" style={{ color: colors.sub }}>
          {author}
        </p>
      )}
    </div>
  )
}

/** The exportable excerpt card. Visuals are self-contained: template / font /
 *  background come from share-card prefs, independent of the reading/UI theme,
 *  so the PNG matches what users see in the preview. */
export default function ShareCard({
  text,
  title,
  author,
  chapter,
  template = 'classic',
  fontStack,
  background = 'cream',
  brand = 'en',
  note,
  authorName,
  avatarUrl,
  writtenAt,
  writtenAtCn,
  ref,
}: ShareCardProps) {
  const colors = cardColors(background)
  const isIdea = !!note
  const body = note ?? text
  const paragraphs = excerptParagraphs(truncateExcerpt(body, isIdea ? NOTE_MAX_CHARS : undefined))
  const typo = excerptTypography([...body].length)
  const ideaBoost = template === 'ink' || template === 'brocade' ? 2 : template === 'classic' ? 0 : 1
  const fontSize = typo.fontSize + (isIdea ? ideaBoost : 0)
  const lineHeight = typo.lineHeight
  const letterSpacing = typo.letterSpacing
  const quote = isIdea && text ? truncateExcerpt(text, QUOTE_MAX_CHARS) : null

  return (
    <div
      ref={ref}
      data-template={template}
      data-kind={isIdea ? 'idea' : 'excerpt'}
      style={{ width: SHARE_CARD_WIDTH, background: colors.bg, color: colors.text, fontFamily: fontStack }}
      className={`box-border flex min-h-[380px] flex-col justify-between rounded-2xl shadow-xl antialiased ${
        template === 'letter' ? 'p-6'
        : template === 'brocade' ? 'px-13 py-14'
        : template === 'ink' ? 'px-10 py-14'
        : template === 'calendar' ? 'px-12 py-16'
        : 'px-11 py-14'
      }`}
    >
      {template === 'classic' && (
        <>
          <div>
            {isIdea && (
              <div className="mb-10">
                <IdentityHeader authorName={authorName} avatarUrl={avatarUrl} writtenAt={writtenAt} colors={colors} stacked />
              </div>
            )}
            <Body paragraphs={paragraphs} fontSize={fontSize} lineHeight={lineHeight} letterSpacing={letterSpacing} />
            {quote && <QuoteBlock quote={quote} colors={colors} />}
          </div>
          <div>
            <TitleChapterAttribution title={title} chapter={chapter} author={author} colors={colors} />
            {isIdea && <Divider colors={colors} className="mt-8" />}
            <BrandMark brand={brand} colors={colors} />
          </div>
        </>
      )}

      {template === 'calendar' && (
        <>
          <div className="flex flex-col items-center">
            <div
              aria-hidden
              className="-mt-8 mb-8 w-full border-b border-dashed opacity-35"
              style={{ borderColor: colors.accent }}
            />
            {(() => {
              const { day, monthYear, weekday } = calendarDateParts()
              return (
                <>
                  <p style={{ fontSize: 120, lineHeight: 1 }} className="font-semibold tracking-tight">{day}</p>
                  <p style={{ fontSize: 26 }} className="mt-5 font-bold tracking-[0.25em] uppercase">{monthYear}</p>
                  <p className="mt-3 text-xs tracking-[0.2em] uppercase opacity-70" style={{ color: colors.sub }}>{weekday}</p>
                  <div className="mb-10 mt-8 h-0.5 w-12 rounded-full opacity-50" style={{ background: colors.accent }} />
                </>
              )
            })()}
            <Body paragraphs={paragraphs} fontSize={fontSize} lineHeight={lineHeight} letterSpacing={letterSpacing} center />
            {quote && <QuoteBlock quote={quote} colors={colors} center />}
          </div>
          <div>
            <TitleChapterAttribution title={title} chapter={chapter} author={author} colors={colors} align="center" />
            <BrandMark brand={brand} colors={colors} align="center" />
          </div>
        </>
      )}

      {template === 'ink' && !isIdea && (
        <div className="flex min-h-[380px] flex-col justify-between">
          <div>
            <InkBar colors={colors} />
            <div className="mt-8"><VerticalTitle title={title} author={author} colors={colors} seal /></div>
            <div className="mt-12">
              <Body paragraphs={paragraphs} fontSize={fontSize} lineHeight={lineHeight} letterSpacing={letterSpacing} />
            </div>
          </div>
          <div>
            {chapter && (
              <p className="mt-6 text-sm tracking-wide opacity-75" style={{ color: colors.sub }}>
                {chapter}
              </p>
            )}
            <InkBar colors={colors} className="mt-8" />
            <BrandMark brand={brand} colors={colors} />
          </div>
        </div>
      )}

      {template === 'ink' && isIdea && (
        <div className="flex min-h-[380px] flex-col justify-between">
          <div>
            <InkBar colors={colors} />
            <div className="mt-8"><IdentityHeader authorName={authorName} writtenAt={writtenAtCn ?? writtenAt} colors={colors} avatar={false} /></div>
            <Divider colors={colors} className="my-8" />
            <Body paragraphs={paragraphs} fontSize={fontSize} lineHeight={lineHeight} letterSpacing={letterSpacing} />
            {quote && <QuoteBlock quote={quote} colors={colors} />}
          </div>
          <div>
            <TitleChapterAttribution title={title} chapter={chapter} author={author} colors={colors} />
            <Divider colors={colors} className="mt-6" />
            <BrandMark brand={brand} colors={colors} align="left" />
            <InkBar colors={colors} className="mt-4" />
          </div>
        </div>
      )}

      {template === 'letter' && (
        <div className="rounded-xs border-2 p-2" style={{ borderColor: colors.accent }}>
          <div className="flex min-h-[340px] flex-col justify-between border px-7 py-10" style={{ borderColor: `${colors.accent}80` }}>
            <div>
              {isIdea && <IdentityHeader authorName={authorName} avatarUrl={avatarUrl} writtenAt={writtenAt} colors={colors} />}
              {isIdea && <Divider colors={colors} className="my-8" />}
              <Body paragraphs={paragraphs} fontSize={fontSize} lineHeight={lineHeight} letterSpacing={letterSpacing} />
              {quote && <QuoteBlock quote={quote} colors={colors} />}
            </div>
            <div>
              <TitleChapterAttribution title={title} chapter={chapter} author={author} colors={colors} />
              {isIdea && <Divider colors={colors} className="mt-6" />}
              <BrandMark brand={brand} colors={colors} align="left" />
            </div>
          </div>
        </div>
      )}

      {template === 'brocade' && (
        <div className="flex min-h-[380px] flex-col justify-between">
          <div>
            <div className="border-l-2 pl-5" style={{ borderColor: `${colors.accent}40` }}>
              <VerticalTitle title={title} author={author} colors={colors} />
            </div>
            {isIdea && (
              <div className="mt-10">
                <IdentityHeader authorName={authorName} writtenAt={writtenAt} colors={colors} avatar={false} />
              </div>
            )}
            <div className={isIdea ? 'mt-8' : 'mt-14'}>
              <Body paragraphs={paragraphs} fontSize={fontSize} lineHeight={lineHeight} letterSpacing={letterSpacing} />
            </div>
            {quote && <QuoteBlock quote={quote} colors={colors} />}
          </div>
          <div>
            {chapter && (
              <p className={`${isIdea ? 'mt-4' : 'mt-6'} text-sm tracking-wide opacity-75`} style={{ color: colors.sub }}>
                {chapter}
              </p>
            )}
            {isIdea && <Divider colors={colors} className="mt-8" />}
            <BrandMark brand={brand} colors={colors} align={isIdea ? 'left' : 'right'} />
          </div>
        </div>
      )}
    </div>
  )
}
