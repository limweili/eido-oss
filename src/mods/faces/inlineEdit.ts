export type InlineEditOptions = Readonly<{
  ariaLabel: string
  commit: (value: string) => boolean | void
}>

export type InlineEditController = Readonly<{
  update: (value: string, enabled: boolean) => void
  dispose: () => void
}>

export function mountInlineEdit(
  element: HTMLElement,
  options: InlineEditOptions,
): InlineEditController {
  let value = ''
  let enabled = false
  let editing = false
  let cancelled = false
  let disposed = false

  element.classList.add('e-edit')
  element.spellcheck = false
  element.setAttribute('role', 'textbox')
  element.setAttribute('aria-label', options.ariaLabel)

  const finish = () => {
    if (!editing) return
    editing = false
    const next = element.textContent?.trim() ?? ''
    if (!cancelled && next && next !== value && options.commit(next) !== false) value = next
    cancelled = false
    element.textContent = value
  }

  const onFocus = () => {
    if (!enabled) {
      element.blur()
      return
    }
    editing = true
    cancelled = false
  }

  const onBlur = () => finish()

  const onPointerDown = (event: PointerEvent) => {
    if (enabled) event.stopPropagation()
  }

  const onClick = (event: MouseEvent) => {
    if (enabled) event.stopPropagation()
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (!enabled) return
    event.stopPropagation()
    if (event.key === 'Enter') {
      event.preventDefault()
      element.blur()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      cancelled = true
      element.textContent = value
      element.blur()
    }
  }

  element.addEventListener('focus', onFocus)
  element.addEventListener('blur', onBlur)
  element.addEventListener('pointerdown', onPointerDown)
  element.addEventListener('click', onClick)
  element.addEventListener('keydown', onKeyDown)

  return {
    update(nextValue, nextEnabled) {
      if (disposed) return
      value = nextValue
      enabled = nextEnabled
      element.tabIndex = enabled ? 0 : -1
      element.setAttribute('contenteditable', enabled ? 'plaintext-only' : 'false')
      element.setAttribute('aria-disabled', String(!enabled))
      if (!enabled && editing) {
        cancelled = true
        element.textContent = value
        element.blur()
      } else if (!editing) {
        element.textContent = value
      }
    },
    dispose() {
      if (disposed) return
      if (editing) {
        cancelled = true
        element.blur()
      }
      disposed = true
      element.removeEventListener('focus', onFocus)
      element.removeEventListener('blur', onBlur)
      element.removeEventListener('pointerdown', onPointerDown)
      element.removeEventListener('click', onClick)
      element.removeEventListener('keydown', onKeyDown)
      element.classList.remove('e-edit')
      element.removeAttribute('role')
      element.removeAttribute('aria-label')
      element.removeAttribute('aria-disabled')
      element.removeAttribute('contenteditable')
      element.removeAttribute('tabindex')
    },
  }
}
