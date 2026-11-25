import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react'

export type SegmentedOption<Value extends string = string> = Readonly<{
  value: Value
  label: string
  disabled?: boolean
}>

export type SegmentedProps<Value extends string = string> = {
  ariaLabel: string
  value: Value
  options: readonly SegmentedOption<Value>[]
  onValueChange: (value: Value) => void
  className?: string
  disabled?: boolean
}

export function Segmented<Value extends string>({
  ariaLabel,
  value,
  options,
  onValueChange,
  className = '',
  disabled = false,
}: SegmentedProps<Value>) {
  const draggingPointerIdRef = useRef<number | null>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])

  useEffect(() => {
    const finish = (pointerId?: number) => {
      if (pointerId === undefined || draggingPointerIdRef.current === pointerId) {
        draggingPointerIdRef.current = null
      }
    }
    const finishPointer = (event: globalThis.PointerEvent) => finish(event.pointerId)
    const finishBlur = () => finish()
    window.addEventListener('pointerup', finishPointer)
    window.addEventListener('pointercancel', finishPointer)
    window.addEventListener('blur', finishBlur)
    return () => {
      window.removeEventListener('pointerup', finishPointer)
      window.removeEventListener('pointercancel', finishPointer)
      window.removeEventListener('blur', finishBlur)
    }
  }, [])

  const choose = (index: number, focus = false) => {
    const option = options[index]
    if (!option || option.disabled || disabled) return
    onValueChange(option.value)
    if (focus) {
      optionRefs.current[index]?.focus()
    }
  }

  const move = (event: KeyboardEvent<HTMLButtonElement>, direction: 1 | -1) => {
    const index = Number(event.currentTarget.dataset.eSegmentedIndex)
    for (let offset = 1; offset <= options.length; offset += 1) {
      const next = (index + direction * offset + options.length) % options.length
      if (!options[next]?.disabled) {
        event.preventDefault()
        event.stopPropagation()
        choose(next, true)
        return
      }
    }
  }

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>, index: number) => {
    if (disabled || options[index]?.disabled || event.button > 0) return
    event.preventDefault()
    event.currentTarget.focus()
    draggingPointerIdRef.current = event.pointerId
    choose(index)
  }

  const stopDragging = (event: PointerEvent<HTMLButtonElement>) => {
    if (draggingPointerIdRef.current === event.pointerId) draggingPointerIdRef.current = null
  }

  const selectedIndex = options.findIndex(option => option.value === value && !option.disabled)
  const firstEnabled = options.findIndex(option => !option.disabled)

  return (
    <div
      className={['e-segmented', className].filter(Boolean).join(' ')}
      role="radiogroup"
      aria-label={ariaLabel}
    >
      {options.map((option, index) => (
        <button
          ref={element => {
            optionRefs.current[index] = element
          }}
          key={option.value}
          type="button"
          className="e-segmented__option"
          role="radio"
          aria-checked={option.value === value}
          disabled={disabled || option.disabled}
          tabIndex={index === (selectedIndex >= 0 ? selectedIndex : firstEnabled) ? 0 : -1}
          data-e-segmented-index={index}
          onPointerDown={event => onPointerDown(event, index)}
          onPointerEnter={event => {
            if (draggingPointerIdRef.current === event.pointerId && event.buttons !== 0) choose(index)
          }}
          onPointerUp={stopDragging}
          onPointerCancel={stopDragging}
          onKeyDown={event => {
            if (event.key === 'ArrowRight' || event.key === 'ArrowDown') move(event, 1)
            else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') move(event, -1)
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
