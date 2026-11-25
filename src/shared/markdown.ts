// A tiny, safe markdown renderer for result text. AI output is escaped first, then
// a small set of formats is supported (headings, bold/italic, code, lists, tables,
// rules, blockquotes, paragraphs). Deliberately minimal — enough to read a
// storybook or a structured answer without a heavyweight dependency.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Some rich-text transports hand a Markdown card a doubly escaped payload:
// Markdown delimiters arrive with a leading slash, newlines are literal `\\n`,
// and spaces appear as numeric HTML entities. Ordinary Markdown escapes remain
// user text unless the rest of this exact transport shape is present.
function restoreEscapedMarkdownTransport(md: string): string {
  if (!/\\n|&#(?:x0*20|0*32);/i.test(md)) return md
  if (!/\\+(?:#{1,6}|[*_`\[\]])/.test(md)) return md

  return md
    .replace(/\\n/g, '\n')
    .replace(/\\+(?=#{1,6}|[*_`\[\]])/g, '')
}

// MDXEditor's Markdown round-trip can preserve list punctuation as a literal
// escape even when it represents a structural list marker. Restore only those
// escapes at the beginning of a line; a backslash elsewhere remains user text.
function restoreEscapedListMarkers(md: string): string {
  return md
    .replace(/(^|\n)(\s*)\\(?=[-*+]\s)/g, '$1$2')
    .replace(/(^|\n)(\s*\d+)\\\.(?=\s)/g, '$1$2.')
}

export function normalizeMarkdownTransport(md: string): string {
  const restored = restoreEscapedListMarkers(restoreEscapedMarkdownTransport(md))
  // Numeric references are rare. Keep ordinary and giant Cards off the
  // line-splitting prose walk; only an affected document pays for decoding.
  if (!/&#(?:x[\da-f]+|\d+);/i.test(restored)) return restored

  // Some transports leave a literal padding space before an encoded space.
  // Collapse that exact pair so it cannot masquerade as a Markdown hard break.
  const decoded = decodeNumericCharacterReferences(restored)

  // A decoded control or whitespace reference can leave a structurally empty
  // list marker. MDXEditor drops that item on import, so remove it here too and
  // keep passive and edit projections identical.
  return decoded.replace(/(^|\n)[^\S\n]*(?:[-*+]|\d+\.)[^\S\n]+(?=\n|$)/g, '$1')
}

/**
 * A writer's own blank lines are content, not formatting. Markdown reads any
 * run of them as one paragraph break, so a naive round trip deletes the empty
 * paragraphs somebody typed. Eido reads a run the way its Markdown editor
 * writes one: blocks are separated by a single blank line, and each empty
 * paragraph between them costs two more lines (its own, plus the second
 * separator). At the head or foot of a document there is no separator to pay
 * for, so every pair of blank lines is one empty paragraph.
 */
export function authoredBlankParagraphs(blankLines: number, betweenBlocks: boolean): number {
  return Math.max(0, Math.floor((blankLines - (betweenBlocks ? 1 : 0)) / 2))
}

function formats(s: string): string {
  return s
    .replace(/==([^=\n]+)==/g, '<mark>$1</mark>')
    .replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>')
}

const escapableMarkdownPunctuation = new Set(`!"#$%&'()*+,-./:;<=>?@[\\]^_\`{|}~`)

/**
 * A Markdown escape is transport, not text. The editor writes an ordinary URL
 * back with its punctuation escaped (`?v\=1\&pp\=2`), so every reader of a
 * link's text or destination must strip those escapes before it decides what
 * the address is. Only ASCII punctuation can be escaped; a backslash before
 * anything else is the writer's own character.
 */
export function unescapeMarkdownPunctuation(text: string): string {
  return text.replace(/\\(.)/g, (source: string, punctuation: string) => (
    escapableMarkdownPunctuation.has(punctuation) ? punctuation : source
  ))
}

function anchor(href: string, text: string): string {
  return `<a href="${href}" target="_blank">${text}</a>`
}

const safeMarkdownSchemes = new Set(['http', 'https', 'mailto', 'tel', 'sms', 'eido'])
const markdownLinkPattern = /\[([^\]\n]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g

export function isSafeMarkdownHref(href: string): boolean {
  const trimmed = unescapeMarkdownPunctuation(href.trim())
  if (
    !trimmed ||
    /[\0-\x20\x7f]|&(?:amp;)?(?:#(?:x[\da-f]+|\d+)|colon|tab|newline);/i.test(trimmed)
  ) return false
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed)?.[1].toLowerCase()
  return !scheme || safeMarkdownSchemes.has(scheme)
}

export function isDirectMarkdownHref(href: string): boolean {
  const trimmed = unescapeMarkdownPunctuation(href.trim())
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed)?.[1].toLowerCase()
  return isSafeMarkdownHref(trimmed) && (
    (scheme !== undefined && safeMarkdownSchemes.has(scheme)) ||
    /^(?:\/|\.\/|\.\.\/|#)/.test(trimmed)
  )
}

function neutralizeUnsafeLinksInProse(markdown: string): string {
  return markdown.replace(
    markdownLinkPattern,
    (
      source: string,
      _text: string,
      href: string,
      offset: number,
      completeMarkdown: string,
    ) => {
      if (isSafeMarkdownHref(href)) return source
      let precedingBackslashes = 0
      for (let index = offset - 1; completeMarkdown[index] === '\\'; index -= 1) {
        precedingBackslashes += 1
      }
      return precedingBackslashes % 2 === 1 ? source : `\\${source}`
    },
  )
}

// Markdown-shaped text inside code is data, not structure. Walk fence and
// inline-code boundaries so that any prose rewrite stays invisible and stable.
function rewriteMarkdownProse(
  markdown: string,
  rewrite: (prose: string) => string,
  rewriteCode: (code: string) => string = (code) => code,
): string {
  let fence = ''

  return markdown.split('\n').map((line) => {
    const fenceRun = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1]
    if (fence) {
      if (
        fenceRun?.[0] === fence[0] &&
        fenceRun.length >= fence.length &&
        line.slice(line.indexOf(fenceRun) + fenceRun.length).trim() === ''
      ) {
        fence = ''
      }
      return rewriteCode(line)
    }
    if (fenceRun) {
      fence = fenceRun
      return rewriteCode(line)
    }

    const codeSpans: string[] = []
    const prose = line.replace(/(`+)(.*?)\1/g, (source) => (
      `\u0000${codeSpans.push(source) - 1}\u0000`
    ))
    return rewrite(prose).replace(
      /\u0000(\d+)\u0000/g,
      (_, index: string) => rewriteCode(codeSpans[Number(index)]),
    )
  }).join('\n')
}

/**
 * The same body with every fenced block and inline code span blanked out, its
 * line structure intact. A caller asking "does this text contain a link" must
 * ask about the prose a reader actually sees: renderMarkdown never autolinks
 * inside code, so a URL in a pasted code sample stays a code sample.
 */
export function markdownProseOnly(markdown: string): string {
  return rewriteMarkdownProse(markdown, (prose) => prose, (code) => ' '.repeat(code.length))
}

// Numeric character references are Markdown prose, not literal source text.
// MDXEditor decodes them during import; decoding them at this shared boundary
// gives every passive Card renderer the same text. Code remains byte-stable,
// and invalid Unicode scalar values use the standard replacement character.
function decodeNumericCharacterReferences(markdown: string): string {
  return rewriteMarkdownProse(markdown, (prose) => prose
    .replace(/ (?=&#(?:x0*20|0*32);)/gi, '')
    .replace(
      /&#(?:x([\da-f]+)|(\d+));/gi,
      (_source, hex: string | undefined, decimal: string | undefined) => {
        const codePoint = Number.parseInt(hex ?? decimal ?? '', hex === undefined ? 10 : 16)
        if (
          !Number.isFinite(codePoint) ||
          codePoint === 0 ||
          codePoint > 0x10ffff ||
          (codePoint >= 0xd800 && codePoint <= 0xdfff)
        ) return '\ufffd'
        return String.fromCodePoint(codePoint)
      },
    ))
}

// MDXEditor's link visitor needs unsafe destinations escaped before import.
export function neutralizeUnsafeMarkdownLinks(markdown: string): string {
  return rewriteMarkdownProse(markdown, neutralizeUnsafeLinksInProse)
}

// A trailing odd run of backslashes escapes whatever character follows it.
function isEscaped(backslashes: string): boolean {
  return backslashes.length % 2 === 1
}

// The passive renderer escapes every angle bracket, so a card body carries no
// raw HTML and `<1s` is ordinary prose. MDXEditor reads the same body as MDX,
// where `<` opens a tag and one unparseable tag aborts the entire import,
// leaving the writer an empty editor. Escape prose angles on the way in so both
// surfaces read the body through one grammar.
export function neutralizeMarkdownAngles(markdown: string): string {
  return rewriteMarkdownProse(markdown, (prose) => prose.replace(
    /(\\*)</g,
    (source, backslashes: string) => (isEscaped(backslashes) ? source : `${backslashes}\\<`),
  ))
}

// The inverse, so a body that survives an edit reads the way it was written
// instead of accumulating the editor's transport escapes.
export function restoreMarkdownAngles(markdown: string): string {
  return rewriteMarkdownProse(markdown, (prose) => prose.replace(
    /(\\*)</g,
    (source, backslashes: string) => (
      isEscaped(backslashes) ? `${backslashes.slice(1)}<` : source
    ),
  ))
}

// Code spans and links are lifted out before the formatting passes run, so
// underscores and asterisks inside code or a URL (card links carry ids like
// note_ab12cd34) never read as emphasis.
function inline(s: string): string {
  const kept: string[] = []
  const keep = (html: string) => `\u0000${kept.push(html) - 1}\u0000`

  // Links resolve BEFORE the escape pass. The Markdown editor writes an
  // ordinary address back with its punctuation escaped (`?v\=1\&pp\=2`), and
  // an escape pass that ran first would leave placeholders inside the
  // destination, so the link pattern would no longer match and the reader
  // would see the raw `[...](...)` source.
  let out = s
    .replace(/`([^`]+)`/g, (_, code: string) => keep(`<code>${code}</code>`))
    .replace(
      markdownLinkPattern,
      (markdown: string, text: string, href: string) => {
        if (!isSafeMarkdownHref(href)) return markdown
        // The link's own text keeps its escapes as placeholders, exactly as the
        // prose pass below would, so `\*` inside a label never reads as
        // emphasis.
        const label = text.replace(/\\(.)/g, (escaped: string, punctuation: string) => (
          escapableMarkdownPunctuation.has(punctuation) ? keep(punctuation) : escaped
        ))
        return keep(anchor(unescapeMarkdownPunctuation(href), formats(label)))
      },
    )
  // A Markdown autolink, `<http://example.com/x>`. Angles are escaped by the
  // time this runs, so the pair reads as `&lt;` and `&gt;`; without this the
  // bare-url rule below would swallow the closing entity into the address.
  // The link a reader clicks is then the same address a Note grows a preview
  // for (webUrlsInText in shared/linkPreview.ts).
  out = out.replace(
    /&lt;(https?:\/\/[^\s<>&]+)&gt;/g,
    (_source, url: string) => keep(anchor(url, url)),
  )
  out = out.replace(
    /https?:\/\/[^\s<\0]*[^\s<\0\\.,:;!?'")\]}]/g,
    (url) => {
      // An escaped angle (`\<url\>`, how the Markdown editor writes one back)
      // leaves half an entity hanging off the address. It is punctuation
      // around the link, never part of it.
      const source = url.replace(/\\?&(?:g|l)t$/, '')
      const address = unescapeMarkdownPunctuation(source)
      return keep(anchor(address, address)) + url.slice(source.length)
    },
  )
  // Whatever prose is left carries its own escapes.
  out = out.replace(/\\(.)/g, (escaped: string, punctuation: string) => (
    escapableMarkdownPunctuation.has(punctuation) ? keep(punctuation) : escaped
  ))

  out = formats(out)
  // A kept link's text can itself hold a kept code span, so resolve in rounds.
  while (/\u0000\d+\u0000/.test(out)) {
    out = out.replace(/\u0000(\d+)\u0000/g, (_, index: string) => kept[Number(index)])
  }
  return out
}

function parseTableRow(line: string): string[] | null {
  const trimmed = line.trim()
  if (!trimmed.includes('|')) return null

  const unwrapped = trimmed.replace(/^\|/, '').replace(/\|$/, '')
  const cells = unwrapped.split('|').map((cell) => cell.trim())
  return cells.length > 1 ? cells : null
}

function parseTableSeparator(line: string): string[] | null {
  const cells = parseTableRow(line)
  if (!cells) return null
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell)) ? cells : null
}

function normalizeCells(cells: string[], count: number): string[] {
  return Array.from({ length: count }, (_, index) => cells[index] ?? '')
}

function tableRow(cells: string[], tag: 'td' | 'th'): string {
  return `<tr>${cells.map((cell) => `<${tag}>${inline(cell)}</${tag}>`).join('')}</tr>`
}

type MarkdownListType = 'ul' | 'ol'
type MarkdownListMarker = {
  indent: number
  type: MarkdownListType
  start: number
  text: string
}
type MarkdownListItem = MarkdownListMarker & { children: MarkdownListGroup[] }
type MarkdownListGroup = {
  type: MarkdownListType
  start: number
  items: MarkdownListItem[]
}

function listMarker(line: string): MarkdownListMarker | null {
  const match = /^([ \t]*)(?:(\d+)\.|([-*+]))\s+(.*)$/.exec(line)
  if (!match) return null
  return {
    indent: match[1].replace(/\t/g, '  ').length,
    type: match[2] ? 'ol' : 'ul',
    start: match[2] ? Number(match[2]) : 1,
    text: match[4],
  }
}

function parseListGroup(
  markers: readonly MarkdownListMarker[],
  startIndex: number,
): { group: MarkdownListGroup; nextIndex: number } {
  const first = markers[startIndex]
  const group: MarkdownListGroup = { type: first.type, start: first.start, items: [] }
  let index = startIndex

  while (index < markers.length) {
    const marker = markers[index]
    if (marker.indent !== first.indent || marker.type !== first.type) break
    const item: MarkdownListItem = { ...marker, children: [] }
    group.items.push(item)
    index += 1

    while (index < markers.length && markers[index].indent > first.indent) {
      const nested = parseListGroup(markers, index)
      item.children.push(nested.group)
      index = nested.nextIndex
    }
  }

  return { group, nextIndex: index }
}

function renderListItem(item: MarkdownListItem): string[] {
  const task = item.type === 'ul' ? /^\[([ xX])\]\s+(.*)$/.exec(item.text) : null
  const content = task
    ? `<label><input type="checkbox"${task[1].toLowerCase() === 'x' ? ' checked' : ''} disabled />${inline(task[2])}</label>`
    : inline(item.text)
  const className = task
    ? ` class="task${task[1].toLowerCase() === 'x' ? ' done' : ''}"`
    : ''
  if (!item.children.length) return [`<li${className}>${content}</li>`]

  return [
    `<li${className}>${content}`,
    ...item.children.flatMap(renderListGroup),
    '</li>',
  ]
}

function renderListGroup(group: MarkdownListGroup): string[] {
  const open = group.type === 'ol' && group.start !== 1
    ? `<ol start="${group.start}">`
    : `<${group.type}>`
  return [open, ...group.items.flatMap(renderListItem), `</${group.type}>`]
}

function renderListMarkers(markers: readonly MarkdownListMarker[]): string[] {
  const rendered: string[] = []
  let index = 0
  while (index < markers.length) {
    const parsed = parseListGroup(markers, index)
    rendered.push(...renderListGroup(parsed.group))
    index = parsed.nextIndex
  }
  return rendered
}

export function renderMarkdown(md: string): string {
  const escaped = escapeHtml(normalizeMarkdownTransport(md))
  const lines = escaped.split('\n')
  const out: string[] = []

  let inCode = false
  let codeBuf: string[] = []
  let paraBuf: Array<{ text: string; hardBreak: boolean }> = []

  const flushPara = () => {
    if (paraBuf.length) {
      const content = paraBuf.map(({ text, hardBreak }, index) => {
        const separator = hardBreak ? '<br />' : index < paraBuf.length - 1 ? ' ' : ''
        return `${inline(text)}${separator}`
      }).join('')
      out.push(`<p>${content}</p>`)
      paraBuf = []
    }
  }

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i]
    const line = raw.replace(/\s+$/, '')

    // fenced code blocks
    if (/^```/.test(line.trim())) {
      if (inCode) {
        out.push(`<pre><code>${codeBuf.join('\n')}</code></pre>`)
        codeBuf = []
        inCode = false
      } else {
        flushPara()
        inCode = true
      }
      continue
    }
    if (inCode) {
      codeBuf.push(line)
      continue
    }

    // A blank run is a paragraph break plus however many empty paragraphs the
    // writer typed. Draw each one as its own line box so the passive Card keeps
    // the spacing that the editor shows.
    if (line.trim() === '') {
      let last = i
      while (last + 1 < lines.length && lines[last + 1].trim() === '') last += 1
      const opensDocument = out.length === 0 && paraBuf.length === 0
      flushPara()
      const empties = authoredBlankParagraphs(
        last - i + 1,
        !opensDocument && last < lines.length - 1,
      )
      for (let empty = 0; empty < empties; empty += 1) out.push('<p><br /></p>')
      i = last
      continue
    }

    // pipe tables: header row, separator row, then one or more body rows
    const headerCells = parseTableRow(line)
    const separatorCells = i + 1 < lines.length ? parseTableSeparator(lines[i + 1].replace(/\s+$/, '')) : null
    if (headerCells && separatorCells && headerCells.length === separatorCells.length) {
      flushPara()

      const columnCount = headerCells.length
      out.push('<table>')
      out.push(`<thead>${tableRow(normalizeCells(headerCells, columnCount), 'th')}</thead>`)
      out.push('<tbody>')

      let rowIndex = i + 2
      while (rowIndex < lines.length) {
        const rowLine = lines[rowIndex].replace(/\s+$/, '')
        const rowCells = parseTableRow(rowLine)
        if (!rowCells || rowLine.trim() === '') break
        out.push(tableRow(normalizeCells(rowCells, columnCount), 'td'))
        rowIndex += 1
      }

      out.push('</tbody>')
      out.push('</table>')
      i = rowIndex - 1
      continue
    }

    // horizontal rule
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      flushPara()
      out.push('<hr />')
      continue
    }

    // headings
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) {
      flushPara()
      const level = h[1].length
      out.push(`<h${level}>${inline(h[2])}</h${level}>`)
      continue
    }

    // blockquote (note: '>' has already been escaped to '&gt;')
    const bq = /^(?:&gt;|>)\s?(.*)$/.exec(line)
    if (bq) {
      flushPara()
      out.push(`<blockquote><p>${inline(bq[1])}</p></blockquote>`)
      continue
    }

    // Indentation-aware ordered, unordered, and task lists.
    if (listMarker(line)) {
      flushPara()
      const markers: MarkdownListMarker[] = []
      let row = i
      for (; row < lines.length; row += 1) {
        const candidate = lines[row].replace(/\s+$/, '')
        if (candidate.trim() === '') {
          const next = lines.slice(row + 1).findIndex((nextLine) => nextLine.trim() !== '')
          if (next < 0 || !listMarker(lines[row + 1 + next].replace(/\s+$/, ''))) break
          continue
        }
        const marker = listMarker(candidate)
        if (!marker) break
        markers.push(marker)
      }
      out.push(...renderListMarkers(markers))
      i = row - 1
      continue
    }

    // plain text → accumulate into a paragraph. Soft Markdown newlines remain
    // spaces, while explicit hard breaks preserve user-authored editor lines.
    const trailingSlashes = /\\+$/.exec(line)?.[0].length ?? 0
    const slashHardBreak = trailingSlashes % 2 === 1
    paraBuf.push({
      text: (slashHardBreak ? line.slice(0, -1) : line).trim(),
      hardBreak: / {2,}$/.test(raw) || slashHardBreak,
    })
  }

  if (inCode) out.push(`<pre><code>${codeBuf.join('\n')}</code></pre>`)
  flushPara()

  return out.join('\n')
}
