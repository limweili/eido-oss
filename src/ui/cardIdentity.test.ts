import { describe, expect, it } from 'vitest'
import {
  CARD_IDENTITIES,
  DEFAULT_CARD_IDENTITY,
  resolveCardIdentity,
} from './cardIdentity'
import { DESIGN_TOKENS, type DesignTokenName, type ThemeId } from './tokens'

const WARM_INK = '#232019'
const WARM_PAPER = '#f8f6f1'
const DARK_CARD_SURFACE = '#2b2725'

const BODY_FOREGROUND_TOKEN_BY_ROLE = {
  ink: '--e-ink',
  inkSoft: '--e-ink-soft',
  inkFaint: '--e-ink-faint',
  goInk: '--e-go-ink',
  avoidInk: '--e-avoid-ink',
  modInk: '--e-mod-ink',
  convoInk: '--e-convo-ink',
  attentionInk: '--e-attention-ink',
} as const satisfies Readonly<Record<string, DesignTokenName>>

type BodyForegroundRole = keyof typeof BODY_FOREGROUND_TOKEN_BY_ROLE
type BodyForegrounds = Readonly<Record<BodyForegroundRole, string>>
type ResolvedWithRoleAwareBody = ReturnType<typeof resolveCardIdentity> & {
  bodyForegrounds: BodyForegrounds
  bodyForegroundsLight: BodyForegrounds
  bodyForegroundsDark: BodyForegrounds
}

const BODY_FOREGROUND_ROLES = Object.keys(
  BODY_FOREGROUND_TOKEN_BY_ROLE,
) as BodyForegroundRole[]
const READABLE_BODY_FOREGROUND_ROLES = BODY_FOREGROUND_ROLES.filter(
  role => role !== 'inkFaint',
)

const EXPECTED_IDENTITIES = [
  ['Coral', '#f1666d', WARM_INK],
  ['Red', '#c9282e', WARM_PAPER],
  ['Amber', '#eca23b', WARM_INK],
  ['Orange', '#b5540f', WARM_PAPER],
  ['Mint', '#65b563', WARM_INK],
  ['Green', '#1b7550', WARM_PAPER],
  ['Sky', '#48a2ef', WARM_INK],
  ['Blue', '#3568c6', WARM_PAPER],
  ['Orchid', '#d66be8', WARM_INK],
  ['Purple', '#9c3fba', WARM_PAPER],
  ['Slate', '#8b939c', WARM_INK],
  ['Charcoal', '#2e2b25', WARM_PAPER],
] as const

function channelToLinear(channel: number): number {
  const srgb = channel / 255
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
}

function hexChannels(hex: string): [number, number, number] {
  return [1, 3, 5].map((offset) => (
    Number.parseInt(hex.slice(offset, offset + 2), 16)
  )) as [number, number, number]
}

function luminanceChannels(channels: readonly [number, number, number]): number {
  const linear = channels.map(channelToLinear)
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!
}

function luminance(hex: string): number {
  const channels = hexChannels(hex)
  const linear = channels.map(channelToLinear)
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!
}

function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((left, right) => right - left)
  return (lighter! + 0.05) / (darker! + 0.05)
}

function halfSrgbChannels(color: string, surface: string): [number, number, number] {
  const colorChannels = hexChannels(color)
  const surfaceChannels = hexChannels(surface)
  return colorChannels.map((channel, index) => (
    channel + surfaceChannels[index]!
  ) / 2) as [number, number, number]
}

function halfSrgbMix(color: string, surface: string): string {
  const channels = halfSrgbChannels(color, surface)
  return `#${channels
    .map((channel) => Math.round(channel).toString(16).padStart(2, '0'))
    .join('')}`
}

function exactMixContrast(background: [number, number, number], foreground: string): number {
  const [lighter, darker] = [
    luminanceChannels(background),
    luminance(foreground),
  ].sort((left, right) => right - left)
  return (lighter! + 0.05) / (darker! + 0.05)
}

function bodySurfaceForTheme(solid: string, theme: ThemeId): [number, number, number] {
  return halfSrgbChannels(solid, DESIGN_TOKENS[theme]['--e-surface-card'])
}

describe('card identity authority', () => {
  it('exposes the approved rainbow-ordered 6-column by 2-row palette', () => {
    expect(CARD_IDENTITIES.map(({ name, solid, onSolid }) => [name, solid, onSolid])).toEqual(
      EXPECTED_IDENTITIES,
    )
    expect(DEFAULT_CARD_IDENTITY).toBe('#9c3fba')
  })

  it('uses assigned warm header on-colours for all twelve identities', () => {
    for (const [name, solid, onSolid] of EXPECTED_IDENTITIES) {
      expect(resolveCardIdentity(solid)).toMatchObject({ solid, onSolid, paletteIdentity: name })
    }

    expect(resolveCardIdentity('#F1666D')).toMatchObject({
      solid: '#F1666D',
      onSolid: WARM_INK,
      paletteIdentity: 'Coral',
    })
    expect(resolveCardIdentity('#3568C6')).toMatchObject({
      solid: '#3568C6',
      onSolid: WARM_PAPER,
      paletteIdentity: 'Blue',
    })
  })

  it.each([
    ['#fefefe', WARM_INK],
    ['#101010', WARM_PAPER],
    ['#A1b2C3', WARM_INK],
  ] as const)(
    'uses opaque six-digit custom %s byte-for-byte with the approved warm %s role',
    (raw, expectedOnSolid) => {
      const resolved = resolveCardIdentity(raw)
      expect(resolved.solid).toBe(raw)
      expect(resolved.onSolid).toBe(expectedOnSolid)
      expect(resolved.paletteIdentity).toBeUndefined()
      expect(resolved).not.toHaveProperty('onSolidLight')
      expect(resolved).not.toHaveProperty('onSolidDark')
    },
  )

  it.each([
    ['#fefefe', WARM_INK],
    ['#101010', WARM_PAPER],
    ['#A1b2C3', WARM_INK],
  ] as const)('keeps the warm custom fallback at WCAG AA for %s', (raw, expectedOnSolid) => {
    expect(contrastRatio(raw, expectedOnSolid)).toBeGreaterThanOrEqual(4.5)
  })

  it('tightens a warm role only through the mid-luminance gap', () => {
    const resolved = resolveCardIdentity('#777777')
    expect(resolved.solid).toBe('#777777')
    expect([WARM_INK, WARM_PAPER, '#000000', '#ffffff']).not.toContain(resolved.onSolid)
    expect(contrastRatio(resolved.solid, resolved.onSolid)).toBeGreaterThanOrEqual(4.5)
  })

  it('derives AA body ink against the exact 50% sRGB tint in both themes', () => {
    expect(halfSrgbMix('#eca23b', WARM_PAPER)).toBe('#f2cc96')
    expect(halfSrgbMix('#eca23b', DARK_CARD_SURFACE)).toBe('#8c6530')

    for (const solid of [...CARD_IDENTITIES.map((identity) => identity.solid), '#777777']) {
      const resolved = resolveCardIdentity(solid)
      const bodyLight = halfSrgbChannels(solid, WARM_PAPER)
      const bodyDark = halfSrgbChannels(solid, DARK_CARD_SURFACE)

      expect(resolved.body, solid).toBe(
        `color-mix(in srgb, ${solid} 50%, var(--e-surface-card))`,
      )
      expect(resolved.bodyInkLight, `${solid} light body ink`).toMatch(/^#[\da-f]{6}$/i)
      expect(resolved.bodyInkDark, `${solid} dark body ink`).toMatch(/^#[\da-f]{6}$/i)
      expect(
        exactMixContrast(bodyLight, resolved.bodyInkLight),
        `${solid} light body`,
      ).toBeGreaterThanOrEqual(4.5)
      expect(
        exactMixContrast(bodyDark, resolved.bodyInkDark),
        `${solid} dark body`,
      ).toBeGreaterThanOrEqual(4.5)
      expect(resolved.bodyInk).toBe(
        resolved.bodyInkLight === resolved.bodyInkDark
          ? resolved.bodyInkLight
          : `light-dark(${resolved.bodyInkLight}, ${resolved.bodyInkDark})`,
      )
    }
  })

  it('keeps body text on warm roles and tightens only as far as AA requires', () => {
    expect(resolveCardIdentity('#777777')).toMatchObject({
      bodyInkLight: DESIGN_TOKENS.light['--e-ink'],
      bodyInkDark: DESIGN_TOKENS.dark['--e-ink'],
    })
    expect(resolveCardIdentity('#eca23b')).toMatchObject({
      bodyInkLight: WARM_INK,
      bodyInkDark: '#f1ede4',
      bodyInk: `light-dark(${WARM_INK}, #f1ede4)`,
    })
  })

  it('derives every readable theme role from token authority and minimally tightens only failing roles', () => {
    const solids = [
      ...CARD_IDENTITIES.map(identity => identity.solid),
      '#777777',
      '#fefefe',
      '#101010',
    ]

    for (const solid of solids) {
      const resolved = resolveCardIdentity(solid) as ResolvedWithRoleAwareBody

      for (const theme of ['light', 'dark'] as const) {
        const foregrounds = theme === 'light'
          ? resolved.bodyForegroundsLight
          : resolved.bodyForegroundsDark
        const body = bodySurfaceForTheme(solid, theme)

        for (const role of READABLE_BODY_FOREGROUND_ROLES) {
          const intended = DESIGN_TOKENS[theme][BODY_FOREGROUND_TOKEN_BY_ROLE[role]]
          const actual = foregrounds?.[role]

          expect(actual, `${solid} ${theme} ${role}`).toMatch(/^#[\da-f]{6}$/i)
          expect(
            exactMixContrast(body, actual),
            `${solid} ${theme} ${role}`,
          ).toBeGreaterThanOrEqual(4.5)

          if (exactMixContrast(body, intended) >= 4.5) {
            expect(actual, `${solid} ${theme} ${role} already passed`).toBe(intended)
          }

          expect(resolved.bodyForegrounds?.[role], `${solid} paired ${role}`).toBe(
            resolved.bodyForegroundsLight[role] === resolved.bodyForegroundsDark[role]
              ? resolved.bodyForegroundsLight[role]
              : `light-dark(${resolved.bodyForegroundsLight[role]}, ${resolved.bodyForegroundsDark[role]})`,
          )
        }
      }
    }
  })

  it('keeps faint as the theme decoration role instead of promoting it to readable ink', () => {
    for (const solid of [...CARD_IDENTITIES.map(identity => identity.solid), '#777777']) {
      const resolved = resolveCardIdentity(solid) as ResolvedWithRoleAwareBody
      expect(resolved.bodyForegroundsLight.inkFaint).toBe(DESIGN_TOKENS.light['--e-ink-faint'])
      expect(resolved.bodyForegroundsDark.inkFaint).toBe(DESIGN_TOKENS.dark['--e-ink-faint'])
    }
  })

  it('pins the role-aware foregrounds for the mid-gap custom identity', () => {
    const resolved = resolveCardIdentity('#777777') as ResolvedWithRoleAwareBody

    expect(resolved.bodyForegroundsLight).toEqual({
      ink: '#232019',
      inkSoft: '#4d483e',
      inkFaint: '#847d70',
      goInk: '#225044',
      avoidInk: '#7e2f1a',
      modInk: '#503b84',
      convoInk: '#244687',
      attentionInk: '#5f4304',
    })
    expect(resolved.bodyForegroundsDark).toEqual({
      ink: '#ece7db',
      inkSoft: '#c7c0b4',
      inkFaint: '#8b8375',
      goInk: '#92cdb7',
      avoidInk: '#f0b39e',
      modInk: '#cbb8f1',
      convoInk: '#a6c2f3',
      attentionInk: '#e6bb67',
    })
  })

  it.each([
    '#abc',
    '#abcd',
    '#aabbccdd',
    '#gg0000',
    'rgb(1 2 3)',
    '',
  ])('safely renders unsupported legacy or invalid %j through the default identity', (raw) => {
    const resolved = resolveCardIdentity(raw)

    expect(resolved).toMatchObject({
      solid: DEFAULT_CARD_IDENTITY,
      onSolid: WARM_PAPER,
      paletteIdentity: 'Purple',
    })
    expect(resolved.soft).toContain(DEFAULT_CARD_IDENTITY)
    expect(resolved.body).toContain(DEFAULT_CARD_IDENTITY)
    expect(resolved.patternHead).toContain(DEFAULT_CARD_IDENTITY)
    expect(resolved.pattern).toContain(DEFAULT_CARD_IDENTITY)
    expect(resolved).not.toHaveProperty('onSolidLight')
    expect(resolved).not.toHaveProperty('onSolidDark')
  })
})
