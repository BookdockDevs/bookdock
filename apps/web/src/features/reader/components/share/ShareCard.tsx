import type { Ref } from 'react'

import { QuoteLeftIcon } from '../annotation-icons'
import { cardColors, type CardColors, type ShareCardBackground, type ShareCardBrand, type ShareCardTemplate } from './card-prefs'
import {
  NOTE_MAX_CHARS,
  QUOTE_MAX_CHARS,
  attributionLine,
  calendarDateParts,
  excerptFontSize,
  excerptParagraphs,
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
  writtenAt?: string
  writtenAtCn?: string
  /** Points at the untransformed card node — the export target for html-to-image */
  ref?: Ref<HTMLDivElement>
}

/** Body line-height is uniform 1.9 across all five reference templates
 *  (measured: advance/ink ≈ 1.82–1.93) */
function Body({ paragraphs, fontSize, center }: { paragraphs: string[]; fontSize: number; center?: boolean }) {
  return (
    <div style={{ fontSize, lineHeight: 1.9 }} className={`tracking-wide ${center ? 'text-center' : ''}`}>
      {paragraphs.map((p, i) => (
        <p key={i} style={i > 0 ? { marginTop: '0.6em' } : undefined}>
          {p}
        </p>
      ))}
    </div>
  )
}

function QuoteBlock({ quote, colors, center }: { quote: string; colors: CardColors; center?: boolean }) {
  return (
    <div className={`mt-12 w-full ${center ? 'flex flex-col items-center text-center' : 'text-left'}`}>
      <span aria-hidden style={{ color: colors.watermark }}>
        <QuoteLeftIcon height={24} />
      </span>
      <p className="mt-5 whitespace-pre-wrap text-xl" style={{ color: colors.sub, lineHeight: 1.7 }}>
        {quote}
      </p>
    </div>
  )
}

/** First-char circle is the placeholder until avatar support lands; the plain
 *  variant (ink/brocade idea cards) drops the circle per the reference shots.
 *  `stacked` puts the avatar on its own row above the name (classic idea card) */
function IdentityHeader({ authorName, writtenAt, colors, avatar = true, stacked }: { authorName?: string; writtenAt?: string; colors: CardColors; avatar?: boolean; stacked?: boolean }) {
  if (!avatar) {
    return (
      <div>
        <p className="text-2xl font-semibold">{authorName}</p>
        {writtenAt && <p className="mt-4 text-lg" style={{ color: colors.sub }}>{writtenAt}</p>}
      </div>
    )
  }
  const circle = (
    <span
      className="flex h-13 w-13 shrink-0 items-center justify-center rounded-full text-xl"
      style={{ background: `${colors.watermark}4d`, color: colors.sub }}
    >
      {[...(authorName ?? '')][0] ?? ''}
    </span>
  )
  if (stacked) {
    return (
      <div data-identity="stacked">
        {circle}
        <p className="mt-5 text-2xl font-semibold">{authorName}</p>
        {writtenAt && <p className="mt-4 text-lg" style={{ color: colors.sub }}>{writtenAt}</p>}
      </div>
    )
  }
  return (
    <div className="flex items-center gap-4">
      {circle}
      <div>
        <p className="text-2xl font-semibold">{authorName}</p>
        {writtenAt && <p className="mt-2 text-lg" style={{ color: colors.sub }}>{writtenAt}</p>}
      </div>
    </div>
  )
}

function Divider({ colors, className = '' }: { colors: CardColors; className?: string }) {
  return <div className={`h-px w-full ${className}`} style={{ background: `${colors.watermark}80` }} />
}

function BrandMark({ brand, colors, align = 'right' }: { brand: ShareCardBrand; colors: CardColors; align?: 'left' | 'center' | 'right' }) {
  if (brand === 'off') return null
  const alignClass = align === 'center' ? 'text-center' : align === 'left' ? 'text-left' : 'text-right'
  return (
    <p className={`mt-6 w-full text-base tracking-widest ${alignClass}`} style={{ color: colors.watermark }}>
      {brand === 'zh' ? '书坞' : 'Bookdock'}
    </p>
  )
}

/** The ink bars mimic the aged-woodblock strips in the 微信读书 墨白 reference:
 *  square-edged warm brown rectangle with page-colored nicks scattered inside
 *  (a few touching the edges for roughness). Speckle positions are fixed so
 *  repeated exports render identically. */
function InkBar({ colors, className = '' }: { colors: CardColors; className?: string }) {
  const nick = (x: number, y: number, r: number) =>
    `radial-gradient(circle ${r}px at ${x}% ${y}%, ${colors.bg} 60%, transparent 70%)`
  return (
    <div
      className={`h-3 ${className}`}
      style={{
        backgroundColor: colors.accent,
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

/** Vertical book-title block pinned top-left (ink / brocade templates).
 *  writing-mode must live on each column, not the flex container — putting it
 *  on the container rotates the flex main axis and drops the author column
 *  below the title instead of beside it (reference: 微信读书 ink card) */
function VerticalTitle({ title, author, colors }: { title: string; author: string; colors: CardColors }) {
  return (
    <div className="flex gap-6 self-start">
      <p
        className="overflow-hidden font-semibold tracking-widest"
        style={{ writingMode: 'vertical-rl', fontSize: 42, maxHeight: 420 }}
      >
        {title}
      </p>
      {author && (
        <p className="text-lg tracking-widest" style={{ color: colors.sub, writingMode: 'vertical-rl' }}>
          {author}
        </p>
      )}
    </div>
  )
}

function TitleChapterAttribution({ title, chapter, author, colors }: { title: string; chapter: string | null; author: string; colors: CardColors }) {
  return (
    <div className="mt-6 text-lg" style={{ color: colors.sub }}>
      <p>{chapter ? `${title} · ${chapter}` : title}</p>
      {author && <p className="mt-4">{author}</p>}
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
  writtenAt,
  writtenAtCn,
  ref,
}: ShareCardProps) {
  const colors = cardColors(background)
  const isIdea = !!note
  const body = note ?? text
  const paragraphs = excerptParagraphs(truncateExcerpt(body, isIdea ? NOTE_MAX_CHARS : undefined))
  // Reference idea cards set the note one tier larger than the same template's
  // excerpt body (measured advance: classic +0, letter/calendar +1, ink/brocade +2)
  const ideaBoost = template === 'ink' || template === 'brocade' ? 2 : template === 'classic' ? 0 : 1
  const fontSize = excerptFontSize([...body].length) + (isIdea ? ideaBoost : 0)
  const quote = isIdea && text ? truncateExcerpt(text, QUOTE_MAX_CHARS) : null

  return (
    <div
      ref={ref}
      data-template={template}
      data-kind={isIdea ? 'idea' : 'excerpt'}
      style={{ width: SHARE_CARD_WIDTH, background: colors.bg, color: colors.text, fontFamily: fontStack }}
      className={`box-border rounded-2xl shadow-xl ${
        template === 'letter' ? 'p-6'
        : template === 'brocade' ? 'px-13 py-16'
        : template === 'ink' ? 'px-10 py-16'
        : template === 'calendar' ? 'px-12 py-20'
        : 'px-11 py-16'
      }`}
    >
      {template === 'classic' && (
        <>
          {isIdea && <div className="mb-12"><IdentityHeader authorName={authorName} writtenAt={writtenAt} colors={colors} stacked /></div>}
          <Body paragraphs={paragraphs} fontSize={fontSize} />
          {quote && <QuoteBlock quote={quote} colors={colors} />}
          <div className={`${isIdea ? 'mt-6' : 'mt-9'} text-lg`} style={{ color: colors.sub }}>
            <p>{attributionLine(title, chapter)}</p>
            {author && <p className="mt-4">{author}</p>}
          </div>
          {isIdea && <Divider colors={colors} className="mt-10" />}
          <BrandMark brand={brand} colors={colors} />
        </>
      )}

      {template === 'calendar' && (
        <div className="flex flex-col items-center">
          {(() => {
            const { day, monthYear, weekday } = calendarDateParts()
            return (
              <>
                <p style={{ fontSize: 138, lineHeight: 1 }} className="font-semibold">{day}</p>
                <p style={{ fontSize: 34 }} className="mt-7 font-bold tracking-wide">{monthYear}</p>
                <p className="mt-6 text-base" style={{ color: colors.sub }}>{weekday}</p>
                <div className="mb-14 mt-12 h-px w-16" style={{ background: colors.accent }} />
              </>
            )
          })()}
          <Body paragraphs={paragraphs} fontSize={fontSize} center />
          {quote && <QuoteBlock quote={quote} colors={colors} center />}
          <div className="mt-10 text-center text-lg" style={{ color: colors.sub }}>
            <p>《{title}》</p>
            {author && <p className="mt-4">{author}</p>}
          </div>
          <BrandMark brand={brand} colors={colors} align="center" />
        </div>
      )}

      {template === 'ink' && !isIdea && (
        <div className="flex flex-col">
          <InkBar colors={colors} />
          <div className="mt-10"><VerticalTitle title={title} author={author} colors={colors} /></div>
          <div className="mt-16">
            <Body paragraphs={paragraphs} fontSize={fontSize} />
          </div>
          {chapter && (
            <p className="mt-8 text-lg" style={{ color: colors.sub }}>
              / {chapter}
            </p>
          )}
          <InkBar colors={colors} className="mt-10" />
          <BrandMark brand={brand} colors={colors} />
        </div>
      )}

      {template === 'ink' && isIdea && (
        <div className="flex flex-col">
          <InkBar colors={colors} />
          <div className="mt-11"><IdentityHeader authorName={authorName} writtenAt={writtenAtCn ?? writtenAt} colors={colors} avatar={false} /></div>
          <Divider colors={colors} className="my-10" />
          <Body paragraphs={paragraphs} fontSize={fontSize} />
          {quote && <QuoteBlock quote={quote} colors={colors} />}
          <TitleChapterAttribution title={title} chapter={chapter} author={author} colors={colors} />
          <Divider colors={colors} className="mt-8" />
          <BrandMark brand={brand} colors={colors} align="left" />
          <InkBar colors={colors} className="mt-4" />
        </div>
      )}

      {template === 'letter' && (
        <div className="border-2 p-1.5" style={{ borderColor: colors.accent }}>
          <div className="border px-7 py-11" style={{ borderColor: colors.accent }}>
            {isIdea && <IdentityHeader authorName={authorName} writtenAt={writtenAt} colors={colors} />}
            {isIdea && <Divider colors={colors} className="my-10" />}
            <Body paragraphs={paragraphs} fontSize={fontSize} />
            {quote && <QuoteBlock quote={quote} colors={colors} />}
            <TitleChapterAttribution title={title} chapter={chapter} author={author} colors={colors} />
            <Divider colors={colors} className="mt-8" />
            <BrandMark brand={brand} colors={colors} align="left" />
          </div>
        </div>
      )}

      {template === 'brocade' && (
        <div className="flex flex-col">
          <VerticalTitle title={title} author={author} colors={colors} />
          {isIdea && (
            <div className="mt-12">
              <IdentityHeader authorName={authorName} writtenAt={writtenAt} colors={colors} avatar={false} />
            </div>
          )}
          <div className={isIdea ? 'mt-10' : 'mt-20'}>
            <Body paragraphs={paragraphs} fontSize={fontSize} />
          </div>
          {quote && <QuoteBlock quote={quote} colors={colors} />}
          {chapter && (
            <p className={`${isIdea ? 'mt-6' : 'mt-9'} text-lg`} style={{ color: colors.sub }}>
              / {chapter}
            </p>
          )}
          {isIdea && (
            <>
              <Divider colors={colors} className="mt-10" />
              <BrandMark brand={brand} colors={colors} align="left" />
            </>
          )}
          {!isIdea && <BrandMark brand={brand} colors={colors} />}
        </div>
      )}
    </div>
  )
}
