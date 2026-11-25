export type ModPopoverFieldOptions = Readonly<{
  id: string
  label: string
  control: HTMLElement
  help?: string
}>

export type MountedModPopoverField = Readonly<{
  element: HTMLElement
  dispose: () => void
}>

export function mountModPopoverField(
  parent: HTMLElement,
  options: ModPopoverFieldOptions,
): MountedModPopoverField {
  const field = document.createElement('div')
  field.className = 'e-pop-field'
  const label = document.createElement('label')
  label.className = 'e-pop-label t-micro'
  label.htmlFor = options.id
  label.textContent = options.label
  field.append(label)

  options.control.id = options.id
  if (options.control instanceof HTMLInputElement || options.control instanceof HTMLTextAreaElement) {
    options.control.classList.add('e-field')
    if (options.control instanceof HTMLTextAreaElement) options.control.classList.add('e-field--prose')
  }
  field.append(options.control)

  if (options.help) {
    const help = document.createElement('div')
    help.id = `${options.id}-help`
    help.className = 'e-pop-help t-hint'
    help.textContent = options.help
    const describedBy = options.control.getAttribute('aria-describedby')?.trim()
    options.control.setAttribute('aria-describedby', [describedBy, help.id].filter(Boolean).join(' '))
    field.append(help)
  }

  parent.append(field)
  return { element: field, dispose: () => field.remove() }
}

export type ModPopoverAccordionState = Readonly<{
  label: string
  summary: string
  expanded: boolean
  enabled: boolean
}>

export type MountModPopoverAccordionOptions = ModPopoverAccordionState & Readonly<{
  id: string
  onExpandedChange: (expanded: boolean) => void
}>

export type MountedModPopoverAccordion = Readonly<{
  element: HTMLElement
  trigger: HTMLButtonElement
  body: HTMLElement
  update: (state: ModPopoverAccordionState) => void
  dispose: () => void
}>

export function mountModPopoverAccordion(
  parent: HTMLElement,
  options: MountModPopoverAccordionOptions,
): MountedModPopoverAccordion {
  const section = document.createElement('section')
  section.className = 'e-acc'
  const trigger = document.createElement('button')
  trigger.id = `${options.id}-trigger`
  trigger.className = 'e-acc-head t-micro'
  trigger.type = 'button'
  trigger.setAttribute('aria-controls', `${options.id}-panel`)
  const label = document.createElement('span')
  const summary = document.createElement('span')
  summary.className = 'acc-state'
  const mark = document.createElement('span')
  mark.className = 'acc-mark'
  mark.setAttribute('aria-hidden', 'true')
  trigger.append(label, summary, mark)

  const body = document.createElement('div')
  body.id = `${options.id}-panel`
  body.className = 'e-acc-body'
  body.setAttribute('role', 'region')
  body.setAttribute('aria-labelledby', trigger.id)
  section.append(trigger, body)
  parent.append(section)

  let state: ModPopoverAccordionState = options
  const update = (next: ModPopoverAccordionState) => {
    state = next
    section.classList.toggle('is-open', next.expanded)
    label.textContent = next.label
    summary.textContent = next.summary
    mark.textContent = next.expanded ? '−' : '+'
    trigger.disabled = !next.enabled
    trigger.setAttribute('aria-expanded', String(next.expanded))
    body.hidden = !next.expanded
  }

  const onPointerDown = (event: PointerEvent) => {
    if (state.enabled) event.stopPropagation()
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (state.enabled) event.stopPropagation()
  }
  const onClick = (event: MouseEvent) => {
    if (!state.enabled) return
    event.stopPropagation()
    options.onExpandedChange(!state.expanded)
  }
  trigger.addEventListener('pointerdown', onPointerDown)
  trigger.addEventListener('keydown', onKeyDown)
  trigger.addEventListener('click', onClick)
  update(options)

  return {
    element: section,
    trigger,
    body,
    update,
    dispose() {
      trigger.removeEventListener('pointerdown', onPointerDown)
      trigger.removeEventListener('keydown', onKeyDown)
      trigger.removeEventListener('click', onClick)
      section.remove()
    },
  }
}
