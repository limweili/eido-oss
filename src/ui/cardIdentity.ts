import {
  DESIGN_TOKENS,
  type DesignTokenName,
  type ThemeId,
} from './tokens'
import {
  CARD_IDENTITY_PRESETS,
  type CardIdentityPresetId,
} from '../graph/cardIdentityPresets'
import { words } from '../shared/words'

export type CardIdentity = {
  name: string
  solid: string
  onSolid: string
}

const WARM_INK = DESIGN_TOKENS.light['--e-ink']
const WARM_PAPER = DESIGN_TOKENS.light['--e-on-solid']
const BLACK_ENDPOINT = '#000000'
const WHITE_ENDPOINT = '#ffffff'
const AA_CONTRAST = 4.5
const OPAQUE_HEX = /^#[\da-f]{6}$/i

export type CardBodyForegrounds = Readonly<{
  ink: string
  inkSoft: string
  inkFaint: string
  goInk: string
  avoidInk: string
  modInk: string
  convoInk: string
  attentionInk: string
}>

const BODY_FOREGROUND_TOKEN_BY_ROLE = {
  ink: '--e-ink',
  inkSoft: '--e-ink-soft',
  inkFaint: '--e-ink-faint',
  goInk: '--e-go-ink',
  avoidInk: '--e-avoid-ink',
  modInk: '--e-mod-ink',
  convoInk: '--e-convo-ink',
  attentionInk: '--e-attention-ink',
} as const satisfies Readonly<Record<keyof CardBodyForegrounds, DesignTokenName>>

const CARD_IDENTITY_NAME_BY_ID = {
  coral: words.cardIdentityCoral,
  red: words.cardIdentityRed,
  amber: words.cardIdentityAmber,
  orange: words.cardIdentityOrange,
  mint: words.cardIdentityMint,
  green: words.cardIdentityGreen,
  sky: words.cardIdentitySky,
  blue: words.cardIdentityBlue,
  orchid: words.cardIdentityOrchid,
  purple: words.cardIdentityPurple,
  slate: words.cardIdentitySlate,
  charcoal: words.cardIdentityCharcoal,
} as const satisfies Readonly<Record<CardIdentityPresetId, string>>

const CARD_IDENTITY_ON_SOLID_BY_ID = {
  coral: WARM_INK,
  red: WARM_PAPER,
  amber: WARM_INK,
  orange: WARM_PAPER,
  mint: WARM_INK,
  green: WARM_PAPER,
  sky: WARM_INK,
  blue: WARM_PAPER,
  orchid: WARM_INK,
  purple: WARM_PAPER,
  slate: WARM_INK,
  charcoal: WARM_PAPER,
} as const satisfies Readonly<Record<CardIdentityPresetId, string>>

export const CARD_IDENTITIES = Object.freeze(CARD_IDENTITY_PRESETS.map(
  ({ id, solid }) => Object.freeze({
    name: CARD_IDENTITY_NAME_BY_ID[id],
    solid,
    onSolid: CARD_IDENTITY_ON_SOLID_BY_ID[id],
  }),
)) satisfies readonly CardIdentity[]

export const DEFAULT_CARD_IDENTITY = CARD_IDENTITY_PRESETS.find(
  ({ id }) => id === 'purple',
)!.solid

export type ResolvedCardIdentity = {
  solid: string
  onSolid: string
  soft: string
  body: string
  bodyInk: string
  bodyInkLight: string
  bodyInkDark: string
  bodyForegrounds: CardBodyForegrounds
  bodyForegroundsLight: CardBodyForegrounds
  bodyForegroundsDark: CardBodyForegrounds
  patternHead: string
  pattern: string
  paletteIdentity?: (typeof CARD_IDENTITIES)[number]['name']
}

type Rgb = { r: number; g: number; b: number }

function parseHexColor(rawColor: string): Rgb | undefined {
  const match = OPAQUE_HEX.exec(rawColor)
  if (!match) return undefined

  const raw = match[0].slice(1)
  return {
    r: Number.parseInt(raw.slice(0, 2), 16),
    g: Number.parseInt(raw.slice(2, 4), 16),
    b: Number.parseInt(raw.slice(4, 6), 16),
  }
}

function linearChannel(channel: number): number {
  const srgb = channel / 255
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
}

function relativeLuminance(rgb: Rgb): number {
  return 0.2126 * linearChannel(rgb.r) + 0.7152 * linearChannel(rgb.g) + 0.0722 * linearChannel(rgb.b)
}

function contrastRatio(background: Rgb, foreground: Rgb): number {
  const backgroundLuminance = relativeLuminance(background)
  const foregroundLuminance = relativeLuminance(foreground)
  return (
    (Math.max(backgroundLuminance, foregroundLuminance) + 0.05)
    / (Math.min(backgroundLuminance, foregroundLuminance) + 0.05)
  )
}

function toHex(rgb: Rgb): string {
  return `#${[rgb.r, rgb.g, rgb.b]
    .map((channel) => Math.round(channel).toString(16).padStart(2, '0'))
    .join('')}`
}

function halfSrgbMix(left: Rgb, right: Rgb): Rgb {
  return {
    r: (left.r + right.r) / 2,
    g: (left.g + right.g) / 2,
    b: (left.b + right.b) / 2,
  }
}

type TightenedOnColor = { color: string; amount: number }

function tightenWarmRole(
  background: Rgb,
  warmColor: string,
  endpointColor: string,
): TightenedOnColor | undefined {
  const warm = parseHexColor(warmColor)!
  if (contrastRatio(background, warm) >= AA_CONTRAST) {
    return { color: warmColor, amount: 0 }
  }

  const endpoint = parseHexColor(endpointColor)!
  if (contrastRatio(background, endpoint) < AA_CONTRAST) return undefined

  // Stay on the approved warm role's RGB path and stop at the first 8-bit
  // colour that clears AA. The absolute endpoint is only a bound, not the
  // ordinary fallback returned to the UI.
  for (let step = 1; step <= 255; step += 1) {
    const amount = step / 255
    const candidate = {
      r: warm.r + (endpoint.r - warm.r) * amount,
      g: warm.g + (endpoint.g - warm.g) * amount,
      b: warm.b + (endpoint.b - warm.b) * amount,
    }
    const quantized = parseHexColor(toHex(candidate))!
    if (contrastRatio(background, quantized) >= AA_CONTRAST) {
      return { color: toHex(quantized), amount }
    }
  }

  return { color: endpointColor, amount: 1 }
}

function warmOnColor(background: Rgb): string {
  const tightened = [
    tightenWarmRole(background, WARM_INK, BLACK_ENDPOINT),
    tightenWarmRole(background, WARM_PAPER, WHITE_ENDPOINT),
  ]
    .filter((candidate): candidate is TightenedOnColor => candidate !== undefined)
    .sort((left, right) => left.amount - right.amount)
  return tightened[0]?.color ?? WARM_INK
}

function accessibleRoleColor(background: Rgb, intendedColor: string): string {
  const intended = parseHexColor(intendedColor)!
  if (contrastRatio(background, intended) >= AA_CONTRAST) return intendedColor

  const tightened = [BLACK_ENDPOINT, WHITE_ENDPOINT]
    .map(endpoint => tightenWarmRole(background, intendedColor, endpoint))
    .filter((candidate): candidate is TightenedOnColor => candidate !== undefined)
    .sort((left, right) => left.amount - right.amount)
  return tightened[0]?.color ?? intendedColor
}

function bodyForegroundsForTheme(solid: Rgb, theme: ThemeId): CardBodyForegrounds {
  const body = halfSrgbMix(solid, parseHexColor(DESIGN_TOKENS[theme]['--e-surface-card'])!)
  return Object.fromEntries(
    Object.entries(BODY_FOREGROUND_TOKEN_BY_ROLE).map(([role, token]) => {
      const intended = DESIGN_TOKENS[theme][token]
      return [
        role,
        role === 'inkFaint' ? intended : accessibleRoleColor(body, intended),
      ]
    }),
  ) as unknown as CardBodyForegrounds
}

function pairThemeForegrounds(
  light: CardBodyForegrounds,
  dark: CardBodyForegrounds,
): CardBodyForegrounds {
  return Object.fromEntries(
    Object.keys(BODY_FOREGROUND_TOKEN_BY_ROLE).map((rawRole) => {
      const role = rawRole as keyof CardBodyForegrounds
      return [
        role,
        light[role] === dark[role]
          ? light[role]
          : `light-dark(${light[role]}, ${dark[role]})`,
      ]
    }),
  ) as unknown as CardBodyForegrounds
}

function customOnColor(rawColor: string): string {
  const rgb = parseHexColor(rawColor)
  return rgb ? warmOnColor(rgb) : WARM_INK
}

export function resolveCardIdentity(rawColor: string): ResolvedCardIdentity {
  const solid = OPAQUE_HEX.test(rawColor) ? rawColor : DEFAULT_CARD_IDENTITY
  const paletteIdentity = CARD_IDENTITIES.find(
    (identity) => identity.solid.toLowerCase() === solid.toLowerCase(),
  )
  const onSolid = paletteIdentity?.onSolid ?? customOnColor(solid)
  const solidRgb = parseHexColor(solid)!
  const bodyForegroundsLight = bodyForegroundsForTheme(solidRgb, 'light')
  const bodyForegroundsDark = bodyForegroundsForTheme(solidRgb, 'dark')
  const bodyForegrounds = pairThemeForegrounds(bodyForegroundsLight, bodyForegroundsDark)
  const bodyInkLight = bodyForegroundsLight.ink
  const bodyInkDark = bodyForegroundsDark.ink

  return {
    solid,
    onSolid,
    soft: `color-mix(in srgb, ${solid} 12%, var(--e-surface-card))`,
    body: `color-mix(in srgb, ${solid} 50%, var(--e-surface-card))`,
    bodyInk: bodyInkLight === bodyInkDark
      ? bodyInkLight
      : `light-dark(${bodyInkLight}, ${bodyInkDark})`,
    bodyInkLight,
    bodyInkDark,
    bodyForegrounds,
    bodyForegroundsLight,
    bodyForegroundsDark,
    patternHead: `color-mix(in srgb, ${solid} 10%, var(--e-surface-card))`,
    pattern: `color-mix(in srgb, ${solid} 20%, transparent)`,
    ...(paletteIdentity ? { paletteIdentity: paletteIdentity.name } : {}),
  }
}
