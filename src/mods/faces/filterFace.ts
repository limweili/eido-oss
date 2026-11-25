import { MOD_PART_BOUNDS } from '../growth'
import type { FilterLane, FilterMode, Mod } from '../model'
import { snap, spoken } from '../prompt'
import { cloneDetached } from '../snapshot'
import { mountInlineEdit, type InlineEditController } from './inlineEdit'
import {
  mountPointerGesture,
  type PointerGestureCancelReason,
  type PointerGestureController,
} from './pointerGesture'
import type { ModFaceDefinition, ModFaceMountContext, ModFaceRenderState } from './types'

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
const FILTER_MODES: readonly FilterMode[] = ['no-more-than', 'at-least', 'between']
const FILTER_MODE_WORDS: Record<FilterMode, string> = {
  'no-more-than': 'NO MORE THAN',
  'at-least': 'AT LEAST',
  between: 'BETWEEN',
}

type FilterGeometry = {
  wellWidth: number
  wellHeight: number
  railScreenLeft: number
  railScreenWidth: number
  railLocalLeft: number
  railLocalWidth: number
}

type FilterLaneBinding = {
  laneId: string
  value: HTMLElement
  well: HTMLElement
  geometryElement: HTMLElement
  svg: SVGSVGElement
  wash: SVGPathElement
  curve: SVGPathElement
  detents: SVGGElement
  chip: HTMLButtonElement
  label: InlineEditController
  pointer: PointerGestureController
  resizeObserver: ResizeObserver | null
  geometry: FilterGeometry | null
  decorationKey: string
}

type FilterGrab = 'lo' | 'hi' | 'band'

type FilterDragSession = {
  laneId: string
  grab: FilterGrab
  railLeft: number
  railWidth: number
  startValue: number
  loStart: number
  hiStart: number
  baseline: Mod<'filter'>
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
  className: string,
  parent: Element,
): SVGElementTagNameMap[K] {
  const child = document.createElementNS(SVG_NAMESPACE, tag)
  if (className) child.setAttribute('class', className)
  parent.append(child)
  return child
}

function structureKey(mod: Mod<'filter'>): string {
  return JSON.stringify({
    steps: mod.state.steps,
    stops: mod.state.stops,
    lanes: mod.state.lanes.map(({ id }) => id),
  })
}

function filterPhrase(lane: FilterLane, mod: Mod<'filter'>, compact: boolean): string {
  const name = (value: number) => spoken(value, mod.state.steps, mod.state.stops)
  if (lane.mode === 'no-more-than') return compact ? `≤ ${name(lane.hi)}` : `no more than ${name(lane.hi)}`
  if (lane.mode === 'at-least') return compact ? `≥ ${name(lane.lo)}` : `at least ${name(lane.lo)}`
  return compact
    ? `${name(lane.lo)}–${name(lane.hi)}`
    : `between ${name(lane.lo)} and ${name(lane.hi)}`
}

function claimDiscretePointer(event: PointerEvent, enabled: boolean): void {
  if (enabled) event.stopPropagation()
}

function mountFilterFace(context: ModFaceMountContext<'filter'>) {
  const face = element('div', 'mod-face mod-face--filter', context.root)
  const bindings = new Map<string, FilterLaneBinding>()
  let sourceMod: Mod<'filter'> | null = null
  let current: Mod<'filter'> | null = null
  let interactive = false
  let renderedStructure = ''
  let activeDrag: FilterDragSession | null = null
  let disposed = false

  const lane = (laneId: string) => current?.state.lanes.find((candidate) => candidate.id === laneId)

  const xFor = (geometry: FilterGeometry, value: number) => (
    geometry.railLocalLeft + value / 100 * geometry.railLocalWidth
  )

  const ensureGeometry = (binding: FilterLaneBinding): boolean => {
    if (!current) return false
    const wellRect = binding.well.getBoundingClientRect()
    const railRect = binding.geometryElement.getBoundingClientRect()
    if (
      !Number.isFinite(wellRect.width)
      || !Number.isFinite(wellRect.height)
      || !Number.isFinite(railRect.left)
      || !Number.isFinite(railRect.width)
      || wellRect.width <= 0
      || wellRect.height <= 0
      || railRect.width <= 0
    ) return false

    const geometry: FilterGeometry = {
      wellWidth: wellRect.width,
      wellHeight: wellRect.height,
      railScreenLeft: railRect.left,
      railScreenWidth: railRect.width,
      railLocalLeft: railRect.left - wellRect.left,
      railLocalWidth: railRect.width,
    }
    const decorationKey = JSON.stringify({
      width: geometry.wellWidth,
      height: geometry.wellHeight,
      railLeft: geometry.railLocalLeft,
      railWidth: geometry.railLocalWidth,
      steps: current.state.steps,
      stops: current.state.stops,
    })
    binding.geometry = geometry
    if (binding.decorationKey === decorationKey) return true

    binding.decorationKey = decorationKey
    binding.svg.setAttribute('viewBox', `0 0 ${geometry.wellWidth} ${geometry.wellHeight}`)
    binding.detents.replaceChildren()
    if (current.state.steps >= 2) {
      const unit = geometry.wellHeight / 84
      for (let index = 0; index <= current.state.steps; index += 1) {
        const detent = svgElement('circle', 'det', binding.detents)
        detent.setAttribute('cx', String(xFor(geometry, index * 100 / current.state.steps)))
        detent.setAttribute('cy', String(geometry.wellHeight - 11 * unit))
        detent.setAttribute('r', String(2 * unit))
      }
    }
    return true
  }

  const paintCurve = (binding: FilterLaneBinding, filterLane: FilterLane) => {
    const geometry = binding.geometry
    if (!geometry) return
    const unit = geometry.wellHeight / 84
    const top = 12 * unit
    const bottom = geometry.wellHeight - 8 * unit
    const roll = 22 * unit
    const overscan = 4 * unit
    const x = (value: number) => xFor(geometry, value)
    let path: string
    let curveStart: number
    if (filterLane.mode === 'no-more-than') {
      curveStart = -overscan
      path = `M${curveStart} ${top}`
        + ` H${Math.max(-overscan, x(filterLane.hi) - roll)}`
        + ` C${x(filterLane.hi)} ${top} ${x(filterLane.hi)} ${bottom} ${Math.min(geometry.wellWidth + overscan, x(filterLane.hi) + roll)} ${bottom}`
    } else if (filterLane.mode === 'at-least') {
      curveStart = Math.max(-overscan, x(filterLane.lo) - roll)
      path = `M${curveStart} ${bottom}`
        + ` C${x(filterLane.lo)} ${bottom} ${x(filterLane.lo)} ${top} ${Math.min(geometry.wellWidth + overscan, x(filterLane.lo) + roll)} ${top}`
        + ` H${geometry.wellWidth + overscan}`
    } else {
      curveStart = Math.max(-overscan, x(filterLane.lo) - roll)
      path = `M${curveStart} ${bottom}`
        + ` C${x(filterLane.lo)} ${bottom} ${x(filterLane.lo)} ${top} ${Math.min(x(filterLane.lo) + roll, x(filterLane.hi))} ${top}`
        + ` H${Math.max(x(filterLane.hi) - roll, x(filterLane.lo))}`
        + ` C${x(filterLane.hi)} ${top} ${x(filterLane.hi)} ${bottom} ${Math.min(geometry.wellWidth + overscan, x(filterLane.hi) + roll)} ${bottom}`
    }
    binding.curve.setAttribute('d', path)
    binding.wash.setAttribute(
      'd',
      `${path} V${geometry.wellHeight + overscan} H${curveStart} Z`,
    )
  }

  const paintBinding = (binding: FilterLaneBinding) => {
    if (!current) return
    const filterLane = lane(binding.laneId)
    if (!filterLane) return
    if (!binding.geometry) ensureGeometry(binding)
    paintCurve(binding, filterLane)
    const compact = filterPhrase(filterLane, current, true)
    binding.value.textContent = compact
    binding.chip.textContent = FILTER_MODE_WORDS[filterLane.mode]
    binding.chip.disabled = !interactive
    binding.chip.setAttribute('aria-disabled', String(!interactive))
    binding.label.update(filterLane.label, interactive)
    binding.well.tabIndex = interactive ? 0 : -1
    binding.well.setAttribute('aria-disabled', String(!interactive))
    binding.well.setAttribute('aria-label', `${filterLane.label} filter`)
    binding.well.setAttribute('aria-valuemin', '0')
    binding.well.setAttribute('aria-valuemax', '100')
    const activeValue = filterLane.mode === 'no-more-than'
      ? filterLane.hi
      : filterLane.mode === 'at-least'
        ? filterLane.lo
        : (filterLane.lo + filterLane.hi) / 2
    binding.well.setAttribute('aria-valuenow', String(Number(activeValue.toFixed(2))))
    binding.well.setAttribute('aria-valuetext', filterPhrase(filterLane, current, false))
    if (filterLane.mode === 'between') {
      binding.well.setAttribute(
        'aria-description',
        'Arrow keys move the band. Hold Shift for the lower edge or Alt for the upper edge.',
      )
    } else {
      binding.well.removeAttribute('aria-description')
    }
  }

  const paint = () => bindings.forEach(paintBinding)

  const finishDrag = (session: FilterDragSession) => {
    if (session.finished) return
    session.finished = true
    if (activeDrag === session) activeDrag = null
    bindings.get(session.laneId)?.well.classList.remove('is-dragging')
    session.releaseGesture()
  }

  const cancelDrag = (session: FilterDragSession, _reason: PointerGestureCancelReason) => {
    try {
      current = cloneDetached(session.baseline)
      paint()
    } finally {
      finishDrag(session)
    }
  }

  const commitLocal = (next: Mod<'filter'>, label: string, structural = false): boolean => {
    if (!context.commit(next, label)) return false
    sourceMod = cloneDetached(next)
    current = cloneDetached(next)
    if (structural) rebuild()
    else paint()
    return true
  }

  const valueAt = (clientX: number, left: number, width: number): number => (
    Math.min(1, Math.max(0, (clientX - left) / width)) * 100
  )

  const applyPointer = (session: FilterDragSession, event: PointerEvent) => {
    if (!current || session.railWidth <= 0) return
    const filterLane = lane(session.laneId)
    if (!filterLane) return
    const pointerValue = valueAt(event.clientX, session.railLeft, session.railWidth)
    if (session.grab === 'hi') {
      filterLane.hi = snap(Math.max(pointerValue, filterLane.lo), current.state.steps)
    } else if (session.grab === 'lo') {
      filterLane.lo = snap(Math.min(pointerValue, filterLane.hi), current.state.steps)
    } else {
      const width = session.hiStart - session.loStart
      const lower = snap(
        Math.min(100 - width, Math.max(0, session.loStart + pointerValue - session.startValue)),
        current.state.steps,
      )
      filterLane.lo = lower
      filterLane.hi = Math.min(100, lower + width)
    }
    paintBinding(bindings.get(session.laneId)!)
  }

  const onKeyboard = (event: KeyboardEvent, laneId: string) => {
    if (!interactive || !current) return
    event.stopPropagation()
    const filterLane = lane(laneId)
    if (!filterLane) return
    const interval = current.state.steps >= 2 ? 100 / current.state.steps : 1
    const direction = event.key === 'ArrowLeft' || event.key === 'ArrowDown'
      ? -1
      : event.key === 'ArrowRight' || event.key === 'ArrowUp'
        ? 1
        : 0
    if (!direction && event.key !== 'Home' && event.key !== 'End') return
    event.preventDefault()
    const next = cloneDetached(current)
    const nextLane = next.state.lanes.find(({ id }) => id === laneId)
    if (!nextLane) return

    if (nextLane.mode === 'no-more-than') {
      nextLane.hi = event.key === 'Home'
        ? nextLane.lo
        : event.key === 'End'
          ? 100
          : snap(Math.max(nextLane.lo, nextLane.hi + direction * interval), next.state.steps)
    } else if (nextLane.mode === 'at-least') {
      nextLane.lo = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? nextLane.hi
          : snap(Math.min(nextLane.hi, nextLane.lo + direction * interval), next.state.steps)
    } else if (event.shiftKey) {
      nextLane.lo = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? nextLane.hi
          : snap(Math.min(nextLane.hi, Math.max(0, nextLane.lo + direction * interval)), next.state.steps)
    } else if (event.altKey) {
      nextLane.hi = event.key === 'Home'
        ? nextLane.lo
        : event.key === 'End'
          ? 100
          : snap(Math.max(nextLane.lo, Math.min(100, nextLane.hi + direction * interval)), next.state.steps)
    } else {
      const width = nextLane.hi - nextLane.lo
      const lower = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? 100 - width
          : snap(Math.min(100 - width, Math.max(0, nextLane.lo + direction * interval)), next.state.steps)
      nextLane.lo = lower
      nextLane.hi = lower + width
    }
    if (nextLane.lo === filterLane.lo && nextLane.hi === filterLane.hi) return
    commitLocal(next, 'Adjust filter')
  }

  const disposeBindings = () => {
    for (const binding of bindings.values()) {
      binding.resizeObserver?.disconnect()
      binding.pointer.dispose()
      binding.label.dispose()
    }
    bindings.clear()
  }

  const addLane = (mod: Mod<'filter'>, filterLane: FilterLane) => {
    const row = element('div', 'mod-row', face)
    row.dataset.modPartId = filterLane.id
    const head = element('div', 'mod-row-head', row)
    const labelElement = element('span', 'mod-sub t-micro', head)
    const value = element('span', 'mod-val t-value', head)
    value.setAttribute('aria-hidden', 'true')
    const label = mountInlineEdit(labelElement, {
      ariaLabel: 'Filter name',
      commit: (nextLabel) => {
        if (!current) return false
        const next = cloneDetached(current)
        const nextLane = next.state.lanes.find(({ id }) => id === filterLane.id)
        if (!nextLane) return false
        nextLane.label = nextLabel.toUpperCase()
        return commitLocal(next, 'Rename filter')
      },
    })

    if (mod.state.lanes.length > MOD_PART_BOUNDS.filter.min) {
      head.classList.add('has-x')
      const remove = element('button', 'row-x', head, '×')
      remove.type = 'button'
      remove.setAttribute('aria-label', `Remove ${filterLane.label}`)
      remove.addEventListener('pointerdown', (event) => claimDiscretePointer(event, interactive))
      remove.addEventListener('click', (event) => {
        if (!interactive || !current || activeDrag) return
        event.preventDefault()
        event.stopPropagation()
        const next = cloneDetached(current)
        const index = next.state.lanes.findIndex(({ id }) => id === filterLane.id)
        if (index < 0 || next.state.lanes.length <= MOD_PART_BOUNDS.filter.min) return
        next.state.lanes.splice(index, 1)
        commitLocal(next, 'Remove filter', true)
      })
    }

    const well = element('div', 'i-filter', row)
    well.setAttribute('role', 'slider')
    well.setAttribute('aria-orientation', 'horizontal')
    const geometryElement = element('span', 'i-filter-geometry', well)
    geometryElement.setAttribute('aria-hidden', 'true')
    const svg = svgElement('svg', '', well)
    svg.setAttribute('aria-hidden', 'true')
    const wash = svgElement('path', 'wash', svg)
    const curve = svgElement('path', 'curve', svg)
    const detents = svgElement('g', 'detents', svg)
    const foot = element('div', 'i-filter-foot', row)
    const chip = element('button', 'e-chip-key t-micro', foot)
    chip.type = 'button'
    chip.setAttribute('aria-label', `Change ${filterLane.label} filter mode`)
    chip.addEventListener('pointerdown', (event) => claimDiscretePointer(event, interactive))
    chip.addEventListener('keydown', (event) => {
      if (interactive) event.stopPropagation()
    })
    chip.addEventListener('click', (event) => {
      if (!interactive || !current || activeDrag) return
      event.preventDefault()
      event.stopPropagation()
      const next = cloneDetached(current)
      const nextLane = next.state.lanes.find(({ id }) => id === filterLane.id)
      if (!nextLane) return
      nextLane.mode = FILTER_MODES[(FILTER_MODES.indexOf(nextLane.mode) + 1) % FILTER_MODES.length]
      if (nextLane.mode === 'no-more-than') nextLane.lo = 0
      if (nextLane.mode === 'at-least') nextLane.hi = 100
      commitLocal(next, 'Change filter mode')
    })
    well.addEventListener('keydown', (event) => onKeyboard(event, filterLane.id))
    well.addEventListener('click', (event) => {
      if (interactive) event.stopPropagation()
    })

    let binding: FilterLaneBinding
    const pointer = mountPointerGesture(well, {
      scheduler: context.animationFrames,
      isEnabled: () => interactive && activeDrag === null,
      start: (event) => {
        if (!current || !ensureGeometry(binding) || !binding.geometry) return null
        const currentLane = lane(filterLane.id)
        if (!currentLane) return null
        const pointerValue = valueAt(
          event.clientX,
          binding.geometry.railScreenLeft,
          binding.geometry.railScreenWidth,
        )
        let grab: FilterGrab
        if (currentLane.mode === 'no-more-than') grab = 'hi'
        else if (currentLane.mode === 'at-least') grab = 'lo'
        else {
          const distanceFromLo = Math.abs(pointerValue - currentLane.lo)
          const distanceFromHi = Math.abs(pointerValue - currentLane.hi)
          grab = pointerValue > currentLane.lo + 8 && pointerValue < currentLane.hi - 8
            ? 'band'
            : distanceFromLo < distanceFromHi ? 'lo' : 'hi'
        }
        const session: FilterDragSession = {
          laneId: filterLane.id,
          grab,
          railLeft: binding.geometry.railScreenLeft,
          railWidth: binding.geometry.railScreenWidth,
          startValue: pointerValue,
          loStart: currentLane.lo,
          hiStart: currentLane.hi,
          baseline: cloneDetached(current),
          releaseGesture: context.beginGesture(),
          finished: false,
        }
        activeDrag = session
        well.classList.add('is-dragging')
        return session
      },
      frame: applyPointer,
      complete: (session) => {
        try {
          if (!current) return
          const before = session.baseline.state.lanes.find(({ id }) => id === session.laneId)
          const after = lane(session.laneId)
          if (before && after && (before.lo !== after.lo || before.hi !== after.hi)) {
            const next = cloneDetached(current)
            if (!context.commit(next, 'Adjust filter')) current = cloneDetached(session.baseline)
            else sourceMod = cloneDetached(next)
          }
          paint()
        } finally {
          finishDrag(session)
        }
      },
      cancel: cancelDrag,
    })

    binding = {
      laneId: filterLane.id,
      value,
      well,
      geometryElement,
      svg,
      wash,
      curve,
      detents,
      chip,
      label,
      pointer,
      resizeObserver: null,
      geometry: null,
      decorationKey: '',
    }
    if (typeof ResizeObserver !== 'undefined') {
      binding.resizeObserver = new ResizeObserver(() => {
        if (disposed || activeDrag) return
        ensureGeometry(binding)
        paintBinding(binding)
      })
      binding.resizeObserver.observe(well)
    }
    bindings.set(filterLane.id, binding)
  }

  function rebuild() {
    if (!current || disposed) return
    disposeBindings()
    face.replaceChildren()
    current.state.lanes.forEach((filterLane) => addLane(current!, filterLane))
    renderedStructure = structureKey(current)
    for (const binding of bindings.values()) ensureGeometry(binding)
    paint()
  }

  return {
    update(state: ModFaceRenderState<'filter'>) {
      if (disposed) return
      const incoming = cloneDetached(state.mod) as Mod<'filter'>
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

export const filterFaceDefinition: ModFaceDefinition<'filter'> = {
  kind: 'filter',
  mount: mountFilterFace,
}
