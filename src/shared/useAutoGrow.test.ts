import { describe, expect, it } from 'vitest'
import { applyAutoGrow } from './useAutoGrow'

// applyAutoGrow is useAutoGrow's height-write decision, extracted so the
// focused-editor rules (#117/#118 jitter fix, #207 growth-only writes) stay
// unit-testable without a real layout engine.

function fakeTextarea(overrides: { scrollHeight: number; clientHeight: number; height?: string }) {
  const el = {
    style: { height: overrides.height ?? '' },
    scrollHeight: overrides.scrollHeight,
    clientHeight: overrides.clientHeight,
  }
  return el
}

describe('applyAutoGrow', () => {
  it('grows a focused element whose content height increased', () => {
    const el = fakeTextarea({ scrollHeight: 400, clientHeight: 120, height: '120px' })

    applyAutoGrow(el, { focused: true, fixedHeight: true, growWithinFixedHeight: true, skipWhileFocused: true })

    expect(el.style.height).toBe('400px')
  })

  it('still skips the destructive reset while focused (focus-jitter regression, #117/#118)', () => {
    // Content fits: nothing to grow, and the height:auto reset must not run.
    const el = fakeTextarea({ scrollHeight: 120, clientHeight: 120, height: '120px' })

    applyAutoGrow(el, { focused: true, fixedHeight: true, growWithinFixedHeight: true, skipWhileFocused: true })

    expect(el.style.height).toBe('120px')
  })

  it('never shrinks a focused element even when content got shorter', () => {
    const el = fakeTextarea({ scrollHeight: 80, clientHeight: 300, height: '300px' })

    applyAutoGrow(el, { focused: true, fixedHeight: false, skipWhileFocused: true })

    expect(el.style.height).toBe('300px')
  })

  it('fully re-measures an unfocused element', () => {
    const writes: string[] = []
    const el = fakeTextarea({ scrollHeight: 400, clientHeight: 120 })
    Object.defineProperty(el, 'style', {
      value: {
        set height(v: string) {
          writes.push(v)
        },
        get height() {
          return writes[writes.length - 1] ?? ''
        },
      },
    })

    applyAutoGrow(el, { focused: false, fixedHeight: true, growWithinFixedHeight: true, skipWhileFocused: true })

    expect(writes).toEqual(['auto', '400px'])
  })

  it('stays growth-only for a focused element even on the resize-end re-measure', () => {
    // A width change re-wrapped the text shorter: while focused there must be
    // NO height:auto reset and no shrink — the #117/#118 skip has no bypass.
    const el = fakeTextarea({ scrollHeight: 200, clientHeight: 300, height: '300px' })

    applyAutoGrow(el, { focused: true, fixedHeight: true, growWithinFixedHeight: true, skipWhileFocused: true })

    expect(el.style.height).toBe('300px')
  })

  it('grows a focused element on the resize-end re-measure when re-wrap made text taller', () => {
    const el = fakeTextarea({ scrollHeight: 500, clientHeight: 300, height: '300px' })

    applyAutoGrow(el, { focused: true, fixedHeight: true, growWithinFixedHeight: true, skipWhileFocused: true })

    expect(el.style.height).toBe('500px')
  })

  it('hands height back to CSS for fixed-height editors that do not grow', () => {
    const el = fakeTextarea({ scrollHeight: 400, clientHeight: 120, height: '120px' })

    applyAutoGrow(el, { focused: false, fixedHeight: true, skipWhileFocused: true })

    expect(el.style.height).toBe('')
  })

  it('leaves a focused fixed-height non-growing editor alone', () => {
    const el = fakeTextarea({ scrollHeight: 400, clientHeight: 120, height: '120px' })

    applyAutoGrow(el, { focused: true, fixedHeight: true, skipWhileFocused: true })

    expect(el.style.height).toBe('120px')
  })
})
