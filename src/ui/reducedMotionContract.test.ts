import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { renderDesignTokenCss } from './tokens'

function source(path: string): string {
  return readFileSync(path, 'utf8')
}

// A brace-balanced scan, not a regex, because `fitViewOptions={{ ... }}` can
// legitimately nest braces (e.g. `padding: {x: 1}`) and a lazy `[^}]*` class
// stops at the first one it meets - silently letting a `duration:` past the
// nested brace through undetected. The identifier form `fitViewOptions={x}`
// is rejected outright: this scan cannot see inside a variable, so it cannot
// prove that variable is duration-free, and an unprovable seam is the same
// bypass risk as a proven one.
function fitViewOptionsViolations(text: string): string[] {
  const marker = 'fitViewOptions={'
  const violations: string[] = []
  let searchFrom = 0
  for (;;) {
    const start = text.indexOf(marker, searchFrom)
    if (start === -1) break
    const literalOpen = start + marker.length
    if (text[literalOpen] !== '{') {
      violations.push(
        `fitViewOptions at offset ${start} is not an inline object literal - it cannot be proven duration-free`,
      )
      searchFrom = literalOpen
      continue
    }
    let depth = 0
    let end = -1
    for (let i = literalOpen; i < text.length; i += 1) {
      if (text[i] === '{') depth += 1
      else if (text[i] === '}') {
        depth -= 1
        if (depth === 0) {
          end = i
          break
        }
      }
    }
    if (end === -1) {
      violations.push(`fitViewOptions object literal at offset ${start} never closes`)
      break
    }
    const body = text.slice(literalOpen, end + 1)
    if (/\bduration\b/.test(body)) {
      violations.push(`fitViewOptions at offset ${start} carries a duration: ${body}`)
    }
    searchFrom = end + 1
  }
  return violations
}

const styleModules = Array.from(
  source('src/styles.css').matchAll(/@import '\.\/styles\/([^']+)';/g),
  match => match[1],
)

describe('app-wide reduced-motion contract', () => {
  it('uses the runtime document attribute as the only authored CSS authority', () => {
    const authoredCascade = styleModules
      .map(module => source(`src/styles/${module}`))
      .join('\n')
    const foundation = source('src/styles/000-foundation.css')

    expect(styleModules).toContain('006-overlays.css')
    expect(authoredCascade).not.toContain('@media (prefers-reduced-motion: reduce)')
    expect(foundation).toContain(':root[data-reduced-motion="true"]')
    expect(foundation).toContain('animation-duration: var(--e-t-fast) !important;')
    expect(foundation).toContain('animation-delay: 0ms !important;')
    expect(foundation).toContain('transition-duration: var(--e-t-fast) !important;')
    expect(foundation).toContain('transition-delay: 0ms !important;')
  })

  it('routes reduced overlay fades through the runtime document attribute', () => {
    const overlays = source('src/styles/006-overlays.css')

    expect(overlays).toMatch(
      /:root\[data-reduced-motion="true"\] \.e-overlay-backdrop\s*\{[^}]*transition-duration:\s*var\(--e-t-reduced-fade\) !important;/s,
    )
    expect(overlays).toMatch(
      /:root\[data-reduced-motion="true"\] \.e-modal-shell\s*\{[^}]*transition-duration:\s*var\(--e-t-reduced-fade\), var\(--e-t-fast\) !important;/s,
    )
  })

  it('overrides transform timing, fades, and delays in the token authority', () => {
    const css = renderDesignTokenCss()
    const reduced = css.split(':root[data-reduced-motion="true"] {')[1] ?? ''

    expect(reduced).toContain('--e-t-fast: 1ms;')
    expect(reduced).toContain('--e-t-exit: 1ms;')
    expect(reduced).toContain('--e-t-move: 1ms;')
    expect(reduced).toContain('--e-t-move-far: 1ms;')
    expect(reduced).toContain('--e-t-camera: 1ms;')
    expect(reduced).toContain('--e-t-intent: 0ms;')
    expect(reduced).toContain('--e-t-fade: 80ms;')
  })

  it('holds streaming dots still while keeping connection completion events alive', () => {
    const streaming = source('src/styles/110-conversation-cards.css')
    const connections = source('src/styles/070-board-interactions.css')

    expect(streaming).toMatch(
      /:root\[data-reduced-motion="true"\] \.streaming-dot\s*\{[^}]*animation:\s*none !important;[^}]*opacity:\s*1;/s,
    )
    expect(connections).toMatch(
      /:root\[data-reduced-motion="true"\][\s\S]*?\.connection-pulse[\s\S]*?animation-duration:\s*var\(--e-t-fast\);[\s\S]*?animation-delay:\s*0ms;/,
    )
  })

  it('keeps reduced-motion camera viewport transforms transition-free', () => {
    const board = source('src/styles/020-board.css')

    expect(board).toMatch(
      /:root\[data-reduced-motion="true"\] \.board-flow \.react-flow__viewport\s*\{[^}]*transition:\s*none !important;/s,
    )
  })

  it('routes animated camera calls through the shared duration seam while exact framing stays instant', () => {
    const app = source('src/App.tsx')
    const board = source('src/canvas/Board.tsx')
    const presence = source('src/ui/primitives/presence.ts')

    expect(app).toContain('useAppliedReducedMotion')
    expect(app.match(/\bfitBounds\(/g)).toHaveLength(
      app.match(/duration:\s*cameraDuration\(/g)?.length ?? 0,
    )
    const boardCameraCalls = board.match(/\b(?:fitBounds|setCenter|setViewport)\(/g) ?? []
    const governedBoardDurations =
      board.match(/(?:duration:\s*|const duration\s*=\s*)cameraDuration\(/g) ?? []
    expect(board).toContain('void setViewport(nextViewport, { duration: 0 })')
    expect(board).toContain('void setViewport(nextViewport)')
    // fitViewOptions is allowed, but only to cap the bootstrap fit's zoom; it
    // must never carry a duration - directly or behind a nested object - and
    // must never hide behind an opaque identifier this check cannot see
    // inside, because either shape could bypass the governed camera seam.
    expect(fitViewOptionsViolations(board)).toEqual([])
    expect(governedBoardDurations).toHaveLength(boardCameraCalls.length - 2)
    expect(presence).toContain('getReducedMotionSnapshot')
    expect(presence).not.toContain('matchMedia')
  })

  it('keeps semantic playback progression independent from reduced motion', () => {
    const app = source('src/App.tsx')
    expect(app).toContain(
      'const next = Math.min(1, current + (delta * playbackSpeed) / PLAYBACK_DURATION_MS)',
    )
    expect(app).not.toMatch(/PLAYBACK_DURATION_MS[^\n]*reducedMotion/)
  })
})
