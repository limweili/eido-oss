// Lucide icons this project needs that the pinned lucide-react does not carry
// yet, built with Lucide's own factory so they are icons in every way that
// matters: same 24x24 grid, same `currentColor` stroke, same size and
// stroke-width props, same `LucideIcon` type at every call site.
//
// The alternative was upgrading lucide-react from 0.468 to 1.x for one glyph,
// across the twenty-four files that import from it, in a major version that
// renames and retires icons. That is a large, unrelated risk to carry for a
// single addition. When the dependency next moves for its own reasons, delete
// the entry here and import the real one; the call sites do not change.
import { createLucideIcon } from 'lucide-react'

// https://lucide.dev/icons/square-text, verbatim from the icon's source.
export const SquareText = createLucideIcon('SquareText', [
  ['rect', { width: '18', height: '18', x: '3', y: '3', rx: '2', key: 'afitv7' }],
  ['path', { d: 'M7 8h8', key: 'squaretext-a' }],
  ['path', { d: 'M7 12h10', key: 'squaretext-b' }],
  ['path', { d: 'M7 16h6', key: 'squaretext-c' }],
])
