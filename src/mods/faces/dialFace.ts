import { MOD_PART_BOUNDS } from '../growth'
import type { Mod } from '../model'
import { snap, spoken } from '../prompt'
import { cloneDetached } from '../snapshot'
import { mountInlineEdit, type InlineEditController } from './inlineEdit'
import {
  mountPointerGesture,
  type PointerGestureCancelReason,
  type PointerGestureController,
} from './pointerGesture'
import type { ModFaceDefinition, ModFaceMountContext, ModFaceRenderState } from './types'

const DIAL_RADIUS = 24
const DIAL_CENTRE = 30
const DIAL_START_DEGREES = 135
const DIAL_SWEEP_DEGREES = 270
const PROTOTYPE_DRAG_HEIGHTS = 2.5

type DialBinding = {
  itemId: string
  cell: HTMLElement
  surface: HTMLElement
  valueArc: SVGPathElement
  needle: SVGLineElement
  value: HTMLElement
  label: InlineEditController
  remove: HTMLButtonElement | null
  pointer: PointerGestureController
}

type DialDragSession = {
  itemId: string
  startValue: number
  startY: number
  travel: number
  baseline: Mod<'dial'>
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

function svgElement<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Readonly<Record<string, string | number>>,
  parent: SVGElement | HTMLElement,
): SVGElementTagNameMap[K] {
  const child = document.createElementNS('http://www.w3.org/2000/svg', tag)
  for (const [name, value] of Object.entries(attributes)) child.setAttribute(name, String(value))
  parent.append(child)
  return child
}

function dialPoint(degrees: number): readonly [number, number] {
  const radians = degrees * Math.PI / 180
  return [
    DIAL_CENTRE + DIAL_RADIUS * Math.cos(radians),
    DIAL_CENTRE + DIAL_RADIUS * Math.sin(radians),
  ]
}

function dialArc(from: number, to: number): string {
  const [x1, y1] = dialPoint(from)
  const [x2, y2] = dialPoint(to)
  const largeArc = to - from > 180 ? 1 : 0
  return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${DIAL_RADIUS} ${DIAL_RADIUS} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`
}

function structureKey(mod: Mod<'dial'>): string {
  return `${mod.state.steps}:${mod.state.items.map(({ id }) => id).join(':')}`
}

function keyboardValue(value: number, steps: number, direction: -1 | 1): number {
  if (steps < 2) return snap(value + direction, steps)
  const interval = 100 / steps
  return snap((Math.round(value / interval) + direction) * interval, steps)
}

function claimDiscretePointer(event: PointerEvent, enabled: boolean): void {
  if (enabled) event.stopPropagation()
}

function claimDiscreteKey(event: KeyboardEvent, enabled: boolean): void {
  if (enabled) event.stopPropagation()
}

function mountDialFace(context: ModFaceMountContext<'dial'>) {
  const face = element('div', 'mod-face mod-face--dial', context.root)
  const dialGrid = element('div', 'i-dials', face)
  const bindings = new Map<string, DialBinding>()
  let sourceMod: Mod<'dial'> | null = null
  let current: Mod<'dial'> | null = null
  let interactive = false
  let renderedStructure = ''
  let activeDrag: DialDragSession | null = null
  let disposed = false

  const item = (itemId: string) => current?.state.items.find((candidate) => candidate.id === itemId)

  const paintBinding = (binding: DialBinding) => {
    if (!current) return
    const dial = item(binding.itemId)
    if (!dial) return
    const degrees = DIAL_START_DEGREES + DIAL_SWEEP_DEGREES * dial.v / 100
    binding.valueArc.setAttribute('d', dial.v <= 0.5 ? '' : dialArc(DIAL_START_DEGREES, degrees))
    const [pointX, pointY] = dialPoint(degrees)
    binding.needle.setAttribute('x1', String(DIAL_CENTRE + (pointX - DIAL_CENTRE) * 0.28))
    binding.needle.setAttribute('y1', String(DIAL_CENTRE + (pointY - DIAL_CENTRE) * 0.28))
    binding.needle.setAttribute('x2', String(DIAL_CENTRE + (pointX - DIAL_CENTRE) * 0.52))
    binding.needle.setAttribute('y2', String(DIAL_CENTRE + (pointY - DIAL_CENTRE) * 0.52))
    const valueText = spoken(dial.v, current.state.steps, current.state.stops)
    binding.value.textContent = valueText
    binding.surface.tabIndex = interactive ? 0 : -1
    binding.surface.setAttribute('aria-disabled', String(!interactive))
    binding.surface.setAttribute('aria-label', `${dial.label} dial`)
    binding.surface.setAttribute('aria-valuenow', String(Number(dial.v.toFixed(2))))
    binding.surface.setAttribute('aria-valuetext', valueText)
    binding.label.update(dial.label, interactive)
    binding.remove?.setAttribute('aria-label', `Remove ${dial.label}`)
  }

  const paint = () => bindings.forEach(paintBinding)

  const finishDrag = (session: DialDragSession) => {
    if (session.finished) return
    session.finished = true
    if (activeDrag === session) activeDrag = null
    bindings.get(session.itemId)?.cell.classList.remove('is-dragging')
    session.releaseGesture()
  }

  const cancelDrag = (session: DialDragSession, _reason: PointerGestureCancelReason) => {
    try {
      current = cloneDetached(session.baseline)
      paint()
    } finally {
      finishDrag(session)
    }
  }

  const commitLocal = (next: Mod<'dial'>, label: string, structural = false): boolean => {
    if (!context.commit(next, label)) return false
    sourceMod = cloneDetached(next)
    current = cloneDetached(next)
    if (structural) rebuild()
    else paint()
    return true
  }

  const onKeyboard = (event: KeyboardEvent, itemId: string) => {
    if (!interactive || !current) return
    event.stopPropagation()
    const dial = item(itemId)
    if (!dial) return
    let nextValue: number | undefined
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      nextValue = keyboardValue(dial.v, current.state.steps, -1)
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      nextValue = keyboardValue(dial.v, current.state.steps, 1)
    } else if (event.key === 'Home') {
      nextValue = 0
    } else if (event.key === 'End') {
      nextValue = 100
    }
    if (nextValue === undefined) return
    event.preventDefault()
    if (nextValue === dial.v) return
    const next = cloneDetached(current)
    const nextItem = next.state.items.find((candidate) => candidate.id === itemId)
    if (!nextItem) return
    nextItem.v = nextValue
    commitLocal(next, 'Adjust dial')
  }

  const applyPointer = (session: DialDragSession, event: PointerEvent) => {
    if (!current || session.travel <= 0) return
    const dial = item(session.itemId)
    if (!dial) return
    const fine = event.shiftKey ? 0.25 : 1
    dial.v = snap(
      session.startValue + (session.startY - event.clientY) * (100 / session.travel) * fine,
      current.state.steps,
    )
    const binding = bindings.get(session.itemId)
    if (binding) paintBinding(binding)
  }

  const addDial = (mod: Mod<'dial'>, dial: Mod<'dial'>['state']['items'][number]) => {
    const cell = element('div', 'i-dial', dialGrid)
    cell.dataset.modPartId = dial.id
    const surface = element('div', 'i-dial-surface', cell)
    surface.setAttribute('role', 'slider')
    surface.setAttribute('aria-orientation', 'vertical')
    surface.setAttribute('aria-valuemin', '0')
    surface.setAttribute('aria-valuemax', '100')
    surface.addEventListener('keydown', (event) => onKeyboard(event, dial.id))
    const dialSvg = svgElement('svg', { width: 60, height: 60, viewBox: '0 0 60 60' }, surface)
    dialSvg.setAttribute('aria-hidden', 'true')
    svgElement('path', {
      class: 'arc-track',
      d: dialArc(DIAL_START_DEGREES, DIAL_START_DEGREES + DIAL_SWEEP_DEGREES),
    }, dialSvg)
    const ticks = svgElement('g', { class: 'ticks' }, dialSvg)
    if (mod.state.steps >= 2) {
      for (let index = 0; index <= mod.state.steps; index += 1) {
        const degrees = DIAL_START_DEGREES + DIAL_SWEEP_DEGREES * index / mod.state.steps
        const radians = degrees * Math.PI / 180
        svgElement('line', {
          class: 'tick',
          x1: DIAL_CENTRE + (DIAL_RADIUS + 5) * Math.cos(radians),
          y1: DIAL_CENTRE + (DIAL_RADIUS + 5) * Math.sin(radians),
          x2: DIAL_CENTRE + (DIAL_RADIUS + 8) * Math.cos(radians),
          y2: DIAL_CENTRE + (DIAL_RADIUS + 8) * Math.sin(radians),
        }, ticks)
      }
    }
    const valueArc = svgElement('path', { class: 'arc-value' }, dialSvg)
    svgElement('circle', { class: 'core', cx: DIAL_CENTRE, cy: DIAL_CENTRE, r: 13 }, dialSvg)
    const needle = svgElement('line', { class: 'needle' }, dialSvg)
    const labelElement = element('span', 'mod-sub t-micro', cell)
    const label = mountInlineEdit(labelElement, {
      ariaLabel: 'Dial name',
      commit: (nextLabel) => {
        if (!current) return false
        const next = cloneDetached(current)
        const nextItem = next.state.items.find((candidate) => candidate.id === dial.id)
        if (!nextItem) return false
        nextItem.label = nextLabel
        return commitLocal(next, 'Rename dial')
      },
    })
    const value = element('span', 'mod-val t-value', cell)

    let remove: HTMLButtonElement | null = null
    if (mod.state.items.length > MOD_PART_BOUNDS.dial.min) {
      remove = element('button', 'row-x', cell, '×')
      remove.type = 'button'
      remove.setAttribute('aria-label', `Remove ${dial.label}`)
      remove.addEventListener('pointerdown', (event) => claimDiscretePointer(event, interactive))
      remove.addEventListener('keydown', (event) => claimDiscreteKey(event, interactive))
      remove.addEventListener('click', (event) => {
        if (!interactive || !current) return
        event.preventDefault()
        event.stopPropagation()
        const next = cloneDetached(current)
        const index = next.state.items.findIndex((candidate) => candidate.id === dial.id)
        if (index < 0 || next.state.items.length <= MOD_PART_BOUNDS.dial.min) return
        next.state.items.splice(index, 1)
        commitLocal(next, 'Remove dial', true)
      })
    }

    const pointer = mountPointerGesture(surface, {
      scheduler: context.animationFrames,
      isEnabled: () => interactive && activeDrag === null,
      start: (event) => {
        if (!current) return null
        const dialRect = surface.getBoundingClientRect()
        if (!Number.isFinite(dialRect.height) || dialRect.height <= 0) return null
        const session: DialDragSession = {
          itemId: dial.id,
          startValue: item(dial.id)?.v ?? dial.v,
          startY: event.clientY,
          travel: dialRect.height * PROTOTYPE_DRAG_HEIGHTS,
          baseline: cloneDetached(current),
          releaseGesture: context.beginGesture(),
          finished: false,
        }
        activeDrag = session
        cell.classList.add('is-dragging')
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
            if (!context.commit(next, 'Adjust dial')) current = cloneDetached(session.baseline)
            else sourceMod = cloneDetached(next)
          }
          paint()
        } finally {
          finishDrag(session)
        }
      },
      cancel: cancelDrag,
    })

    bindings.set(dial.id, {
      itemId: dial.id,
      cell,
      surface,
      valueArc,
      needle,
      value,
      label,
      remove,
      pointer,
    })
  }

  const disposeBindings = () => {
    for (const binding of bindings.values()) binding.pointer.dispose()
    for (const binding of bindings.values()) binding.label.dispose()
    bindings.clear()
  }

  function rebuild() {
    if (!current || disposed) return
    disposeBindings()
    dialGrid.replaceChildren()
    current.state.items.forEach((dial) => addDial(current!, dial))
    renderedStructure = structureKey(current)
    paint()
  }

  return {
    update(state: ModFaceRenderState<'dial'>) {
      if (disposed) return
      const incoming = cloneDetached(state.mod) as Mod<'dial'>
      const sourceChanged = sourceMod === null || JSON.stringify(sourceMod) !== JSON.stringify(incoming)
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

export const dialFaceDefinition: ModFaceDefinition<'dial'> = {
  kind: 'dial',
  mount: mountDialFace,
}
