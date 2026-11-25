import { useLayoutEffect, useRef } from 'react'

type AutoGrowElement = {
  style: { height: string }
  scrollHeight: number
  clientHeight: number
}

// The height-write decision, extracted from the hook so the focused-editor
// rules stay unit-testable. While an editor is focused the destructive
// height:auto reset must never run (it makes the caret's scroll position
// jump — #117/#118) — there is no bypass. Growth-only writes are safe while
// focused: content that outgrew the current height would otherwise stay
// clipped behind overflow:hidden until remount (#207). A stale-too-tall
// focused editor heals on the next unfocused measure (blur or remount).
export function applyAutoGrow(
  el: AutoGrowElement,
  input: {
    focused: boolean
    fixedHeight: boolean
    growWithinFixedHeight?: boolean
    skipWhileFocused?: boolean
  },
) {
  const skipFocused = (input.skipWhileFocused ?? true) && input.focused
  if (input.fixedHeight && !input.growWithinFixedHeight) {
    if (skipFocused) return
    el.style.height = '' // CSS (flex:1) fills the card body
    return
  }
  if (skipFocused) {
    if (el.scrollHeight > el.clientHeight + 1) el.style.height = `${el.scrollHeight}px`
    return
  }
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

// Keeps a textarea fitted to its text. When a card has been manually expanded,
// most editors hand height back to CSS so the textarea fills the card. Note cards
// opt into growing inside the fixed-height scroller so attachments flow after text.
export function useAutoGrow(
  _value: string,
  fixedHeight: boolean,
  options: { growWithinFixedHeight?: boolean; skipWhileFocused?: boolean } = {},
) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const modeRef = useRef({ fixedHeight, options })
  modeRef.current = { fixedHeight, options }

  const isFocused = (el: HTMLTextAreaElement) =>
    typeof document !== 'undefined' && document.activeElement === el

  // Measure after every commit so conditionally mounted editors size correctly
  // even when their text value did not change during the mount.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    applyAutoGrow(el, { focused: isFocused(el), fixedHeight, ...options })
  })

  // A width change re-wraps text, so once the resize gesture settles take
  // another measurement. It goes through the same focus rules as every other
  // write: a focused editor may only grow, never the height:auto reset.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let lastWidth = el.clientWidth
    let settleTimer: number | undefined
    const observer = new ResizeObserver(() => {
      const width = el.clientWidth
      if (Math.abs(width - lastWidth) < 1) return // our own height writes
      lastWidth = width
      window.clearTimeout(settleTimer)
      settleTimer = window.setTimeout(() => {
        const { fixedHeight, options } = modeRef.current
        // The unfocused height:auto reset momentarily shortens the scroller's
        // content, which would clamp its scroll position — restore it.
        const scroller = el.parentElement
        const scrollTop = scroller?.scrollTop ?? 0
        applyAutoGrow(el, { focused: isFocused(el), fixedHeight, ...options })
        if (scroller) scroller.scrollTop = scrollTop
      }, 150)
    })
    observer.observe(el)
    return () => {
      observer.disconnect()
      window.clearTimeout(settleTimer)
    }
  }, [])

  return ref
}
