import type { CSSProperties } from 'react'
import {
  CARD_COLOUR_MODE_OPTIONS,
  type CardColourMode,
} from '../../canvas/cards/CardShell'
import type { CardHeaderFill } from '../../graph/types'
import { modChromeWords, setModColourLabel, words } from '../../shared/words'
import {
  CARD_IDENTITIES,
  resolveCardIdentity,
  type ResolvedCardIdentity,
} from '../../ui/cardIdentity'
import { ColourPicker, type ColourPickerOption } from '../../ui/primitives'
import type { Mod } from '../model'

type ModAccent = (typeof CARD_IDENTITIES)[number]['solid']

const MOD_IDENTITY_OPTIONS: readonly ColourPickerOption<ModAccent>[] = CARD_IDENTITIES.map(
  (identity) => ({
    value: identity.solid,
    label: setModColourLabel(identity.name),
    swatch: identity.solid,
  }),
)

export type ModIdentityStyle = CSSProperties & {
  '--e-mod-face-accent': string
  '--card-header-ink': string
  '--card-header-soft': string
}

export function modIdentityStyle(accent: string): {
  identity: ResolvedCardIdentity
  style: ModIdentityStyle
} {
  const identity = resolveCardIdentity(accent)
  return {
    identity,
    style: {
      '--e-mod-face-accent': identity.solid,
      '--card-header-ink': identity.onSolid,
      '--card-header-soft': identity.soft,
    },
  }
}

export type ModIdentityWellProps = Readonly<{
  mod: Pick<Mod, 'accent'>
  onAccentChange: (accent: string) => void
  /** The card's chosen fill style; undefined means no fill. */
  fill?: CardHeaderFill
  onFillChange?: (mode: CardColourMode) => void
  label?: string
  className?: string
}>

export function ModIdentityWell({
  mod,
  onAccentChange,
  fill,
  onFillChange,
  label = modChromeWords.colour,
  className = '',
}: ModIdentityWellProps) {
  const { identity, style } = modIdentityStyle(mod.accent)
  const selected = identity.paletteIdentity
    ? MOD_IDENTITY_OPTIONS.find((option) => option.value.toLowerCase() === identity.solid.toLowerCase())?.value
    : undefined

  return (
    <div
      className={['mod-identity-well', className].filter(Boolean).join(' ')}
      data-testid="mod-identity-well"
      style={style}
    >
      <ColourPicker
        ariaLabel={label}
        label={label}
        value={selected}
        options={MOD_IDENTITY_OPTIONS}
        onValueChange={onAccentChange}
        {...(onFillChange
          ? {
            modeAriaLabel: words.cardColourFillStyle,
            modeValue: (fill ?? 'none') as CardColourMode,
            modeOptions: CARD_COLOUR_MODE_OPTIONS,
            onModeValueChange: onFillChange,
          }
          : {})}
      />
    </div>
  )
}
