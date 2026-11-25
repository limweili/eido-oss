import { readdirSync, readFileSync } from 'node:fs'
import { extname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const REFERENCE_PATH = 'docs/design/design-system/eido-design-system.html'
const PRODUCTION_EXTENSIONS = new Set(['.css', '.ts', '.tsx'])
const NON_PRODUCTION_SUFFIX = /\.(?:test|browser|perf|bench)\.[cm]?[jt]sx?$/

const ALLOWED_EXEMPTION_CATEGORIES = new Set([
  'canonical-token-values',
  'user-colour-data',
  'forbidden-fixture',
  'system-geometry-owner',
  'react-flow-variable',
])

const userColourProperty = (symbol, owner, reason) => ({
  category: 'user-colour-data',
  rule: 'obsolete-custom-property',
  symbol,
  owner,
  reason,
})

const reactFlowProperty = (symbol) => ({
  category: 'react-flow-variable',
  rule: 'obsolete-custom-property',
  path: 'src/styles/020-board.css',
  symbol,
  owner: 'React Flow CSS adapter',
  reason: 'React Flow owns this individually named documented CSS hook; the assigned value remains an Eido semantic token.',
})

const geometryOwner = (path, symbol, reason) => ({
  category: 'system-geometry-owner',
  rule: 'off-ladder-design-value',
  path,
  symbol,
  owner: 'SYSTEM.md section 12 canvas geometry contract',
  reason,
})

/**
 * Each exception is an evidence record, not a skip pattern. Paths and symbols
 * match exactly; glob, directory, legacy-family, and snapshot exemptions are
 * rejected by validateDesignSystemExemptions.
 */
export const DESIGN_SYSTEM_EXEMPTIONS = Object.freeze([
  {
    category: 'canonical-token-values',
    rule: 'raw-colour',
    path: 'src/ui/tokens.ts',
    owner: 'generated Eido token authority',
    reason: 'SYSTEM.md requires canonical light/dark resolved colour values to live in this exact module.',
  },
  {
    category: 'user-colour-data',
    rule: 'raw-colour',
    path: 'src/ui/cardIdentity.ts',
    owner: 'card identity resolver',
    reason: 'Contrast endpoints resolve user-selected Card identity colours; they are user-colour calculations, not authored chrome colour.',
  },
  {
    category: 'user-colour-data',
    rule: 'raw-colour',
    path: 'src/graph/cardIdentityPresets.ts',
    owner: 'saved Card identity preset authority',
    reason: 'These stable solids are persisted user-selectable Card identity data shared by graph writers and presentation adapters, not authored chrome colour.',
  },
  {
    category: 'user-colour-data',
    rule: 'raw-colour',
    path: 'src/shared/imageCompression.ts',
    symbol: 'IMAGE_COMPRESSION_POLICY.flattenBackground',
    owner: 'persisted image compression policy',
    reason: 'This deterministic flatten colour becomes stored JPEG pixels for pasted user images; changing it with UI theme roles would alter persisted image output.',
  },
  {
    category: 'forbidden-fixture',
    rule: 'raw-colour',
    path: 'src/graph/perfFixtures.ts',
    owner: 'synthetic performance fixture generator',
    reason: 'These colours are generated Card identity and inline SVG fixture data used to exercise performance workloads, never authored product chrome.',
  },
  {
    category: 'system-geometry-owner',
    rule: 'off-ladder-design-value',
    path: 'src/styles/041-prose.css',
    symbol: ".markdown-card-editor-content table > tbody > tr > :nth-child(2):not([data-tool-cell='true'])",
    owner: 'passive/editor collapsed-border table geometry',
    reason: 'The half-pixel inset keeps passive and editor table columns aligned under collapsed borders.',
  },
  {
    category: 'system-geometry-owner',
    rule: 'off-ladder-design-value',
    path: 'src/styles/090-dock.css',
    symbol: '.tool-divider',
    owner: 'SYSTEM.md section 8.9 sacred dock geometry',
    reason: 'The 3px divider margin is an exact sacred dock-geometry value shared by the approved tool rhythm.',
  },

  userColourProperty('--active-highlight-bg', 'Board highlight adapter', 'The value is the user-selected highlight token carried into a Card instance.'),
  userColourProperty('--active-tag-color', 'Highlight tag adapter', 'The value is the user-selected highlight tag colour carried into dock chrome.'),
  userColourProperty('--callout-base', 'Card body callout base', 'Instance-scoped material a callout mixes its tint into, stepped back from the Card user identity toward the Card paper. It cannot be an --e-* token: only src/ui/tokens.ts may author that family, and this value is per-Card rather than system-wide.'),
  userColourProperty('--card-header-body', 'Card identity resolver', 'Instance-scoped body tint derived from the Card user identity.'),
  userColourProperty('--card-header-color', 'Card identity resolver', 'Instance-scoped solid Card identity colour.'),
  userColourProperty('--card-header-ink', 'Card identity resolver', 'Instance-scoped accessible ink derived from the Card user identity.'),
  userColourProperty('--card-header-pattern', 'Card identity resolver', 'Instance-scoped hatch derived from the Card user identity.'),
  userColourProperty('--card-header-pattern-head', 'Card identity resolver', 'Instance-scoped pattern-head wash derived from the Card user identity.'),
  userColourProperty('--card-header-soft', 'Card identity resolver', 'Instance-scoped soft wash derived from the Card user identity.'),
  userColourProperty('--card-identity', 'Card identity resolver', 'The exact user identity solid is carried to the Card instance.'),
  userColourProperty('--identity-body-attention-ink', 'Card identity resolver', 'Readable attention ink derived against the exact user body tint.'),
  userColourProperty('--identity-body-avoid-ink', 'Card identity resolver', 'Readable avoid ink derived against the exact user body tint.'),
  userColourProperty('--identity-body-convo-ink', 'Card identity resolver', 'Readable conversation ink derived against the exact user body tint.'),
  userColourProperty('--identity-body-go-ink', 'Card identity resolver', 'Readable go ink derived against the exact user body tint.'),
  userColourProperty('--identity-body-ink', 'Card identity resolver', 'Readable primary ink derived against the exact user body tint.'),
  userColourProperty('--identity-body-ink-faint', 'Card identity resolver', 'Decoration-only faint ink carried with the user body tint.'),
  userColourProperty('--identity-body-ink-soft', 'Card identity resolver', 'Readable soft ink derived against the exact user body tint.'),
  userColourProperty('--identity-body-mod-ink', 'Card identity resolver', 'Readable Mod ink derived against the exact user body tint.'),
  userColourProperty('--tag-bg', 'Highlight tag colour resolver', 'Instance-scoped wash for the user-selected highlight tag.'),
  userColourProperty('--tag-dot', 'Highlight tag colour resolver', 'Instance-scoped dot for the user-selected highlight tag.'),

  reactFlowProperty('--xy-background-color'),
  reactFlowProperty('--xy-selection-background-color'),
  reactFlowProperty('--xy-selection-border'),
  reactFlowProperty('--xy-controls-button-background-color'),
  reactFlowProperty('--xy-controls-button-background-color-hover'),
  reactFlowProperty('--xy-controls-button-color'),
  reactFlowProperty('--xy-controls-button-color-hover'),
  reactFlowProperty('--xy-controls-button-border-color'),
  reactFlowProperty('--xy-controls-box-shadow'),

  geometryOwner(
    'src/canvas/zoomChrome.ts',
    'paintedPortGeometry',
    'The shared painter and pointer target consume this exact port geometry owner.',
  ),
  geometryOwner(
    'src/canvas/zoomChrome.ts',
    'paintedBadgeRadius',
    'The shared painter and badge hit target consume this exact radius owner.',
  ),
  geometryOwner(
    'src/canvas/zoomChrome.ts',
    'paintedConnectionBadgeGeometry',
    'The shared painter and badge hit target consume this exact disc owner.',
  ),
  geometryOwner(
    'src/canvas/boardScene.ts',
    'planPaintedConnections',
    'The shared paint/hit plan owns exact whole-wire screen geometry.',
  ),
  geometryOwner(
    'src/canvas/connectionBadgeHit.ts',
    'connectionBadgePaintedAtIndex',
    'This is the shared badge-suppression predicate used by paint and hit membership.',
  ),
])

export function validateDesignSystemExemptions(exemptions) {
  if (!Array.isArray(exemptions)) throw new Error('Design-system exemptions must be an array.')

  const identities = new Set()
  for (const exemption of exemptions) {
    if (!ALLOWED_EXEMPTION_CATEGORIES.has(exemption?.category)) {
      throw new Error(`Unsupported design-system exemption category: ${exemption?.category ?? '<missing>'}`)
    }
    if (typeof exemption.rule !== 'string' || !exemption.rule.trim()) {
      throw new Error('Every design-system exemption needs an exact rule.')
    }
    if (typeof exemption.owner !== 'string' || !exemption.owner.trim()) {
      throw new Error('Every design-system exemption needs an owner.')
    }
    if (typeof exemption.reason !== 'string' || !exemption.reason.trim()) {
      throw new Error('Every design-system exemption needs a reason.')
    }
    if (!exemption.path && !exemption.symbol) {
      throw new Error('Every design-system exemption needs an exact path or symbol.')
    }
    if (exemption.path) {
      if (
        typeof exemption.path !== 'string' ||
        /[*?{}[\]]/.test(exemption.path) ||
        exemption.path.endsWith('/') ||
        exemption.path.startsWith('/') ||
        exemption.path.split('/').includes('..') ||
        !extname(exemption.path)
      ) {
        throw new Error(`Exemption path must be one exact repository file: ${exemption.path}`)
      }
    }
    if (exemption.symbol && (typeof exemption.symbol !== 'string' || /[*?{}]/.test(exemption.symbol))) {
      throw new Error(`Exemption symbol must be exact: ${exemption.symbol}`)
    }
    const identity = [exemption.category, exemption.rule, exemption.path ?? '', exemption.symbol ?? ''].join('|')
    if (identities.has(identity)) throw new Error(`Duplicate design-system exemption: ${identity}`)
    identities.add(identity)
  }
  return true
}

validateDesignSystemExemptions(DESIGN_SYSTEM_EXEMPTIONS)

function normalizePath(path) {
  return path.split(sep).join('/')
}

function locationAt(source, index) {
  const before = source.slice(0, Math.max(0, index))
  const lines = before.split('\n')
  return { line: lines.length, column: lines.at(-1).length + 1 }
}

function makeFinding(rule, path, source, index, message, symbol) {
  return { rule, path, ...locationAt(source, index), message, ...(symbol ? { symbol } : {}) }
}

function maskComments(source, css) {
  const output = [...source]
  let quote = null
  let escaped = false
  let lineComment = false
  let blockComment = false

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    const next = source[index + 1]

    if (lineComment) {
      if (character === '\n') lineComment = false
      else output[index] = ' '
      continue
    }
    if (blockComment) {
      if (character === '*' && next === '/') {
        output[index] = ' '
        output[index + 1] = ' '
        blockComment = false
        index += 1
      } else if (character !== '\n') output[index] = ' '
      continue
    }
    if (quote) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === quote) quote = null
      continue
    }
    if (character === '"' || character === "'" || (!css && character === '`')) {
      quote = character
      continue
    }
    if (character === '/' && next === '*') {
      output[index] = ' '
      output[index + 1] = ' '
      blockComment = true
      index += 1
      continue
    }
    if (!css && character === '/' && next === '/') {
      output[index] = ' '
      output[index + 1] = ' '
      lineComment = true
      index += 1
    }
  }
  return output.join('')
}

function addMatches(findings, { rule, path, source, searchable, pattern, message, symbolAt, include }) {
  for (const match of searchable.matchAll(pattern)) {
    const index = match.index + (match[0].indexOf(match[1] ?? match[0]))
    if (include && !include(match, index)) continue
    findings.push(makeFinding(rule, path, source, index, message(match), symbolAt?.(match, index)))
  }
}

function isTypeScriptHexColour(source, index, token) {
  const quote = source[index - 1]
  if ((quote === '"' || quote === "'" || quote === '`') && source[index + token.length] === quote) return true
  if (!/^#\d+$/.test(token)) return true

  const lineStart = source.lastIndexOf('\n', index - 1) + 1
  const prefix = source.slice(lineStart, index)
  return /\b(?:color|background(?:-color)?|border(?:-[\w-]+)?|box-shadow|text-shadow|fill|stroke)\s*:\s*[^;]*$/i.test(prefix) ||
    /\b(?:solid|dashed|dotted|double)\s*$/i.test(prefix)
}

function imageCompressionPolicySymbolAt(path, source, index) {
  if (path !== 'src/shared/imageCompression.ts') return undefined

  const declaration = /\bexport\s+const\s+(IMAGE_COMPRESSION_POLICY)\s*=\s*\{/.exec(source)
  if (!declaration || index < declaration.index) return undefined
  const close = /\n\s*}\s+as\s+const\b/.exec(source.slice(declaration.index))
  if (!close || index >= declaration.index + close.index) return undefined

  const lineStart = source.lastIndexOf('\n', index - 1) + 1
  const property = /^\s*([A-Za-z_$][\w$]*)\s*:\s*["'`][^"'`]*$/.exec(source.slice(lineStart, index))
  return property ? `${declaration[1]}.${property[1]}` : undefined
}

const ALLOWED_VALUES = Object.freeze({
  'font-size': new Set([11, 12, 13, 14, 15, 16, 18, 24]),
  'border-radius': new Set([0, 1, 2, 4, 6, 8, 10, 12, 999]),
  'layout-spacing': new Set([0, 4, 8, 12, 16, 24, 32, 48]),
  'inset-spacing': new Set([0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 20, 24, 32, 48]),
  'font-weight': new Set([400, 500, 600, 700]),
  'line-height': new Set([1, 1.2, 1.3, 1.35, 1.4, 1.5, 1.55, 1.6]),
  'letter-spacing': new Set([0, 0.06, 0.08]),
  duration: new Set([0, 1, 80, 120, 140, 170, 180, 200, 220, 260, 320, 360, 600, 620, 1000, 1650]),
})

function numericValues(value, unit) {
  const pattern = new RegExp(`(-?\\d+(?:\\.\\d+)?)${unit}`, 'gi')
  return [...value.matchAll(pattern)].map((match) => ({ value: Math.abs(Number(match[1])), index: match.index }))
}

function addOffLadderFinding(findings, path, source, index, property, value, symbol) {
  findings.push(makeFinding(
    'off-ladder-design-value',
    path,
    source,
    index,
    `${property} authors ${value} outside the approved design-system ladder.`,
    symbol,
  ))
}

function normalizedCssSelectorAt(searchable, index) {
  const open = searchable.lastIndexOf('{', index)
  if (open < 0) return undefined
  const previousBoundary = Math.max(
    searchable.lastIndexOf('{', open - 1),
    searchable.lastIndexOf('}', open - 1),
  )
  const selector = searchable.slice(previousBoundary + 1, open).trim().replace(/\s+/g, ' ')
  return selector || undefined
}

function scanCssDesignValues(findings, path, source, searchable) {
  const declaration = /([\w-]+)\s*:\s*([^;{}]+);/g
  for (const match of searchable.matchAll(declaration)) {
    const property = match[1].toLowerCase()
    const value = match[2].trim()
    const valueIndex = match.index + match[0].indexOf(match[2])
    const symbol = normalizedCssSelectorAt(searchable, match.index)

    let ladder
    if (property === 'font-size') ladder = ALLOWED_VALUES['font-size']
    else if (property === 'border-radius') ladder = ALLOWED_VALUES['border-radius']
    else if (/^(?:gap|row-gap|column-gap|margin(?:-.+)?)$/.test(property)) ladder = ALLOWED_VALUES['layout-spacing']
    else if (/^padding(?:-.+)?$/.test(property)) ladder = ALLOWED_VALUES['inset-spacing']

    if (ladder) {
      for (const numeric of numericValues(value, 'px')) {
        if (!ladder.has(numeric.value)) {
          addOffLadderFinding(findings, path, source, valueIndex + numeric.index, property, `${numeric.value}px`, symbol)
        }
      }
      if (property === 'border-radius') {
        for (const numeric of numericValues(value, '%')) {
          if (numeric.value !== 50) {
            addOffLadderFinding(findings, path, source, valueIndex + numeric.index, property, `${numeric.value}%`, symbol)
          }
        }
      }
    }

    if (property === 'font-weight' && /^\d+$/.test(value) && !ALLOWED_VALUES['font-weight'].has(Number(value))) {
      addOffLadderFinding(findings, path, source, valueIndex, property, value, symbol)
    }
    if (property === 'line-height' && /^\d+(?:\.\d+)?$/.test(value) && !ALLOWED_VALUES['line-height'].has(Number(value))) {
      addOffLadderFinding(findings, path, source, valueIndex, property, value, symbol)
    }
    if (property === 'letter-spacing' && /^-?\d+(?:\.\d+)?em$/.test(value)) {
      const numeric = Math.abs(Number.parseFloat(value))
      if (!ALLOWED_VALUES['letter-spacing'].has(numeric)) {
        addOffLadderFinding(findings, path, source, valueIndex, property, value, symbol)
      }
    }
    if (/^(?:animation|transition)(?:-.+)?$/.test(property)) {
      for (const numeric of numericValues(value, 'ms')) {
        if (!ALLOWED_VALUES.duration.has(numeric.value)) {
          addOffLadderFinding(findings, path, source, valueIndex + numeric.index, property, `${numeric.value}ms`, symbol)
        }
      }
    }
  }
}

function closingBraceAt(source, open) {
  let depth = 1
  let quote = null
  let escaped = false
  for (let index = open + 1; index < source.length; index += 1) {
    const character = source[index]
    if (quote) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === quote) quote = null
      continue
    }
    if (character === '"' || character === "'" || character === '`') quote = character
    else if (character === '{') depth += 1
    else if (character === '}' && --depth === 0) return index
  }
  return undefined
}

function bracedRanges(source, patterns, symbolAt) {
  const ranges = []
  const openings = new Set()
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const open = match.index + match[0].lastIndexOf('{')
      if (openings.has(open)) continue
      openings.add(open)
      const end = closingBraceAt(source, open)
      if (end !== undefined) ranges.push({ symbol: symbolAt?.(match), start: open, end })
    }
  }
  return ranges
}

function functionRanges(source) {
  return bracedRanges(
    source,
    [/\b(?:export\s+)?function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)[^{]*\{/g],
    (match) => match[1],
  )
}

function styleObjectRanges(source) {
  return bracedRanges(source, [
    /\b(?:const|let|var)\s+(?:(?:[A-Za-z_$][\w$]*)?(?:style|styles))\s*(?::[^=;\n]+)?=\s*\{/gi,
    /\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*:\s*(?:React\.)?CSSProperties\s*=\s*\{/g,
    /\bstyle\s*=\s*\{\s*\{/g,
  ])
}

function symbolAtIndex(ranges, index) {
  return ranges.filter((range) => range.start <= index && range.end >= index).sort((a, b) => b.start - a.start)[0]?.symbol
}

function scanTypeScriptDesignValues(findings, path, source, searchable) {
  const ranges = functionRanges(searchable)
  const styleRanges = styleObjectRanges(searchable)
  const propertyPattern = /\b(fontSize|borderRadius|gap|rowGap|columnGap|padding(?:Block|Inline|Top|Right|Bottom|Left)?|margin(?:Block|Inline|Top|Right|Bottom|Left)?)\s*:\s*(?:(['"])(-?\d+(?:\.\d+)?)px\2|(-?\d+(?:\.\d+)?))/g
  for (const match of searchable.matchAll(propertyPattern)) {
    const explicitPixels = match[3] !== undefined
    if (!explicitPixels && !styleRanges.some((range) => range.start <= match.index && range.end >= match.index)) continue
    const property = match[1]
    const cssProperty = property.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`)
    const ladder = cssProperty === 'font-size'
      ? ALLOWED_VALUES['font-size']
      : cssProperty === 'border-radius'
        ? ALLOWED_VALUES['border-radius']
        : /^(?:gap|row-gap|column-gap|margin(?:-.+)?)$/.test(cssProperty)
          ? ALLOWED_VALUES['layout-spacing']
          : ALLOWED_VALUES['inset-spacing']
    const authoredValue = match[3] ?? match[4]
    const numeric = Math.abs(Number(authoredValue))
    if (!ladder.has(numeric)) {
      const index = match.index + match[0].indexOf(authoredValue)
      addOffLadderFinding(findings, path, source, index, cssProperty, `${numeric}px`, symbolAtIndex(ranges, index))
    }
  }
}

function scanCustomProperties(findings, path, source, searchable, css) {
  const patterns = css
    ? [/(?<![A-Za-z0-9_.-])(--[A-Za-z][\w-]*)\s*:/g, /var\(\s*(--[A-Za-z][\w-]*)/g]
    : [/["'](--[A-Za-z][\w-]*)["']\s*:/g, /var\(\s*(--[A-Za-z][\w-]*)/g]

  for (const pattern of patterns) {
    for (const match of searchable.matchAll(pattern)) {
      const symbol = match[2] ?? match[1]
      if (symbol.startsWith('--e-')) continue
      const index = match.index + match[0].indexOf(symbol)
      findings.push(makeFinding(
        'obsolete-custom-property',
        path,
        source,
        index,
        `${symbol} is outside the --e-* design authority.`,
        symbol,
      ))
    }
  }
}

const OBSOLETE_CONTEXT_KEYS = [
  'peekIntro',
  'chainPreviewGateIntro',
  'chainPreviewPeekIntro',
  'chainFreshOne',
  'chainFreshMany',
  'chainAllFresh',
  'chainAllFreshHint',
  'ctxConversationNote',
  'versionContextNote',
]

function userVisibleChunks(path, searchable) {
  const chunks = []
  if (path === 'src/shared/words.ts') {
    for (const match of searchable.matchAll(/:\s*(["'])([^\r\n]*?)\1/g)) {
      chunks.push({ text: match[2], index: match.index + match[0].indexOf(match[2]) })
    }
  }
  if (path.endsWith('.tsx')) {
    for (const match of searchable.matchAll(/>([^<>{}]+)</g)) {
      chunks.push({ text: match[1], index: match.index + 1 })
    }
    for (const match of searchable.matchAll(/\b(?:aria-label|title|placeholder|data-tip)\s*=\s*(["'])(.*?)\1/g)) {
      chunks.push({ text: match[2], index: match.index + match[0].indexOf(match[2]) })
    }
  }
  return chunks
}

function decodeStaticString(value) {
  const simpleEscapes = {
    0: '\0',
    b: '\b',
    f: '\f',
    n: '\n',
    r: '\r',
    t: '\t',
    v: '\v',
  }
  return value.replace(
    /\\(?:(\r\n|[\r\n])|u\{([0-9a-f]{1,6})\}|u([0-9a-f]{4})|x([0-9a-f]{2})|([^\r\n]))/gi,
    (escape, lineContinuation, bracedCodePoint, fixedCodePoint, hexCodePoint, simple) => {
      if (lineContinuation) return ''
      if (bracedCodePoint) {
        const codePoint = Number.parseInt(bracedCodePoint, 16)
        return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : escape
      }
      if (fixedCodePoint) return String.fromCharCode(Number.parseInt(fixedCodePoint, 16))
      if (hexCodePoint) return String.fromCharCode(Number.parseInt(hexCodePoint, 16))
      return simpleEscapes[simple] ?? simple
    },
  )
}

function indexWordLiterals(files) {
  const words = new Map()
  const input = files.find((file) => normalizePath(file.path) === 'src/shared/words.ts')
  if (!input) return words

  const searchable = maskComments(input.source, false)
  const property = /^[\t ]*([A-Za-z_$][\w$]*)[\t ]*:[\t ]*(?:'((?:\\.|[^\\'\r\n])*)'|"((?:\\.|[^\\"\r\n])*)")[\t ]*,?[\t ]*$/gm
  for (const match of searchable.matchAll(property)) {
    words.set(match[1], decodeStaticString(match[2] ?? match[3]))
  }
  return words
}

function normalizedChipLabel(value) {
  return value.trim().replace(/\s+/g, ' ')
}

function isMultiwordChipLabel(value) {
  const label = normalizedChipLabel(value)
  return label !== 'This card' && label.split(' ').length > 1
}

function hasTemplateInterpolation(value) {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '\\') index += 1
    else if (value[index] === '$' && value[index + 1] === '{') return true
  }
  return false
}

function staticJsxStringLabel(body) {
  const singleQuoted = /^\s*\{\s*'((?:\\.|[^\\'\r\n])*)'\s*\}\s*$/.exec(body)
  if (singleQuoted) return { raw: singleQuoted[1], value: decodeStaticString(singleQuoted[1]) }
  const doubleQuoted = /^\s*\{\s*"((?:\\.|[^\\"\r\n])*)"\s*\}\s*$/.exec(body)
  if (doubleQuoted) return { raw: doubleQuoted[1], value: decodeStaticString(doubleQuoted[1]) }
  const template = /^\s*\{\s*`((?:\\[\s\S]|[^\\`])*)`\s*\}\s*$/.exec(body)
  return template && !hasTemplateInterpolation(template[1])
    ? { raw: template[1], value: decodeStaticString(template[1]) }
    : undefined
}

function scanChipLabels(findings, path, source, searchable, words) {
  for (const match of searchable.matchAll(/<Chip\b[^>]*>([\s\S]*?)<\/Chip\s*>/g)) {
    const body = match[1]
    const bodyIndex = match.index + match[0].indexOf(body)
    const staticString = staticJsxStringLabel(body)
    if (staticString !== undefined) {
      const label = staticString.value
      if (isMultiwordChipLabel(label)) {
        findings.push(makeFinding(
          'multiword-chip',
          path,
          source,
          bodyIndex + body.indexOf(staticString.raw),
          `Chip label "${normalizedChipLabel(label)}" must be one word; only "This card" is approved as two words.`,
          'Chip',
        ))
      }
      continue
    }

    const wordsReference = /^\s*\{\s*words\.([A-Za-z_$][\w$]*)\s*\}\s*$/.exec(body)
    if (wordsReference) {
      const key = wordsReference[1]
      const label = words.get(key)
      if (label !== undefined && isMultiwordChipLabel(label)) {
        const index = bodyIndex + body.indexOf(`words.${key}`)
        findings.push(makeFinding(
          'multiword-chip',
          path,
          source,
          index,
          `Chip label "${normalizedChipLabel(label)}" must be one word; only "This card" is approved as two words.`,
          `words.${key}`,
        ))
      }
      continue
    }

    if (/[<>{}]/.test(body)) continue
    const label = normalizedChipLabel(body)
    if (!label || !isMultiwordChipLabel(label)) continue
    const leadingWhitespace = body.length - body.trimStart().length
    findings.push(makeFinding(
      'multiword-chip',
      path,
      source,
      bodyIndex + leadingWhitespace,
      `Chip label "${label}" must be one word; only "This card" is approved as two words.`,
      'Chip',
    ))
  }
}

function scanCopy(findings, path, source, searchable) {
  for (const chunk of userVisibleChunks(path, searchable)) {
    for (const match of chunk.text.matchAll(/\b(configur(?:e|ed|ing)|manag(?:e|ed|ing)|enabl(?:e|ed|ing)|workspaces?|preferences?|optimi[sz](?:e|ed|ing)|leverag(?:e|ed|ing)|seamless(?:ly)?)\b/gi)) {
      findings.push(makeFinding(
        'forbidden-copy',
        path,
        source,
        chunk.index + match.index,
        `User-visible copy uses forbidden SaaS vocabulary: ${match[0]}.`,
      ))
    }
    for (const match of chunk.text.matchAll(/\b(running|writing|saving|loading|streaming|working)\s*(?:…|\.{3})/gi)) {
      findings.push(makeFinding(
        'running-ellipsis',
        path,
        source,
        chunk.index + match.index,
        `In-flight state ${match[0]} must use the shared pulse without an ellipsis.`,
      ))
    }
    if (path !== 'src/shared/words.ts') {
      for (const match of chunk.text.matchAll(/(?:everything this Ask sees|this shows what this Ask will see|already fresh and will be reused)/gi)) {
        findings.push(makeFinding(
          'obsolete-context-prose',
          path,
          source,
          chunk.index + match.index,
          'Context surfaces are row-led and may not carry the obsolete explanatory prose.',
        ))
      }
    }
  }

  if (path === 'src/shared/words.ts') {
    const keyPattern = new RegExp(`\\b(${OBSOLETE_CONTEXT_KEYS.join('|')})\\s*:`, 'g')
    for (const match of searchable.matchAll(keyPattern)) {
      findings.push(makeFinding(
        'obsolete-context-prose',
        path,
        source,
        match.index,
        `${match[1]} preserves prose retired by the row-led context contract.`,
        match[1],
      ))
    }
  }
}

function scanReference(findings, path, source) {
  const wireRule = source.match(/\.e-wire-hit\s*\{([^}]*)\}/s)
  if (!wireRule || !/stroke-width\s*:\s*28(?:px)?\s*;/i.test(wireRule[1])) {
    findings.push(makeFinding(
      'reference-whole-wire-hit',
      path,
      source,
      wireRule?.index ?? 0,
      'The reference whole-wire interaction stroke must be exactly 28px, never 16px.',
    ))
  }

  const cardRule = source.match(/\.e-card\s*\{([^}]*)\}/s)
  const hasMinimum = cardRule && /min-width\s*:\s*200px\s*;/.test(cardRule[1]) && /min-height\s*:\s*120px\s*;/.test(cardRule[1])
  const hasWidthClamp = /Math\.max\(\s*200\s*,\s*w\s*\)/.test(source)
  const hasHeightClamp = /Math\.max\(\s*120\s*,\s*(?:hh|h)\s*\)/.test(source)
  const hasFixedScroll = /\.e-card[^{}]*fixed-height[^{}]*\.e-card-body\s*\{[^}]*overflow-y\s*:\s*(?:auto|scroll)\s*;/s.test(source)
  if (!hasMinimum || !hasWidthClamp || !hasHeightClamp || !hasFixedScroll || /Math\.max\(\s*170\s*,/.test(source)) {
    findings.push(makeFinding(
      'reference-card-resize',
      path,
      source,
      cardRule?.index ?? 0,
      'The reference must preserve a 200×120 minimum and fixed-height body scrolling; it may not clamp cards to 170px or content height.',
    ))
  }

  for (const pattern of [/function changes for your approval/gi, /nothing here is settled/gi]) {
    for (const match of source.matchAll(pattern)) {
      findings.push(makeFinding(
        'reference-stale-approval-copy',
        path,
        source,
        match.index,
        'The approved design system may not describe its function changes as awaiting approval or unsettled.',
      ))
    }
  }

  // The Picker inventory used to live in the reference's proposals section. That
  // section is gone (the system is approved, so a page of pending proposals was
  // describing a state that no longer exists), and the inventory moved into the
  // kit beside the Picker specimen itself, which is where someone reaching for
  // the component will actually read it. The anchor is an id rather than a
  // heading, so rewording the paragraph cannot silently disable the rule.
  const usesStart = source.search(/id=["']picker-uses["']/i)
  const usesEnd = usesStart >= 0 ? source.indexOf('</p>', usesStart) : -1
  const uses = usesStart >= 0 && usesEnd >= 0 ? source.slice(usesStart, usesEnd) : ''
  const usesText = uses.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')
  const requiredPickerUses = [
    /Ask(?: AI)? model/i,
    /Conversation style/i,
    /Group model/i,
    /playback speed/i,
  ]
  const missingPickerUses = requiredPickerUses.filter((pattern) => !pattern.test(usesText))
  if (!uses || missingPickerUses.length > 0) {
    findings.push(makeFinding(
      'reference-picker-inventory',
      path,
      source,
      Math.max(0, usesStart),
      'The reference must carry a #picker-uses note naming all four current Picker uses: Ask model, Conversation style, Group model, and playback speed.',
    ))
  }

  const playbackStart = source.search(/>\s*Playback transport\s*</i)
  const playback = playbackStart >= 0 ? source.slice(playbackStart, playbackStart + 3000) : ''
  if (
    !/class=["'][^"']*\be-picker\b[^"']*\bcompact\b[^"']*["']/i.test(playback) ||
    !/aria-label=["']Playback speed["']/i.test(playback) ||
    /class=["'][^"']*\be-seg\b[^"']*["']/i.test(playback)
  ) {
    findings.push(makeFinding(
      'reference-playback-picker',
      path,
      source,
      Math.max(0, playbackStart),
      'The playback speed specimen must render the compact Picker, never a segmented control.',
    ))
  }
}

function isExempt(finding, exemption) {
  return finding.rule === exemption.rule &&
    (!exemption.path || finding.path === exemption.path) &&
    (!exemption.symbol || finding.symbol === exemption.symbol)
}

export function scanDesignSystemFiles(files, { exemptions = DESIGN_SYSTEM_EXEMPTIONS } = {}) {
  validateDesignSystemExemptions(exemptions)
  const findings = []
  const wordLiterals = indexWordLiterals(files)

  for (const input of files) {
    const path = normalizePath(input.path)
    const source = input.source
    if (path === REFERENCE_PATH) {
      scanReference(findings, path, source)
      continue
    }

    const css = path.endsWith('.css')
    const typescript = path.endsWith('.ts') || path.endsWith('.tsx')
    const searchable = maskComments(source, css)
    addMatches(findings, {
      rule: 'legacy-class',
      path,
      source,
      searchable,
      pattern: /(?<![\w-])(tb-btn|mini-btn|tool-btn)(?![\w-])/g,
      message: (match) => `${match[1]} is a retired compatibility class.`,
      symbolAt: (match) => match[1],
    })

    if (path.endsWith('.tsx')) {
      addMatches(findings, {
        rule: 'native-select',
        path,
        source,
        searchable,
        pattern: /<\s*(select)\b/gi,
        message: () => 'Native JSX <select> must use the shared Picker.',
        symbolAt: () => 'select',
      })
    }
    if (/\.[cm]?[jt]sx?$/.test(path)) {
      addMatches(findings, {
        rule: 'native-dialog',
        path,
        source,
        searchable,
        pattern: /\bwindow\s*\.\s*(confirm|prompt)\s*\(/g,
        message: (match) => `window.${match[1]} must use the shared dialog service.`,
        symbolAt: (match) => `window.${match[1]}`,
      })
    }

    if (PRODUCTION_EXTENSIONS.has(extname(path))) {
      if (css) {
        addMatches(findings, {
          rule: 'raw-colour',
          path,
          source,
          searchable,
          pattern: /(#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})(?![0-9a-f]))/gi,
          message: (match) => `Authored colour ${match[1]} must come from a semantic token.`,
        })
        addMatches(findings, {
          rule: 'raw-colour',
          path,
          source,
          searchable,
          pattern: /\b((?:rgba?|hsla?)\(\s*[-+]?(?:\d|\.))/gi,
          message: (match) => `Authored ${match[1].split('(')[0]} colour must come from a semantic token.`,
        })
      } else {
        addMatches(findings, {
          rule: 'raw-colour',
          path,
          source,
          searchable,
          pattern: /(#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})(?![0-9a-f]))/gi,
          message: (match) => `Authored colour ${match[1]} must come from the token or user-colour authority.`,
          symbolAt: (_match, index) => imageCompressionPolicySymbolAt(path, searchable, index),
          include: (match, index) => isTypeScriptHexColour(searchable, index, match[1]),
        })
        addMatches(findings, {
          rule: 'raw-colour',
          path,
          source,
          searchable,
          pattern: /\b((?:rgba?|hsla?)\(\s*[-+]?(?:\d|\.))/gi,
          message: (match) => `Authored ${match[1].split('(')[0]} colour must come from a semantic token.`,
          symbolAt: (_match, index) => imageCompressionPolicySymbolAt(path, searchable, index),
        })
      }
    }

    if (css) scanCssDesignValues(findings, path, source, searchable)
    else if (typescript) scanTypeScriptDesignValues(findings, path, source, searchable)
    if (css || typescript) {
      scanCustomProperties(findings, path, source, searchable, css)
    }
    if (path === 'src/shared/words.ts' || path.endsWith('.tsx')) scanCopy(findings, path, source, searchable)
    if (path.endsWith('.tsx')) scanChipLabels(findings, path, source, searchable, wordLiterals)
  }

  return findings
    .filter((finding) => !exemptions.some((exemption) => isExempt(finding, exemption)))
    .sort((left, right) =>
      left.path.localeCompare(right.path) ||
      left.line - right.line ||
      left.column - right.column ||
      left.rule.localeCompare(right.rule),
    )
}

function walkFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name)
    return entry.isDirectory() ? walkFiles(path) : [path]
  })
}

export function collectProductionDesignSystemFiles(root = process.cwd()) {
  const sourceRoot = resolve(root, 'src')
  const paths = walkFiles(sourceRoot)
    .filter((path) => PRODUCTION_EXTENSIONS.has(extname(path)))
    .filter((path) => !NON_PRODUCTION_SUFFIX.test(path))
  paths.push(resolve(root, REFERENCE_PATH))
  return paths
    .sort()
    .map((path) => ({ path: normalizePath(relative(root, path)), source: readFileSync(path, 'utf8') }))
}

export function scanProductionDesignSystem(root = process.cwd()) {
  return scanDesignSystemFiles(collectProductionDesignSystemFiles(root))
}

function printHumanReport(findings) {
  if (findings.length === 0) {
    console.log(`PASS design-system authority (${DESIGN_SYSTEM_EXEMPTIONS.length} narrow evidence records)`)
    return
  }
  const counts = new Map()
  for (const finding of findings) counts.set(finding.rule, (counts.get(finding.rule) ?? 0) + 1)
  console.error(`FAIL design-system authority: ${findings.length} finding(s) across ${counts.size} rule(s).`)
  for (const [rule, count] of [...counts].sort()) console.error(`  ${rule}: ${count}`)
  for (const finding of findings) {
    console.error(`${finding.path}:${finding.line}:${finding.column} [${finding.rule}] ${finding.message}`)
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const findings = scanProductionDesignSystem(process.cwd())
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ exemptions: DESIGN_SYSTEM_EXEMPTIONS, findings }, null, 2))
  } else {
    printHumanReport(findings)
  }
  process.exitCode = findings.length === 0 ? 0 : 1
}
