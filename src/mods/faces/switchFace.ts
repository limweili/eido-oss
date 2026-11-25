import { MOD_PART_BOUNDS } from '../growth'
import type { Mod } from '../model'
import { cloneDetached } from '../snapshot'
import { mountInlineEdit, type InlineEditController } from './inlineEdit'
import type { ModFaceDefinition, ModFaceMountContext, ModFaceRenderState } from './types'

type SwitchBinding = {
  itemId: string
  label: InlineEditController
  control: HTMLButtonElement
  remove: HTMLButtonElement | null
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  parent: HTMLElement,
  text?: string,
): HTMLElementTagNameMap[K] {
  const child = document.createElement(tag)
  child.className = className
  if (text !== undefined) child.textContent = text
  parent.append(child)
  return child
}

function structureKey(mod: Mod<'switch'>): string {
  return mod.state.items.map(({ id }) => id).join(':')
}

function claimDiscretePointer(event: PointerEvent, enabled: boolean): void {
  if (enabled) event.stopPropagation()
}

function claimDiscreteKey(event: KeyboardEvent, enabled: boolean): void {
  if (enabled) event.stopPropagation()
}

function mountSwitchFace(context: ModFaceMountContext<'switch'>) {
  const face = element('div', 'mod-face mod-face--switch', context.root)
  const bindings = new Map<string, SwitchBinding>()
  let current: Mod<'switch'> | null = null
  let interactive = false
  let renderedStructure = ''
  let disposed = false

  const item = (itemId: string) => current?.state.items.find((candidate) => candidate.id === itemId)

  const paintBinding = (binding: SwitchBinding) => {
    const switchItem = item(binding.itemId)
    if (!switchItem) return
    binding.label.update(switchItem.label, interactive)
    binding.control.classList.toggle('is-on', switchItem.on)
    binding.control.disabled = !interactive
    binding.control.setAttribute('aria-label', switchItem.label)
    binding.control.setAttribute('aria-checked', String(switchItem.on))
    binding.remove?.setAttribute('aria-label', `Remove ${switchItem.label}`)
  }

  const paint = () => bindings.forEach(paintBinding)

  const commitLocal = (next: Mod<'switch'>, label: string, structural = false): boolean => {
    if (!context.commit(next, label)) return false
    current = cloneDetached(next)
    if (structural) rebuild()
    else paint()
    return true
  }

  const toggle = (itemId: string) => {
    if (!interactive || !current) return
    const next = cloneDetached(current)
    const switchItem = next.state.items.find((candidate) => candidate.id === itemId)
    if (!switchItem) return
    switchItem.on = !switchItem.on
    commitLocal(next, 'Toggle switch')
  }

  const addRow = (switchItem: Mod<'switch'>['state']['items'][number]) => {
    const row = element('div', 'mod-row', face)
    row.dataset.modPartId = switchItem.id
    const line = element('div', 'i-swrow', row)
    const labelElement = element('span', 'mod-sub t-micro', line)
    const label = mountInlineEdit(labelElement, {
      ariaLabel: 'Switch name',
      commit: (nextLabel) => {
        if (!current) return false
        const next = cloneDetached(current)
        const nextItem = next.state.items.find((candidate) => candidate.id === switchItem.id)
        if (!nextItem) return false
        nextItem.label = nextLabel
        return commitLocal(next, 'Rename switch')
      },
    })
    const control = element('button', 'i-switch', line)
    control.type = 'button'
    control.setAttribute('role', 'switch')
    control.addEventListener('pointerdown', (event) => claimDiscretePointer(event, interactive))
    control.addEventListener('keydown', (event) => claimDiscreteKey(event, interactive))
    control.addEventListener('click', (event) => {
      if (!interactive) return
      event.preventDefault()
      event.stopPropagation()
      toggle(switchItem.id)
    })
    let remove: HTMLButtonElement | null = null
    if (current && current.state.items.length > MOD_PART_BOUNDS.switch.min) {
      remove = element('button', 'row-x', line, '×')
      remove.type = 'button'
      remove.addEventListener('pointerdown', (event) => claimDiscretePointer(event, interactive))
      remove.addEventListener('keydown', (event) => claimDiscreteKey(event, interactive))
      remove.addEventListener('click', (event) => {
        if (!interactive || !current) return
        event.preventDefault()
        event.stopPropagation()
        const next = cloneDetached(current)
        const index = next.state.items.findIndex((candidate) => candidate.id === switchItem.id)
        if (index < 0 || next.state.items.length <= MOD_PART_BOUNDS.switch.min) return
        next.state.items.splice(index, 1)
        commitLocal(next, 'Remove switch', true)
      })
    }
    bindings.set(switchItem.id, { itemId: switchItem.id, label, control, remove })
  }

  const disposeBindings = () => {
    for (const binding of bindings.values()) binding.label.dispose()
    bindings.clear()
  }

  const rebuild = () => {
    if (!current || disposed) return
    disposeBindings()
    face.replaceChildren()
    current.state.items.forEach(addRow)
    renderedStructure = structureKey(current)
    paint()
  }

  return {
    update(state: ModFaceRenderState<'switch'>) {
      if (disposed) return
      interactive = state.interactive
      current = cloneDetached(state.mod) as Mod<'switch'>
      if (renderedStructure !== structureKey(current)) rebuild()
      else paint()
    },
    dispose() {
      if (disposed) return
      disposed = true
      current = null
      disposeBindings()
      face.remove()
    },
  }
}

export const switchFaceDefinition: ModFaceDefinition<'switch'> = {
  kind: 'switch',
  mount: mountSwitchFace,
}
