import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react'

// A Title card is a canvas landmark whose type is sized by the box the founder
// drew, not by a fixed step: the label grows to fill a large card and shrinks
// to stay inside a small one. `--e-fs-title-canvas` stays the resting size for
// a Title card that carries no explicit box; these bounds and this line-height
// own the fitted range. The floor is the design system's own readability floor
// (SYSTEM.md 2.1). The ratio is unitless on purpose so a fitted font-size
// scales its own leading, and it must stay equal to the `.t-title-canvas`
// line-height in CSS.
//
// It lives with the canvas code that consumes it rather than beside the other
// metric owners in `src/ui/tokens.ts`, because that file is inside the packaged
// Profile runtime's certification closure: a canvas typography constant there
// would demand a two-platform native recertification for every tweak. Nothing
// outside the canvas reads these numbers, and none of them reaches CSS.
export const TITLE_CARD_TYPE_METRICS = Object.freeze({
  minFontSize: 11,
  maxFontSize: 200,
  lineHeight: 1.3,
})

/**
 * Title cards are canvas landmarks, so their type follows the box the founder
 * drew rather than a fixed step: one long word in a banner-sized card should
 * read as a banner, and the same word in a small card should still fit inside
 * it. The search below is the whole rule: the largest whole pixel size whose
 * wrapped text still fits the card's inner box, clamped to the named bounds.
 *
 * Both axes are measured, and the text is wrapped at word boundaries only:
 * a size that would split a word mid-word is rejected, so the label loses
 * points rather than legibility. Mid-word breaking survives in CSS purely as
 * the floor's safety net, for a word too long to fit even at the smallest size.
 *
 * Fitting is monotone (a larger font never wraps shorter), so a binary search
 * over the bounds finds the answer in ~8 measurements instead of one per step.
 */
export function fitFontSize(input: {
  box: { width: number; height: number }
  measure: (fontSize: number) => { width: number; height: number }
  bounds?: { min: number; max: number }
  lineHeight?: number
}): number {
  const { min, max } = input.bounds ?? {
    min: TITLE_CARD_TYPE_METRICS.minFontSize,
    max: TITLE_CARD_TYPE_METRICS.maxFontSize,
  }
  const lineHeight = input.lineHeight ?? TITLE_CARD_TYPE_METRICS.lineHeight
  if (!(input.box.height > 0) || !(input.box.width > 0)) return min

  // One line can never be shorter than its own leading, so the box height caps
  // the search before any measurement runs.
  let low = min
  let high = Math.min(max, Math.floor(input.box.height / lineHeight))
  let best = min
  while (low <= high) {
    const candidate = Math.floor((low + high) / 2)
    const measured = input.measure(candidate)
    if (measured.height <= input.box.height && measured.width <= input.box.width) {
      best = candidate
      low = candidate + 1
    } else {
      high = candidate - 1
    }
  }
  return best
}

// The measurement twin wears the same typography role as the visible editor, so
// family, weight, tracking, leading, and wrapping come from the CSS the editor
// obeys. Only font-size and geometry are authored here. It deliberately does
// not carry `.title-card-input`, so nothing that queries the editor can find
// the twin instead.
const MEASURE_CLASS = 'title-card-measure'

function measureTwin(host: HTMLElement): HTMLDivElement {
  const existing = host.querySelector<HTMLDivElement>(`.${MEASURE_CLASS}`)
  if (existing) return existing
  const twin = document.createElement('div')
  twin.className = `t-title-canvas ${MEASURE_CLASS}`
  twin.setAttribute('aria-hidden', 'true')
  host.appendChild(twin)
  return twin
}

// A trailing newline leaves no glyph for the layout engine to reserve a line
// for, so pad it; an empty card is fitted to the placeholder it actually shows.
function measuredContent(text: string, placeholder: string): string {
  const content = text.length > 0 ? text : placeholder
  return content.endsWith('\n') ? `${content} ` : content
}

export function fitTitleFontSize(
  el: HTMLTextAreaElement,
  text: string,
  placeholder: string,
): number | undefined {
  const host = el.parentElement
  if (!host) return undefined
  const width = el.clientWidth
  const height = el.clientHeight
  if (width <= 0 || height <= 0) return undefined

  const twin = measureTwin(host)
  twin.style.width = `${width}px`
  twin.textContent = measuredContent(text, placeholder)
  // `scrollWidth`/`scrollHeight` are integers. The painter measures the same
  // text in fractions, so at a Title card's type sizes a line that is a
  // fraction of a pixel too wide read as "fits" to the DOM and "too wide" to
  // the painter: the two halves then chose different sizes, and the DOM broke
  // a word its own fit rule promises to keep whole. Both halves now ask for
  // the same fractional answer.
  const range = document.createRange()
  const fitted = fitFontSize({
    box: { width, height },
    measure: (fontSize) => {
      twin.style.fontSize = `${fontSize}px`
      const twinBox = twin.getBoundingClientRect()
      // Client rects are screen geometry, and a Card on the canvas is inside a
      // scaled viewport, so the board zoom has to come back out of them. The
      // twin's own authored width is the scale: it is the one length here whose
      // layout value is already known.
      const scale = twinBox.width > 0 ? twinBox.width / width : 1
      range.selectNodeContents(twin)
      // The twin wraps at word boundaries only, so a word wider than the card
      // reports an overflowing line and that size is rejected. One rect per
      // laid-out line box; the widest is the axis a size is rejected on.
      let widest = 0
      for (const rect of range.getClientRects()) widest = Math.max(widest, rect.width)
      return { width: widest / scale, height: twinBox.height / scale }
    },
  })
  range.detach()
  twin.textContent = ''
  return fitted
}

/**
 * Keeps a Title card's editor sized to its card. It measures after every commit
 * (text edits) and on every box change (resize drags), coalesced into one frame
 * so a live drag costs one fit per painted frame. Repeat commits that changed
 * neither the text nor the box reuse the last fit instead of re-measuring.
 */
export function useFittedTitleFontSize(
  ref: RefObject<HTMLTextAreaElement | null>,
  text: string,
  placeholder: string,
  enabled: boolean,
) {
  const inputRef = useRef({ text, placeholder, enabled })
  inputRef.current = { text, placeholder, enabled }
  const lastFitRef = useRef<{ key: string; size: number } | null>(null)

  const apply = useCallback(() => {
    const el = ref.current
    if (!el) return
    const { text, placeholder, enabled } = inputRef.current
    if (!enabled) {
      el.style.fontSize = ''
      lastFitRef.current = null
      return
    }
    const key = `${el.clientWidth}x${el.clientHeight}:${text}:${placeholder}`
    const cached = lastFitRef.current
    if (cached?.key === key) {
      el.style.fontSize = `${cached.size}px`
      return
    }
    const fitted = fitTitleFontSize(el, text, placeholder)
    if (fitted === undefined) return
    lastFitRef.current = { key, size: fitted }
    el.style.fontSize = `${fitted}px`
  }, [ref])

  // Measure after every commit so a mount, a text edit, or a store-driven size
  // change all land on the same rule.
  useLayoutEffect(apply)

  // A resize drag changes the box without a React commit on every frame, so the
  // box itself is the second trigger.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let frame: number | undefined
    const observer = new ResizeObserver(() => {
      if (frame !== undefined) return
      frame = requestAnimationFrame(() => {
        frame = undefined
        apply()
      })
    })
    observer.observe(el)
    return () => {
      observer.disconnect()
      if (frame !== undefined) cancelAnimationFrame(frame)
    }
  }, [apply, ref])
}
