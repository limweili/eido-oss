import {
  useId,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
import { useFloatingLayer, type FloatingDismissReason } from './floating'
import { useFloatingPortalDestination } from './FloatingPortalScope'
import { useExitPresence } from './presence'

export type PickerOption<Value extends string = string> = Readonly<{
  value: Value
  label: string
  // A soft second phrase on the option row: what choosing this one means, when
  // the label alone cannot say. The trigger never shows it.
  hint?: string
  disabled?: boolean
}>

export type PickerProps<Value extends string = string> = {
  value: Value | ''
  options: readonly PickerOption<Value>[]
  onValueChange: (value: Value) => void
  ariaLabel: string
  emptyLabel: string
  variant?: 'field' | 'compact'
  className?: string
  disabled?: boolean
}

function enabledIndex<Value extends string>(
  options: readonly PickerOption<Value>[],
  start: number,
  direction: 1 | -1,
): number {
  if (!options.length) return -1
  for (let offset = 0; offset < options.length; offset += 1) {
    const index = (start + direction * offset + options.length) % options.length
    if (!options[index]?.disabled) return index
  }
  return -1
}

export function Picker<Value extends string>({
  value,
  options,
  onValueChange,
  ariaLabel,
  emptyLabel,
  variant = 'field',
  className = '',
  disabled = false,
}: PickerProps<Value>) {
  const reactId = useId().replace(/:/g, '')
  const listboxId = `e-picker-${reactId}-listbox`
  const optionId = (index: number) => `e-picker-${reactId}-option-${index}`
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const listboxRef = useRef<HTMLDivElement | null>(null)
  const typeaheadRef = useRef('')
  const typeaheadTimerRef = useRef<number | null>(null)
  const retainTriggerFocusRef = useRef(false)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const selectedIndex = options.findIndex(option => option.value === value)
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined
  const presence = useExitPresence(open)
  const portalDestination = useFloatingPortalDestination()

  const firstEnabled = useMemo(() => enabledIndex(options, 0, 1), [options])
  const lastEnabled = useMemo(
    () => enabledIndex(options, Math.max(0, options.length - 1), -1),
    [options],
  )

  const resetTypeahead = useCallback(() => {
    if (typeaheadTimerRef.current !== null) {
      window.clearTimeout(typeaheadTimerRef.current)
    }
    typeaheadTimerRef.current = null
    typeaheadRef.current = ''
  }, [])

  useEffect(() => resetTypeahead, [resetTypeahead])

  const dismiss = (reason: FloatingDismissReason) => {
    retainTriggerFocusRef.current = false
    resetTypeahead()
    setOpen(false)
    if (reason === 'escape' && triggerRef.current?.isConnected) {
      triggerRef.current.focus()
    }
  }
  const position = useFloatingLayer({
    open: open && presence.mounted,
    triggerRef,
    layerRef: listboxRef,
    onDismiss: dismiss,
  })

  const openPicker = () => {
    if (disabled || open) return
    resetTypeahead()
    retainTriggerFocusRef.current = true
    setActiveIndex(
      selectedIndex >= 0 && !options[selectedIndex]?.disabled ? selectedIndex : firstEnabled,
    )
    setOpen(true)
  }

  const closePicker = () => {
    retainTriggerFocusRef.current = false
    resetTypeahead()
    setOpen(false)
  }

  useLayoutEffect(() => {
    if (!open) return
    const retainTriggerFocus = () => {
      const trigger = triggerRef.current
      if (
        !retainTriggerFocusRef.current ||
        !trigger?.isConnected ||
        document.activeElement === trigger
      ) return
      trigger.focus({ preventScroll: true })
    }

    document.addEventListener('focusin', retainTriggerFocus)
    retainTriggerFocus()
    return () => document.removeEventListener('focusin', retainTriggerFocus)
  }, [open])

  const move = (direction: 1 | -1) => {
    const origin = activeIndex >= 0 ? activeIndex + direction : direction > 0 ? 0 : options.length - 1
    const next = enabledIndex(options, origin, direction)
    if (next >= 0) setActiveIndex(next)
  }

  const commit = (index: number) => {
    const option = options[index]
    if (!option || option.disabled) return
    if (option.value !== value) onValueChange(option.value)
    closePicker()
    if (triggerRef.current?.isConnected) triggerRef.current.focus()
  }

  const typeahead = (key: string) => {
    if (typeaheadTimerRef.current !== null) window.clearTimeout(typeaheadTimerRef.current)
    typeaheadRef.current += key.toLocaleLowerCase()
    const query = typeaheadRef.current
    const match = options.findIndex(
      option => !option.disabled && option.label.toLocaleLowerCase().startsWith(query),
    )
    if (match >= 0) setActiveIndex(match)
    typeaheadTimerRef.current = window.setTimeout(() => {
      typeaheadRef.current = ''
      typeaheadTimerRef.current = null
    }, 700)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return
    const handled = [
      'ArrowDown',
      'ArrowUp',
      'Home',
      'End',
      'Enter',
      ' ',
    ].includes(event.key) || (event.key === 'Escape' && open)
    if (handled) {
      event.preventDefault()
      event.stopPropagation()
    }

    if (event.key === 'Enter' || event.key === ' ') {
      if (!open) openPicker()
      else if (activeIndex >= 0) commit(activeIndex)
      return
    }
    if (event.key === 'Escape') {
      if (open) closePicker()
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!open) {
        openPicker()
      } else {
        move(event.key === 'ArrowDown' ? 1 : -1)
      }
      return
    }
    if (event.key === 'Home') {
      if (!open) openPicker()
      setActiveIndex(firstEnabled)
      return
    }
    if (event.key === 'End') {
      if (!open) openPicker()
      setActiveIndex(lastEnabled)
      return
    }
    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.stopPropagation()
      if (!open) openPicker()
      typeahead(event.key)
    }
  }

  const onOptionPointerDown = (event: PointerEvent<HTMLDivElement>, index: number) => {
    event.preventDefault()
    if (!options[index]?.disabled) setActiveIndex(index)
  }

  const classes = ['e-picker', `e-picker--${variant}`, className].filter(Boolean).join(' ')

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={classes}
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
        disabled={disabled}
        onClick={() => (open ? closePicker() : openPicker())}
        onKeyDown={onKeyDown}
      >
        <span className={`e-picker__value${selected ? '' : ' e-picker__value--placeholder'}`}>
          {selected?.label ?? emptyLabel}
        </span>
        <ChevronDown className="e-picker__chevron" aria-hidden="true" />
      </button>
      {presence.mounted && portalDestination &&
        createPortal(
          <div
            ref={listboxRef}
            id={listboxId}
            className="e-picker__listbox"
            role="listbox"
            aria-label={ariaLabel}
            aria-hidden={presence.state === 'exiting' || undefined}
            {...(presence.state === 'exiting' ? { inert: '' } : {})}
            data-state={presence.state}
            data-side={position?.side ?? 'bottom'}
            onTransitionEnd={presence.onTransitionEnd}
            style={
              position
                ? {
                    left: position.left,
                    top: position.top,
                    minWidth: position.minWidth,
                    maxWidth: position.maxWidth,
                    maxHeight: position.maxHeight,
                  }
                : undefined
            }
          >
            {options.map((option, index) => (
              <div
                id={optionId(index)}
                key={option.value}
                className="e-picker__option"
                role="option"
                aria-selected={option.value === value}
                aria-disabled={option.disabled || undefined}
                data-active={activeIndex === index || undefined}
                onPointerDown={event => onOptionPointerDown(event, index)}
                onPointerEnter={() => {
                  if (!option.disabled) setActiveIndex(index)
                }}
                onClick={() => commit(index)}
              >
                <span className="e-picker__option-label">{option.label}</span>
                {option.hint && <span className="e-picker__option-hint">{option.hint}</span>}
                <span className="e-picker__check" aria-hidden="true">
                  {option.value === value ? '✓' : ''}
                </span>
              </div>
            ))}
          </div>,
          portalDestination,
        )}
    </>
  )
}
