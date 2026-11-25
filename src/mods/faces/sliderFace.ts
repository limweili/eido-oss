import { MOD_PART_BOUNDS } from '../growth'
import type { Mod } from '../model'
import { snap, spoken } from '../prompt'
import { cloneDetached } from '../snapshot'
import { mountInlineEdit, type InlineEditController } from './inlineEdit'
import {
  mountPointerGesture,
  type PointerGestureController,
  type PointerGestureCancelReason,
} from './pointerGesture'
import type { ModFaceDefinition, ModFaceMountContext, ModFaceRenderState } from './types'

type SliderRowBinding = {
  itemId: string
  value: HTMLElement
  track: HTMLElement
  rail: HTMLElement
  label: InlineEditController
  pointer: PointerGestureController
}

type SliderDragSession = {
  itemId: string
  rail: Pick<DOMRect, 'left' | 'width'>
  baseline: Mod<'slider'>
  releaseGesture: () => void
  finished: boolean
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

function structureKey(mod: Mod<'slider'>): string {
  return `${mod.state.steps}:${mod.state.items.map(({ id }) => id).join(':')}`
}

function roundedAriaValue(value: number): string {
  return String(Number(value.toFixed(2)))
}

function keyboardValue(value: number, steps: number, direction: -1 | 1): number {
  if (steps < 2) return snap(value + direction, steps)
  const interval = 100 / steps
  return snap((Math.round(value / interval) + direction) * interval, steps)
}

function claimDiscretePointer(event: PointerEvent, enabled: boolean): void {
  if (!enabled) return
  event.stopPropagation()
}

function mountSliderFace(context: ModFaceMountContext<'slider'>) {
  const face = element('div', 'mod-face mod-face--slider', context.root)
  const bindings = new Map<string, SliderRowBinding>()
  let sourceMod: Mod<'slider'> | null = null
  let current: Mod<'slider'> | null = null
  let interactive = false
  let renderedStructure = ''
  let activeDrag: SliderDragSession | null = null
  let disposed = false

  const item = (itemId: string) => current?.state.items.find((candidate) => candidate.id === itemId)

  const paintBinding = (binding: SliderRowBinding) => {
    if (!current) return
    const slider = item(binding.itemId)
    if (!slider) return
    const ratio = slider.v / 100
    const valueText = spoken(slider.v, current.state.steps, current.state.stops)
    binding.track.style.setProperty('--e-mod-face-ratio', ratio.toFixed(4))
    binding.value.textContent = valueText
    binding.track.tabIndex = interactive ? 0 : -1
    binding.track.setAttribute('aria-disabled', String(!interactive))
    binding.track.setAttribute('aria-label', `${slider.label} slider`)
    binding.track.setAttribute('aria-valuenow', roundedAriaValue(slider.v))
    binding.track.setAttribute('aria-valuetext', valueText)
    binding.label.update(slider.label, interactive)
  }

  const paint = () => bindings.forEach(paintBinding)

  const finishDrag = (session: SliderDragSession) => {
    if (session.finished) return
    session.finished = true
    if (activeDrag === session) activeDrag = null
    bindings.get(session.itemId)?.track.classList.remove('is-dragging')
    session.releaseGesture()
  }

  const cancelDrag = (session: SliderDragSession, _reason: PointerGestureCancelReason) => {
    try {
      current = cloneDetached(session.baseline)
      paint()
    } finally {
      finishDrag(session)
    }
  }

  const commitLocal = (next: Mod<'slider'>, label: string, structural = false): boolean => {
    if (!context.commit(next, label)) return false
    sourceMod = cloneDetached(next)
    current = cloneDetached(next)
    if (structural) rebuild()
    else paint()
    return true
  }

  const applyPointer = (session: SliderDragSession, event: PointerEvent) => {
    if (!current || session.rail.width <= 0) return
    const slider = item(session.itemId)
    if (!slider) return
    const ratio = Math.min(1, Math.max(0, (event.clientX - session.rail.left) / session.rail.width))
    slider.v = snap(ratio * 100, current.state.steps)
    const binding = bindings.get(session.itemId)
    if (binding) paintBinding(binding)
  }

  const onKeyboard = (event: KeyboardEvent, itemId: string) => {
    if (!interactive || !current) return
    event.stopPropagation()
    const slider = item(itemId)
    if (!slider) return
    let nextValue: number | undefined
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      nextValue = keyboardValue(slider.v, current.state.steps, -1)
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      nextValue = keyboardValue(slider.v, current.state.steps, 1)
    } else if (event.key === 'Home') {
      nextValue = 0
    } else if (event.key === 'End') {
      nextValue = 100
    }
    if (nextValue === undefined) return
    event.preventDefault()
    if (nextValue === slider.v) return
    const next = cloneDetached(current)
    const nextItem = next.state.items.find((candidate) => candidate.id === itemId)
    if (!nextItem) return
    nextItem.v = nextValue
    commitLocal(next, 'Adjust slider')
  }

  const disposeBindings = () => {
    for (const binding of bindings.values()) {
      binding.pointer.dispose()
      binding.label.dispose()
    }
    bindings.clear()
  }

  const addRow = (mod: Mod<'slider'>, slider: Mod<'slider'>['state']['items'][number]) => {
    const row = element('div', 'mod-row', face)
    row.dataset.modPartId = slider.id
    const head = element('div', 'mod-row-head', row)
    const labelElement = element('span', 'mod-sub t-micro', head)
    const value = element('span', 'mod-val t-value', head)
    value.setAttribute('aria-hidden', 'true')

    const label = mountInlineEdit(labelElement, {
      ariaLabel: 'Slider name',
      commit: (nextLabel) => {
        if (!current) return false
        const next = cloneDetached(current)
        const nextItem = next.state.items.find((candidate) => candidate.id === slider.id)
        if (!nextItem) return false
        nextItem.label = nextLabel
        return commitLocal(next, 'Rename slider')
      },
    })

    if (mod.state.items.length > MOD_PART_BOUNDS.slider.min) {
      head.classList.add('has-x')
      const remove = element('button', 'row-x', head, '×')
      remove.type = 'button'
      remove.setAttribute('aria-label', `Remove ${slider.label}`)
      remove.addEventListener('pointerdown', (event) => claimDiscretePointer(event, interactive))
      remove.addEventListener('click', (event) => {
        if (!interactive || !current) return
        event.preventDefault()
        event.stopPropagation()
        const next = cloneDetached(current)
        const index = next.state.items.findIndex((candidate) => candidate.id === slider.id)
        if (index < 0 || next.state.items.length <= MOD_PART_BOUNDS.slider.min) return
        next.state.items.splice(index, 1)
        commitLocal(next, 'Remove slider', true)
      })
    }

    const line = element('div', 'i-sliderline', row)
    const track = element('div', 'i-track', line)
    track.setAttribute('role', 'slider')
    track.setAttribute('aria-orientation', 'horizontal')
    track.setAttribute('aria-valuemin', '0')
    track.setAttribute('aria-valuemax', '100')
    track.addEventListener('keydown', (event) => onKeyboard(event, slider.id))
    track.addEventListener('click', (event) => {
      if (interactive) event.stopPropagation()
    })

    const rail = element('div', 'i-rail', track)
    element('div', 'i-fill', rail)
    if (mod.state.steps >= 2) {
      for (let index = 0; index <= mod.state.steps; index += 1) {
        const detent = element('span', 'i-detent', rail)
        detent.style.left = `${index / mod.state.steps * 100}%`
      }
    }
    const travel = element('div', 'i-travel', rail)
    element('div', 'i-handle', travel)

    const pointer = mountPointerGesture(track, {
      scheduler: context.animationFrames,
      isEnabled: () => interactive && activeDrag === null,
      start: (event) => {
        if (!current) return null
        const railRect = rail.getBoundingClientRect()
        if (!Number.isFinite(railRect.left) || !Number.isFinite(railRect.width) || railRect.width <= 0) {
          return null
        }
        const session: SliderDragSession = {
          itemId: slider.id,
          rail: { left: railRect.left, width: railRect.width },
          baseline: cloneDetached(current),
          releaseGesture: context.beginGesture(),
          finished: false,
        }
        activeDrag = session
        track.classList.add('is-dragging')
        applyPointer(session, event)
        return session
      },
      frame: applyPointer,
      complete: (session) => {
        try {
          if (!current) return
          const before = session.baseline.state.items.find(({ id }) => id === session.itemId)?.v
          const after = item(session.itemId)?.v
          if (after !== undefined && after !== before) {
            const next = cloneDetached(current)
            if (!context.commit(next, 'Adjust slider')) current = cloneDetached(session.baseline)
            else sourceMod = cloneDetached(next)
          }
          paint()
        } finally {
          finishDrag(session)
        }
      },
      cancel: cancelDrag,
    })

    bindings.set(slider.id, { itemId: slider.id, value, track, rail, label, pointer })
  }

  function rebuild() {
    if (!current || disposed) return
    disposeBindings()
    face.replaceChildren()
    current.state.items.forEach((slider) => addRow(current!, slider))
    renderedStructure = structureKey(current)
    paint()
  }

  return {
    update(state: ModFaceRenderState<'slider'>) {
      if (disposed) return
      const incoming = cloneDetached(state.mod) as Mod<'slider'>
      const sourceChanged = sourceMod === null
        || JSON.stringify(sourceMod) !== JSON.stringify(incoming)

      if (activeDrag && (!state.interactive || sourceChanged)) {
        for (const binding of bindings.values()) binding.pointer.cancel('disabled')
      }
      interactive = state.interactive
      if (!activeDrag || sourceChanged) {
        sourceMod = cloneDetached(incoming)
        current = cloneDetached(incoming)
      }

      if (!current) return
      if (renderedStructure !== structureKey(current)) rebuild()
      else paint()
    },
    dispose() {
      if (disposed) return
      disposeBindings()
      disposed = true
      activeDrag = null
      face.remove()
    },
  }
}

export const sliderFaceDefinition: ModFaceDefinition<'slider'> = {
  kind: 'slider',
  mount: mountSliderFace,
}
