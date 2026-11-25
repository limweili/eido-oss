import { useRef, type CSSProperties, type KeyboardEvent } from 'react'
import { Tooltip } from './Tooltip'

export type ColourPickerOption<Value extends string> = Readonly<{
  value: Value
  label: string
  swatch: string
}>

export type ColourPickerModeOption<Mode extends string> = Readonly<{
  value: Mode
  label: string
  tooltip: string
  className: string
}>

export type ColourPickerProps<Value extends string, Mode extends string = string> = {
  value?: Value
  options: readonly ColourPickerOption<Value>[]
  onValueChange: (value: Value) => void
  ariaLabel: string
  label?: string
  modeAriaLabel?: string
  modeValue?: Mode
  modeOptions?: readonly ColourPickerModeOption<Mode>[]
  onModeValueChange?: (value: Mode) => void
  className?: string
}

type ColourPickerSwatchStyle = CSSProperties & {
  '--e-colour-picker-swatch': string
}

type GridFlow =
  | Readonly<{ flow: 'column'; rows: number }>
  | Readonly<{ flow: 'row'; columns: number }>

function nextGridIndex(
  index: number,
  key: string,
  count: number,
  layout: GridFlow,
): number | null {
  if (count === 0) return null
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) return null

  const rows = layout.flow === 'column' ? layout.rows : Math.ceil(count / layout.columns)
  const columns = layout.flow === 'row' ? layout.columns : Math.ceil(count / layout.rows)
  const row = layout.flow === 'column' ? index % rows : Math.floor(index / columns)
  const column = layout.flow === 'row' ? index % columns : Math.floor(index / rows)
  const horizontal = key === 'ArrowLeft' || key === 'ArrowRight'
  const track = horizontal ? columns : rows
  const direction = key === 'ArrowRight' || key === 'ArrowDown' ? 1 : -1
  for (let distance = 1; distance <= track; distance += 1) {
    const nextRow = horizontal ? row : (row + direction * distance + rows) % rows
    const nextColumn = horizontal
      ? (column + direction * distance + columns) % columns
      : column
    const candidate = layout.flow === 'column'
      ? nextColumn * rows + nextRow
      : nextRow * columns + nextColumn
    if (candidate < count) return candidate
  }
  return index
}

export function ColourPicker<Value extends string, Mode extends string = string>({
  value,
  options,
  onValueChange,
  ariaLabel,
  label,
  modeAriaLabel,
  modeValue,
  modeOptions = [],
  onModeValueChange,
  className = '',
}: ColourPickerProps<Value, Mode>) {
  const optionRefs = useRef(new Map<Value, HTMLButtonElement>())
  const modeRefs = useRef(new Map<Mode, HTMLButtonElement>())
  const selectedIndex = options.findIndex((option) => option.value === value)
  const tabIndex = selectedIndex >= 0 ? selectedIndex : 0
  const selectedModeIndex = modeOptions.findIndex((option) => option.value === modeValue)
  const modeTabIndex = selectedModeIndex >= 0 ? selectedModeIndex : 0

  const select = (index: number) => {
    const option = options[index]
    if (!option) return
    if (option.value !== value) onValueChange(option.value)
    optionRefs.current.get(option.value)?.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const nextIndex = nextGridIndex(index, event.key, options.length, { flow: 'column', rows: 2 })
    if (nextIndex === null) return
    event.preventDefault()
    event.stopPropagation()
    select(nextIndex)
  }

  const selectMode = (index: number) => {
    const option = modeOptions[index]
    if (!option) return
    if (option.value !== modeValue) onModeValueChange?.(option.value)
    modeRefs.current.get(option.value)?.focus()
  }

  const onModeKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const nextIndex = nextGridIndex(index, event.key, modeOptions.length, {
      flow: 'row',
      columns: 2,
    })
    if (nextIndex === null) return
    event.preventDefault()
    event.stopPropagation()
    selectMode(nextIndex)
  }

  return (
    <div className={['e-colour-picker', className].filter(Boolean).join(' ')}>
      {label && <div className="e-colour-picker__label t-micro">{label}</div>}
      <div className="e-colour-picker__controls">
        {modeOptions.length > 0 && (
          <>
            <div
              className="e-colour-picker__modes"
              role="radiogroup"
              aria-label={modeAriaLabel}
            >
              {modeOptions.map((option, index) => (
                <Tooltip key={option.value} content={option.tooltip}>
                  <button
                    ref={(button) => {
                      if (button) modeRefs.current.set(option.value, button)
                      else modeRefs.current.delete(option.value)
                    }}
                    type="button"
                    className={`e-colour-picker__mode ${option.className}`}
                    role="radio"
                    aria-checked={option.value === modeValue}
                    aria-label={option.label}
                    tabIndex={index === modeTabIndex ? 0 : -1}
                    onClick={() => selectMode(index)}
                    onKeyDown={(event) => onModeKeyDown(event, index)}
                  />
                </Tooltip>
              ))}
            </div>
            <div className="e-colour-picker__divider" />
          </>
        )}
        <div
          className="e-colour-picker__swatches"
          role="radiogroup"
          aria-label={ariaLabel}
        >
          {options.map((option, index) => (
            <button
              key={option.value}
              ref={(button) => {
                if (button) optionRefs.current.set(option.value, button)
                else optionRefs.current.delete(option.value)
              }}
              type="button"
              className="e-colour-picker__swatch"
              role="radio"
              aria-checked={option.value === value}
              aria-label={option.label}
              tabIndex={index === tabIndex ? 0 : -1}
              style={{ '--e-colour-picker-swatch': option.swatch } as ColourPickerSwatchStyle}
              onClick={() => select(index)}
              onKeyDown={(event) => onKeyDown(event, index)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
