import { MOD_PART_BOUNDS } from '../growth'
import type { CountMode, Mod } from '../model'
import { countModCap } from '../prompt'
import { cloneDetached } from '../snapshot'
import { mountInlineEdit, type InlineEditController } from './inlineEdit'
import type { ModFaceDefinition, ModFaceMountContext, ModFaceRenderState } from './types'

type CountBinding = {
  itemId: string
  label: InlineEditController
  instrument: HTMLElement
  decrease: HTMLButtonElement
  value: HTMLElement
  increase: HTMLButtonElement
  remove: HTMLButtonElement | null
}

const COUNT_MODES: readonly CountMode[] = ['number', 'percent', 'ratio']
const COUNT_MODE_WORDS: Readonly<Record<CountMode, string>> = {
  number: 'NUMBER',
  percent: 'PERCENT',
  ratio: 'RATIO',
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function countWord(mod: Mod<'count'>, value: number): string {
  if (mod.state.mode === 'percent') return `${Math.round(value / mod.state.steps * 100)}%`
  if (mod.state.mode === 'ratio') return `${value} / ${mod.state.steps}`
  return String(value)
}

function structureKey(mod: Mod<'count'>): string {
  return mod.state.items.map(({ id }) => id).join(':')
}

function claimDiscretePointer(event: PointerEvent, enabled: boolean): void {
  if (enabled) event.stopPropagation()
}

function claimDiscreteKey(event: KeyboardEvent, enabled: boolean): void {
  if (enabled) event.stopPropagation()
}

function mountCountFace(context: ModFaceMountContext<'count'>) {
  const face = element('div', 'mod-face mod-face--count', context.root)
  const bindings = new Map<string, CountBinding>()
  let current: Mod<'count'> | null = null
  let interactive = false
  let renderedStructure = ''
  let modeButton: HTMLButtonElement | null = null
  let disposed = false

  const item = (itemId: string) => current?.state.items.find((candidate) => candidate.id === itemId)

  const paintBinding = (binding: CountBinding) => {
    if (!current) return
    const count = item(binding.itemId)
    if (!count) return
    const cap = countModCap(current)
    binding.label.update(count.label, interactive)
    if (current.state.mode === 'ratio') {
      binding.value.replaceChildren(document.createTextNode(String(count.n)))
      const total = document.createElement('i')
      total.textContent = ` / ${current.state.steps}`
      binding.value.append(total)
    } else {
      binding.value.textContent = countWord(current, count.n)
    }
    binding.value.setAttribute('aria-label', `${count.label}: ${countWord(current, count.n)}`)
    binding.instrument.setAttribute('aria-label', `${count.label} count`)
    binding.decrease.setAttribute('aria-label', `Decrease ${count.label}`)
    binding.increase.setAttribute('aria-label', `Increase ${count.label}`)
    binding.remove?.setAttribute('aria-label', `Remove ${count.label}`)
    binding.decrease.disabled = !interactive || count.n <= 0
    binding.increase.disabled = !interactive || count.n >= cap
  }

  const paint = () => {
    bindings.forEach(paintBinding)
    if (!current || !modeButton) return
    const modeIndex = COUNT_MODES.indexOf(current.state.mode)
    const nextMode = COUNT_MODES[(modeIndex + 1) % COUNT_MODES.length]
    modeButton.textContent = COUNT_MODE_WORDS[current.state.mode]
    modeButton.disabled = !interactive
    modeButton.setAttribute(
      'aria-label',
      `Count mode ${COUNT_MODE_WORDS[current.state.mode]}. Change to ${COUNT_MODE_WORDS[nextMode]}`,
    )
  }

  const commitLocal = (next: Mod<'count'>, label: string, structural = false): boolean => {
    if (!context.commit(next, label)) return false
    current = cloneDetached(next)
    if (structural) rebuild()
    else paint()
    return true
  }

  const adjust = (itemId: string, direction: -1 | 1) => {
    if (!interactive || !current) return
    const next = cloneDetached(current)
    const count = next.state.items.find((candidate) => candidate.id === itemId)
    if (!count) return
    const nextValue = clamp(count.n + direction, 0, countModCap(next))
    if (nextValue === count.n) return
    count.n = nextValue
    commitLocal(next, direction > 0 ? 'Increase count' : 'Decrease count')
  }

  const cycleMode = () => {
    if (!interactive || !current) return
    const next = cloneDetached(current)
    const previousCap = countModCap(next)
    const modeIndex = COUNT_MODES.indexOf(next.state.mode)
    next.state.mode = COUNT_MODES[(modeIndex + 1) % COUNT_MODES.length]
    const nextCap = countModCap(next)
    next.state.items.forEach((count) => {
      count.n = clamp(Math.round(count.n / previousCap * nextCap), 0, nextCap)
    })
    commitLocal(next, 'Change count mode')
  }

  const addRow = (count: Mod<'count'>['state']['items'][number]) => {
    const row = element('div', 'mod-row', face)
    row.dataset.modPartId = count.id
    const line = element('div', 'i-countrow', row)
    const labelElement = element('span', 'mod-sub t-micro', line)
    const label = mountInlineEdit(labelElement, {
      ariaLabel: 'Count name',
      commit: (nextLabel) => {
        if (!current) return false
        const next = cloneDetached(current)
        const nextItem = next.state.items.find((candidate) => candidate.id === count.id)
        if (!nextItem) return false
        nextItem.label = nextLabel
        return commitLocal(next, 'Rename count')
      },
    })
    const instrument = element('div', 'i-count', line)
    instrument.setAttribute('role', 'group')
    const decrease = element('button', 'i-count-step i-count-step--decrease', instrument, '−')
    decrease.type = 'button'
    const value = element('span', 'n t-value', instrument)
    value.setAttribute('aria-live', 'polite')
    value.setAttribute('aria-atomic', 'true')
    const increase = element('button', 'i-count-step i-count-step--increase', instrument, '+')
    increase.type = 'button'
    decrease.addEventListener('pointerdown', (event) => claimDiscretePointer(event, interactive))
    increase.addEventListener('pointerdown', (event) => claimDiscretePointer(event, interactive))
    decrease.addEventListener('keydown', (event) => claimDiscreteKey(event, interactive))
    increase.addEventListener('keydown', (event) => claimDiscreteKey(event, interactive))
    decrease.addEventListener('click', (event) => {
      if (!interactive) return
      event.preventDefault()
      event.stopPropagation()
      adjust(count.id, -1)
    })
    increase.addEventListener('click', (event) => {
      if (!interactive) return
      event.preventDefault()
      event.stopPropagation()
      adjust(count.id, 1)
    })
    let remove: HTMLButtonElement | null = null
    if (current && current.state.items.length > MOD_PART_BOUNDS.count.min) {
      remove = element('button', 'row-x', line, '×')
      remove.type = 'button'
      remove.addEventListener('pointerdown', (event) => claimDiscretePointer(event, interactive))
      remove.addEventListener('keydown', (event) => claimDiscreteKey(event, interactive))
      remove.addEventListener('click', (event) => {
        if (!interactive || !current) return
        event.preventDefault()
        event.stopPropagation()
        const next = cloneDetached(current)
        const index = next.state.items.findIndex((candidate) => candidate.id === count.id)
        if (index < 0 || next.state.items.length <= MOD_PART_BOUNDS.count.min) return
        next.state.items.splice(index, 1)
        commitLocal(next, 'Remove count', true)
      })
    }
    bindings.set(count.id, {
      itemId: count.id,
      label,
      instrument,
      decrease,
      value,
      increase,
      remove,
    })
  }

  const disposeBindings = () => {
    for (const binding of bindings.values()) binding.label.dispose()
    bindings.clear()
  }

  const rebuild = () => {
    if (!current || disposed) return
    disposeBindings()
    modeButton = null
    face.replaceChildren()
    current.state.items.forEach(addRow)
    const footer = element('div', 'i-count-foot', face)
    modeButton = element('button', 'e-chip-key count-mode', footer)
    modeButton.type = 'button'
    modeButton.addEventListener('pointerdown', (event) => claimDiscretePointer(event, interactive))
    modeButton.addEventListener('keydown', (event) => claimDiscreteKey(event, interactive))
    modeButton.addEventListener('click', (event) => {
      if (!interactive) return
      event.preventDefault()
      event.stopPropagation()
      cycleMode()
    })
    renderedStructure = structureKey(current)
    paint()
  }

  return {
    update(state: ModFaceRenderState<'count'>) {
      if (disposed) return
      const incoming = cloneDetached(state.mod) as Mod<'count'>
      interactive = state.interactive
      current = cloneDetached(incoming)
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

export const countFaceDefinition: ModFaceDefinition<'count'> = {
  kind: 'count',
  mount: mountCountFace,
}
