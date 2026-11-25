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

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
const RADAR_VIEWBOX_WIDTH = 300
const RADAR_VIEWBOX_HEIGHT = 240
const RADAR_MIN_RADIUS = 24
const RADAR_MIN_VERTEX_RATIO = 0.05

type Point = { x: number; y: number }

type ClientSvgTransform = {
  toSvg: (clientX: number, clientY: number) => Point
  toClient: (svgX: number, svgY: number) => Point
}

type SvgBounds = {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

type RadarGeometry = {
  centerX: number
  centerY: number
  radius: number
  labelRadius: number
  axisCount: number
}

type RadarAxisBinding = {
  axisId: string
  group: SVGGElement
  circle: SVGCircleElement
  wrapper: HTMLSpanElement
  labelElement: HTMLSpanElement
  label: InlineEditController
  remove: HTMLButtonElement
  pointer: PointerGestureController
}

type RadarDragSession = {
  axisId: string
  baseline: Mod<'radar'>
  centerX: number
  centerY: number
  radius: number
  cosine: number
  sine: number
  clientToSvg: ClientSvgTransform['toSvg']
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
  const child = document.createElementNS(SVG_NAMESPACE, tag)
  for (const [name, value] of Object.entries(attributes)) child.setAttribute(name, String(value))
  parent.append(child)
  return child
}

function finiteRect(rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>): boolean {
  return Number.isFinite(rect.left)
    && Number.isFinite(rect.top)
    && Number.isFinite(rect.width)
    && Number.isFinite(rect.height)
    && rect.width > 0
    && rect.height > 0
}

function affinePoint(
  matrix: Pick<DOMMatrix, 'a' | 'b' | 'c' | 'd' | 'e' | 'f'>,
  x: number,
  y: number,
): Point {
  return {
    x: matrix.a * x + matrix.c * y + matrix.e,
    y: matrix.b * x + matrix.d * y + matrix.f,
  }
}

function clientSvgTransform(svg: SVGSVGElement, wellRect: DOMRect): ClientSvgTransform {
  const matrix = typeof svg.getScreenCTM === 'function' ? svg.getScreenCTM() : null
  if (matrix) {
    try {
      const inverse = matrix.inverse()
      if ([
        matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f,
        inverse.a, inverse.b, inverse.c, inverse.d, inverse.e, inverse.f,
      ].every(Number.isFinite)) {
        return {
          toSvg: (x, y) => affinePoint(inverse, x, y),
          toClient: (x, y) => affinePoint(matrix, x, y),
        }
      }
    } catch {
      // The rect-ratio fallback remains zoom-correct when an SVG matrix is unavailable.
    }
  }

  if (finiteRect(wellRect)) {
    return {
      toSvg: (x, y) => ({
        x: (x - wellRect.left) / wellRect.width * RADAR_VIEWBOX_WIDTH,
        y: (y - wellRect.top) / wellRect.height * RADAR_VIEWBOX_HEIGHT,
      }),
      toClient: (x, y) => ({
        x: wellRect.left + x / RADAR_VIEWBOX_WIDTH * wellRect.width,
        y: wellRect.top + y / RADAR_VIEWBOX_HEIGHT * wellRect.height,
      }),
    }
  }

  return {
    toSvg: (x, y) => ({ x, y }),
    toClient: (x, y) => ({ x, y }),
  }
}

function clientRectToSvgBounds(
  rect: DOMRect,
  transform: ClientSvgTransform,
): SvgBounds | null {
  if (!finiteRect(rect)) return null
  const start = transform.toSvg(rect.left, rect.top)
  const end = transform.toSvg(rect.right, rect.bottom)
  const left = Math.min(start.x, end.x)
  const right = Math.max(start.x, end.x)
  const top = Math.min(start.y, end.y)
  const bottom = Math.max(start.y, end.y)
  const width = right - left
  const height = bottom - top
  if (![left, right, top, bottom, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    return null
  }
  return { left, right, top, bottom, width, height }
}

function fallbackChartBounds(): SvgBounds {
  return {
    left: 100,
    right: 200,
    top: 32,
    bottom: 208,
    width: 100,
    height: 176,
  }
}

function fallbackLabelBounds(): SvgBounds {
  return {
    left: 84,
    right: 216,
    top: 16,
    bottom: 224,
    width: 132,
    height: 208,
  }
}

function angleForAxis(index: number, count: number): number {
  return index / count * Math.PI * 2 - Math.PI / 2
}

function pointAt(geometry: RadarGeometry, index: number, radius: number): Point {
  const angle = angleForAxis(index, geometry.axisCount)
  return {
    x: geometry.centerX + radius * Math.cos(angle),
    y: geometry.centerY + radius * Math.sin(angle),
  }
}

function pointsAttribute(points: readonly Point[]): string {
  return points.map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
}

function roundedAriaValue(value: number): string {
  return String(Number(value.toFixed(2)))
}

function keyboardValue(value: number, steps: number, direction: -1 | 1): number {
  if (steps < 2) return snap(value + direction, steps)
  const interval = 100 / steps
  return snap((Math.round(value / interval) + direction) * interval, steps)
}

function sameSource(left: Mod<'radar'> | null, right: Mod<'radar'>): boolean {
  return left !== null && JSON.stringify(left) === JSON.stringify(right)
}

function claimDiscretePointer(event: PointerEvent, enabled: boolean): void {
  if (enabled) event.stopPropagation()
}

function mountRadarFace(context: ModFaceMountContext<'radar'>) {
  const face = element('div', 'mod-face mod-face--radar', context.root)
  const row = element('div', 'mod-row', face)
  const well = element('div', 'i-radar', row)
  const chartPlane = element('div', 'i-radar-plane', well)
  const labelPlane = element('div', 'i-radar-label-plane', well)
  const svg = svgElement('svg', {
    class: 'i-radar-svg',
    viewBox: `0 0 ${RADAR_VIEWBOX_WIDTH} ${RADAR_VIEWBOX_HEIGHT}`,
    role: 'group',
    'aria-label': 'Radar axes',
  }, well)
  const background = svgElement('g', { class: 'rd-back', 'aria-hidden': 'true' }, svg)
  const fill = svgElement('polygon', { class: 'rd-fill', 'aria-hidden': 'true' }, svg)
  const line = svgElement('polygon', { class: 'rd-line', 'aria-hidden': 'true' }, svg)
  const vertexGroup = svgElement('g', { class: 'rd-vertices' }, svg)

  const bindings = new Map<string, RadarAxisBinding>()
  let sourceMod: Mod<'radar'> | null = null
  let current: Mod<'radar'> | null = null
  let interactive = false
  let renderedStructure = ''
  let geometry: RadarGeometry | null = null
  let activeDrag: RadarDragSession | null = null
  let disposed = false

  const structureKey = (mod: Mod<'radar'>) => (
    `${mod.state.steps}:${mod.state.axes.map(({ id }) => id).join(':')}`
  )

  const axis = (axisId: string) => current?.state.axes.find((candidate) => candidate.id === axisId)

  const paintBindingAccessibility = (binding: RadarAxisBinding) => {
    if (!current) return
    const radarAxis = axis(binding.axisId)
    if (!radarAxis) return
    binding.circle.tabIndex = interactive ? 0 : -1
    binding.circle.setAttribute('aria-disabled', String(!interactive))
    binding.circle.setAttribute('aria-label', `${radarAxis.label} radar axis`)
    binding.circle.setAttribute('aria-valuemin', '0')
    binding.circle.setAttribute('aria-valuemax', '100')
    binding.circle.setAttribute('aria-valuenow', roundedAriaValue(radarAxis.v))
    binding.circle.setAttribute('aria-valuetext', spoken(radarAxis.v, current.state.steps, null))
  }

  const paintValues = () => {
    if (!current || !geometry || geometry.axisCount !== current.state.axes.length) return
    const points = current.state.axes.map((radarAxis, index) => (
      pointAt(geometry!, index, geometry!.radius * Math.max(RADAR_MIN_VERTEX_RATIO, radarAxis.v / 100))
    ))
    const pointsText = pointsAttribute(points)
    fill.setAttribute('points', pointsText)
    line.setAttribute('points', pointsText)
    points.forEach((point, index) => {
      const binding = bindings.get(current!.state.axes[index].id)
      if (!binding) return
      binding.circle.setAttribute('cx', point.x.toFixed(1))
      binding.circle.setAttribute('cy', point.y.toFixed(1))
      paintBindingAccessibility(binding)
    })
  }

  const finishDrag = (session: RadarDragSession) => {
    if (session.finished) return
    session.finished = true
    if (activeDrag === session) activeDrag = null
    bindings.get(session.axisId)?.circle.classList.remove('is-dragging')
    session.releaseGesture()
  }

  const commitLocal = (
    next: Mod<'radar'>,
    commitLabel: string,
    fullPaint: boolean,
  ): boolean => {
    if (!context.commit(next, commitLabel)) return false
    sourceMod = cloneDetached(next)
    current = cloneDetached(next)
    if (fullPaint) paintFull()
    else paintValues()
    return true
  }

  const applyPointer = (session: RadarDragSession, event: PointerEvent) => {
    if (!current || session.radius <= 0) return
    const radarAxis = axis(session.axisId)
    if (!radarAxis) return
    const point = session.clientToSvg(event.clientX, event.clientY)
    const x = point.x - session.centerX
    const y = point.y - session.centerY
    const ratio = Math.min(1, Math.max(0, (
      x * session.cosine + y * session.sine
    ) / session.radius))
    radarAxis.v = snap(ratio * 100, current.state.steps)
    paintValues()
  }

  const cancelDrag = (session: RadarDragSession, _reason: PointerGestureCancelReason) => {
    try {
      current = cloneDetached(session.baseline)
      paintFull()
    } finally {
      finishDrag(session)
    }
  }

  const onKeyboard = (event: KeyboardEvent, axisId: string) => {
    if (!interactive || !current) return
    event.stopPropagation()
    const radarAxis = axis(axisId)
    if (!radarAxis) return
    let nextValue: number | undefined
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      nextValue = keyboardValue(radarAxis.v, current.state.steps, -1)
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      nextValue = keyboardValue(radarAxis.v, current.state.steps, 1)
    } else if (event.key === 'Home') {
      nextValue = 0
    } else if (event.key === 'End') {
      nextValue = 100
    }
    if (nextValue === undefined) return
    event.preventDefault()
    if (nextValue === radarAxis.v) return
    const next = cloneDetached(current)
    const nextAxis = next.state.axes.find(({ id }) => id === axisId)
    if (!nextAxis) return
    nextAxis.v = nextValue
    commitLocal(next, 'Adjust radar axis', false)
  }

  const createBinding = (axisId: string): RadarAxisBinding => {
    const group = svgElement('g', { class: 'rd-axis' }, vertexGroup)
    const circle = svgElement('circle', {
      class: 'rd-vert',
      r: 6,
      role: 'slider',
      'data-mod-part-id': axisId,
    }, group)
    circle.addEventListener('keydown', (event) => onKeyboard(event, axisId))

    const wrapper = element('span', 'rd-tipwrap', well)
    wrapper.dataset.modPartId = axisId
    const labelElement = element('span', 'rd-lbl t-micro', wrapper)
    const label = mountInlineEdit(labelElement, {
      ariaLabel: 'Radar axis name',
      commit: (nextLabel) => {
        if (!current) return false
        const next = cloneDetached(current)
        const nextAxis = next.state.axes.find(({ id }) => id === axisId)
        if (!nextAxis) return false
        nextAxis.label = nextLabel.toUpperCase()
        return commitLocal(next, 'Rename radar axis', true)
      },
    })
    const remove = element('button', 'row-x', wrapper, '×')
    remove.type = 'button'
    remove.addEventListener('pointerdown', (event) => claimDiscretePointer(event, interactive))
    remove.addEventListener('click', (event) => {
      if (!interactive || !current) return
      event.preventDefault()
      event.stopPropagation()
      const next = cloneDetached(current)
      const index = next.state.axes.findIndex(({ id }) => id === axisId)
      if (index < 0 || next.state.axes.length <= MOD_PART_BOUNDS.radar.min) return
      next.state.axes.splice(index, 1)
      commitLocal(next, 'Remove radar axis', true)
    })

    const pointer = mountPointerGesture(circle as unknown as HTMLElement, {
      scheduler: context.animationFrames,
      isEnabled: () => interactive && activeDrag === null,
      start: (event) => {
        if (!current || !geometry) return null
        const index = current.state.axes.findIndex(({ id }) => id === axisId)
        const wellRect = well.getBoundingClientRect()
        if (index < 0 || !finiteRect(wellRect) || geometry.radius <= 0) return null
        const angle = angleForAxis(index, current.state.axes.length)
        const session: RadarDragSession = {
          axisId,
          baseline: cloneDetached(current),
          centerX: geometry.centerX,
          centerY: geometry.centerY,
          radius: geometry.radius,
          cosine: Math.cos(angle),
          sine: Math.sin(angle),
          clientToSvg: clientSvgTransform(svg, wellRect).toSvg,
          releaseGesture: context.beginGesture(),
          finished: false,
        }
        activeDrag = session
        circle.classList.add('is-dragging')
        applyPointer(session, event)
        return session
      },
      frame: applyPointer,
      complete: (session) => {
        try {
          if (!current) return
          const before = session.baseline.state.axes.find(({ id }) => id === session.axisId)?.v
          const after = axis(session.axisId)?.v
          if (before !== undefined && after !== undefined && before !== after) {
            const next = cloneDetached(current)
            if (!context.commit(next, 'Adjust radar axis')) current = cloneDetached(session.baseline)
            else sourceMod = cloneDetached(next)
          }
          paintValues()
        } finally {
          finishDrag(session)
        }
      },
      cancel: cancelDrag,
    })

    return { axisId, group, circle, wrapper, labelElement, label, remove, pointer }
  }

  const disposeBinding = (binding: RadarAxisBinding) => {
    binding.pointer.dispose()
    binding.label.dispose()
    binding.group.remove()
    binding.wrapper.remove()
  }

  const reconcileStructure = () => {
    if (!current) return
    const liveIds = new Set(current.state.axes.map(({ id }) => id))
    for (const [axisId, binding] of bindings) {
      if (!liveIds.has(axisId)) {
        disposeBinding(binding)
        bindings.delete(axisId)
      }
    }
    current.state.axes.forEach((radarAxis) => {
      let binding = bindings.get(radarAxis.id)
      if (!binding) {
        binding = createBinding(radarAxis.id)
        bindings.set(radarAxis.id, binding)
      }
      vertexGroup.append(binding.group)
      well.append(binding.wrapper)
    })
    renderedStructure = structureKey(current)
  }

  function paintFull() {
    if (!current || disposed) return
    if (renderedStructure !== structureKey(current)) reconcileStructure()

    const wellRect = well.getBoundingClientRect()
    const transform = clientSvgTransform(svg, wellRect)
    const chartBounds = clientRectToSvgBounds(chartPlane.getBoundingClientRect(), transform)
      ?? fallbackChartBounds()
    const labelBounds = clientRectToSvgBounds(labelPlane.getBoundingClientRect(), transform)
      ?? fallbackLabelBounds()
    const centerX = (chartBounds.left + chartBounds.right) / 2
    const centerY = (chartBounds.top + chartBounds.bottom) / 2
    const radius = Math.max(RADAR_MIN_RADIUS, Math.min(chartBounds.width, chartBounds.height) / 2)
    const labelPadding = Math.max(0, Math.min(
      chartBounds.left - labelBounds.left,
      labelBounds.right - chartBounds.right,
      chartBounds.top - labelBounds.top,
      labelBounds.bottom - chartBounds.bottom,
    ))
    geometry = {
      centerX,
      centerY,
      radius,
      labelRadius: radius + labelPadding,
      axisCount: current.state.axes.length,
    }

    background.replaceChildren()
    const ringCount = current.state.steps >= 2 ? current.state.steps : 1
    for (let ring = 1; ring <= ringCount; ring += 1) {
      svgElement('polygon', {
        points: pointsAttribute(current.state.axes.map((_, index) => (
          pointAt(geometry!, index, radius * ring / ringCount)
        ))),
      }, background)
    }
    current.state.axes.forEach((_, index) => {
      const end = pointAt(geometry!, index, radius)
      svgElement('line', {
        x1: centerX.toFixed(1),
        y1: centerY.toFixed(1),
        x2: end.x.toFixed(1),
        y2: end.y.toFixed(1),
      }, background)
    })

    current.state.axes.forEach((radarAxis, index) => {
      const binding = bindings.get(radarAxis.id)
      if (!binding) return
      binding.label.update(radarAxis.label, interactive)
      binding.remove.hidden = current!.state.axes.length <= MOD_PART_BOUNDS.radar.min
      binding.remove.setAttribute('aria-label', `Remove ${radarAxis.label}`)
      const labelPoint = pointAt(geometry!, index, geometry!.labelRadius)
      const clientPoint = transform.toClient(labelPoint.x, labelPoint.y)
      const xRatio = finiteRect(wellRect) ? (clientPoint.x - wellRect.left) / wellRect.width : 0.5
      const yRatio = finiteRect(wellRect) ? (clientPoint.y - wellRect.top) / wellRect.height : 0.5
      binding.wrapper.style.setProperty('--e-mod-face-label-x', xRatio.toFixed(4))
      binding.wrapper.style.setProperty('--e-mod-face-label-y', yRatio.toFixed(4))
      const cosine = Math.cos(angleForAxis(index, current!.state.axes.length))
      binding.wrapper.dataset.anchor = Math.abs(cosine) < 0.25
        ? 'middle'
        : cosine > 0 ? 'start' : 'end'
    })
    paintValues()
  }

  const resizeObserver = typeof ResizeObserver === 'undefined'
    ? null
    : new ResizeObserver(() => paintFull())
  resizeObserver?.observe(well)

  return {
    update(state: ModFaceRenderState<'radar'>) {
      if (disposed) return
      const incoming = cloneDetached(state.mod) as Mod<'radar'>
      const sourceChanged = !sameSource(sourceMod, incoming)
      if (activeDrag && (!state.interactive || sourceChanged)) {
        bindings.get(activeDrag.axisId)?.pointer.cancel('disabled')
      }
      const interactionChanged = interactive !== state.interactive
      interactive = state.interactive
      if (!activeDrag || sourceChanged) {
        sourceMod = cloneDetached(incoming)
        current = cloneDetached(incoming)
      }
      if (!current) return
      if (sourceChanged || renderedStructure !== structureKey(current) || geometry === null) {
        paintFull()
      } else {
        if (interactionChanged) {
          current.state.axes.forEach((radarAxis) => {
            bindings.get(radarAxis.id)?.label.update(radarAxis.label, interactive)
          })
        }
        paintValues()
      }
    },
    dispose() {
      if (disposed) return
      resizeObserver?.disconnect()
      for (const binding of bindings.values()) disposeBinding(binding)
      bindings.clear()
      disposed = true
      activeDrag = null
      face.remove()
    },
  }
}

export const radarFaceDefinition: ModFaceDefinition<'radar'> = {
  kind: 'radar',
  mount: mountRadarFace,
}
