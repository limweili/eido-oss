import type {
  ConnectionPolarity,
  ConnectionRole,
  ConnectionStrength,
} from '../../graph/types'

export const CONNECTION_INTERACTION_STROKE_WIDTH_PX = 28
export const CONNECTION_DIRECT_STROKE_WIDTH = 3
export const CONNECTION_LIGHT_STROKE_WIDTH = 1.5

const DOTTED_CONNECTION_DASH = [0.1, 7] as const
const SOLID_CONNECTION_DASH: readonly number[] = []

export type ConnectionColorRole = 'helps' | 'avoid' | 'modifies'

export function connectionColor(colorRole: ConnectionColorRole): string {
  if (colorRole === 'modifies') return 'var(--e-mod)'
  if (colorRole === 'avoid') return 'var(--e-avoid)'
  return 'var(--e-go)'
}

export type ConnectionAppearance = Readonly<{
  colorRole: ConnectionColorRole
  strokeWidth: number
  dash: readonly number[]
  opacity: number
}>

export type ConnectionAppearanceInput = Readonly<{
  strength: ConnectionStrength
  polarity: ConnectionPolarity
  role: ConnectionRole
  ghost?: boolean
  hovered?: boolean
}>

/**
 * The one semantic stroke grammar shared by SVG edges and the canvas painter.
 * Strength owns weight, kind owns color/dotting, and transient states may only
 * change the dimensions named by the design system.
 */
export function connectionAppearance({
  strength,
  polarity,
  role,
  ghost = false,
  hovered = false,
}: ConnectionAppearanceInput): ConnectionAppearance {
  const colorRole: ConnectionColorRole =
    role === 'modifies' ? 'modifies' : polarity === 'pushesAgainst' ? 'avoid' : 'helps'
  const dotted = colorRole === 'avoid' || colorRole === 'modifies'
  return {
    colorRole,
    strokeWidth:
      (strength === 'weak' ? CONNECTION_LIGHT_STROKE_WIDTH : CONNECTION_DIRECT_STROKE_WIDTH) +
      (hovered ? 1.2 : 0),
    dash: dotted ? DOTTED_CONNECTION_DASH : SOLID_CONNECTION_DASH,
    opacity: ghost ? 0.42 : 1,
  }
}

/** The creation preview keeps its existing weight/alpha but uses the one dot pattern. */
export function connectionPreviewAppearance() {
  return {
    strokeWidth: 2.5,
    dash: DOTTED_CONNECTION_DASH,
    opacity: 0.9,
  } as const
}

export function connectionDashCss(dash: readonly number[]): string | undefined {
  return dash.length ? dash.join(' ') : undefined
}
