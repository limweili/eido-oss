import type { Mod } from '../model'
import { snap } from '../prompt'
import { cloneDetached } from '../snapshot'
import {
  mountPointerGesture,
  type PointerGestureCancelReason,
} from './pointerGesture'
import type { ModFaceDefinition, ModFaceMountContext, ModFaceRenderState } from './types'

type PadAxisName = 'x' | 'y'

type PadDragSession = {
  plane: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>
  baseline: Mod<'pad'>
  releaseGesture: () => void
  finished: boolean
}

const PAD_FREE_AXIS_GUIDE_SEGMENTS = 12

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

function clampRatio(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function roundedAriaValue(value: number): string {
  return String(Number(value.toFixed(2)))
}

function keyboardValue(value: number, steps: number, direction: -1 | 1): number {
  if (steps < 2) return snap(value + direction, steps)
  const interval = 100 / steps
  return snap((Math.round(value / interval) + direction) * interval, steps)
}

function axisValueText(mod: Mod<'pad'>, axisName: PadAxisName): string {
  const axis = mod.state.axes[axisName]
  const percent = Math.round(mod.state.v[axisName])
  return axis.lo && axis.hi
    ? `${percent}% of the way from ${axis.lo.toLowerCase()} to ${axis.hi.toLowerCase()}`
    : `${percent}%`
}

function sameSource(left: Mod<'pad'> | null, right: Mod<'pad'>): boolean {
  return left !== null && JSON.stringify(left) === JSON.stringify(right)
}

function mountPadFace(context: ModFaceMountContext<'pad'>) {
  const face = element('div', 'mod-face mod-face--pad', context.root)
  const row = element('div', 'mod-row', face)
  const head = element('div', 'mod-row-head', row)
  const label = element('span', 'mod-sub t-micro', head)
  const value = element('span', 'mod-val t-value', head)
  value.setAttribute('aria-hidden', 'true')

  const pad = element('div', 'i-pad', row)
  pad.setAttribute('role', 'group')
  const snapHost = element('div', 'i-pad-snaps', pad)
  snapHost.setAttribute('aria-hidden', 'true')
  const plane = element('div', 'i-pad-plane', pad)
  const xWrapper = element('div', 'i-pad-wx', plane)
  element('div', 'i-pad-ch i-pad-ch--v', xWrapper)
  const handleYWrapper = element('div', 'i-pad-wy', xWrapper)
  element('div', 'i-pad-handle', handleYWrapper)
  const yWrapper = element('div', 'i-pad-wy', plane)
  element('div', 'i-pad-ch i-pad-ch--h', yWrapper)

  const ends = {
    xlo: element('span', 'i-pad-end i-pad-end--xlo t-micro', pad),
    xhi: element('span', 'i-pad-end i-pad-end--xhi t-micro', pad),
    yhi: element('span', 'i-pad-end i-pad-end--yhi t-micro', pad),
    ylo: element('span', 'i-pad-end i-pad-end--ylo t-micro', pad),
  }
  const axisControls = {
    x: element('div', 'i-pad-axis-control i-pad-axis-control--x', pad),
    y: element('div', 'i-pad-axis-control i-pad-axis-control--y', pad),
  }
  for (const axisName of ['x', 'y'] as const) {
    const control = axisControls[axisName]
    control.dataset.padAxis = axisName
    control.setAttribute('role', 'slider')
    control.setAttribute('aria-valuemin', '0')
    control.setAttribute('aria-valuemax', '100')
    control.setAttribute('aria-orientation', axisName === 'x' ? 'horizontal' : 'vertical')
  }

  let sourceMod: Mod<'pad'> | null = null
  let current: Mod<'pad'> | null = null
  let interactive = false
  let renderedSnaps = ''
  let activeDrag: PadDragSession | null = null
  let disposed = false

  const snapKey = (mod: Mod<'pad'>) => `${mod.state.axes.x.steps}:${mod.state.axes.y.steps}`

  const paintSnaps = () => {
    if (!current) return
    const xSteps = current.state.axes.x.steps
    const ySteps = current.state.axes.y.steps
    snapHost.replaceChildren()
    const dot = (x: number, y: number) => {
      const mark = element('span', 'i-pad-snap', snapHost)
      mark.style.setProperty('--e-mod-face-snap-x', x.toFixed(4))
      mark.style.setProperty('--e-mod-face-snap-y', y.toFixed(4))
    }
    if (xSteps >= 2 && ySteps >= 2) {
      for (let x = 0; x <= xSteps; x += 1) {
        for (let y = 0; y <= ySteps; y += 1) dot(x / xSteps, 1 - y / ySteps)
      }
    } else if (xSteps >= 2) {
      for (let x = 0; x <= xSteps; x += 1) {
        for (let y = 0; y <= PAD_FREE_AXIS_GUIDE_SEGMENTS; y += 1) {
          dot(x / xSteps, y / PAD_FREE_AXIS_GUIDE_SEGMENTS)
        }
      }
    } else if (ySteps >= 2) {
      for (let y = 0; y <= ySteps; y += 1) {
        for (let x = 0; x <= PAD_FREE_AXIS_GUIDE_SEGMENTS; x += 1) {
          dot(x / PAD_FREE_AXIS_GUIDE_SEGMENTS, 1 - y / ySteps)
        }
      }
    }
    renderedSnaps = snapKey(current)
  }

  const paint = () => {
    if (!current) return
    const { axes } = current.state
    pad.style.setProperty('--e-mod-face-x', (current.state.v.x / 100).toFixed(4))
    pad.style.setProperty('--e-mod-face-y', (current.state.v.y / 100).toFixed(4))
    label.textContent = `${axes.x.label} × ${axes.y.label}`
    value.textContent = `${Math.round(current.state.v.x)} · ${Math.round(current.state.v.y)}`
    pad.setAttribute('aria-label', `${axes.x.label} by ${axes.y.label} pad`)
    ends.xlo.textContent = axes.x.lo
    ends.xhi.textContent = axes.x.hi
    ends.yhi.textContent = axes.y.hi
    ends.ylo.textContent = axes.y.lo
    for (const axisName of ['x', 'y'] as const) {
      const axis = axes[axisName]
      const control = axisControls[axisName]
      control.tabIndex = interactive ? 0 : -1
      control.setAttribute('aria-disabled', String(!interactive))
      control.setAttribute('aria-label', `${axis.label} ${axisName === 'x' ? 'horizontal' : 'vertical'} axis`)
      control.setAttribute('aria-valuenow', roundedAriaValue(current.state.v[axisName]))
      control.setAttribute('aria-valuetext', axisValueText(current, axisName))
    }
    if (renderedSnaps !== snapKey(current)) paintSnaps()
  }

  const finishDrag = (session: PadDragSession) => {
    if (session.finished) return
    session.finished = true
    if (activeDrag === session) activeDrag = null
    pad.classList.remove('is-dragging')
    session.releaseGesture()
  }

  const cancelDrag = (session: PadDragSession, _reason: PointerGestureCancelReason) => {
    try {
      current = cloneDetached(session.baseline)
      paint()
    } finally {
      finishDrag(session)
    }
  }

  const commitLocal = (next: Mod<'pad'>, commitLabel: string): boolean => {
    if (!context.commit(next, commitLabel)) return false
    sourceMod = cloneDetached(next)
    current = cloneDetached(next)
    paint()
    return true
  }

  const applyPointer = (session: PadDragSession, event: PointerEvent) => {
    if (!current || session.plane.width <= 0 || session.plane.height <= 0) return
    const x = clampRatio((event.clientX - session.plane.left) / session.plane.width)
    const y = clampRatio(1 - (event.clientY - session.plane.top) / session.plane.height)
    current.state.v.x = snap(x * 100, current.state.axes.x.steps)
    current.state.v.y = snap(y * 100, current.state.axes.y.steps)
    paint()
  }

  const pointer = mountPointerGesture(pad, {
    scheduler: context.animationFrames,
    isEnabled: () => interactive && activeDrag === null,
    start: (event) => {
      if (!current) return null
      const planeRect = plane.getBoundingClientRect()
      if (
        !Number.isFinite(planeRect.left)
        || !Number.isFinite(planeRect.top)
        || !Number.isFinite(planeRect.width)
        || !Number.isFinite(planeRect.height)
        || planeRect.width <= 0
        || planeRect.height <= 0
      ) return null
      const session: PadDragSession = {
        plane: {
          left: planeRect.left,
          top: planeRect.top,
          width: planeRect.width,
          height: planeRect.height,
        },
        baseline: cloneDetached(current),
        releaseGesture: context.beginGesture(),
        finished: false,
      }
      activeDrag = session
      pad.classList.add('is-dragging')
      applyPointer(session, event)
      return session
    },
    frame: applyPointer,
    complete: (session) => {
      try {
        if (!current) return
        const before = session.baseline.state.v
        const after = current.state.v
        if (before.x !== after.x || before.y !== after.y) {
          const next = cloneDetached(current)
          if (!context.commit(next, 'Adjust pad')) current = cloneDetached(session.baseline)
          else sourceMod = cloneDetached(next)
        }
        paint()
      } finally {
        finishDrag(session)
      }
    },
    cancel: cancelDrag,
  })

  const onKeyboard = (event: KeyboardEvent, axisName: PadAxisName) => {
    if (!interactive || !current) return
    event.stopPropagation()
    const axis = current.state.axes[axisName]
    const currentValue = current.state.v[axisName]
    let nextValue: number | undefined
    if (event.key === 'Home') nextValue = 0
    else if (event.key === 'End') nextValue = 100
    else if (
      (axisName === 'x' && event.key === 'ArrowLeft')
      || (axisName === 'y' && event.key === 'ArrowDown')
    ) nextValue = keyboardValue(currentValue, axis.steps, -1)
    else if (
      (axisName === 'x' && event.key === 'ArrowRight')
      || (axisName === 'y' && event.key === 'ArrowUp')
    ) nextValue = keyboardValue(currentValue, axis.steps, 1)
    if (nextValue === undefined) return
    event.preventDefault()
    if (nextValue === currentValue) return
    const next = cloneDetached(current)
    next.state.v[axisName] = nextValue
    commitLocal(next, 'Adjust pad')
  }

  for (const axisName of ['x', 'y'] as const) {
    axisControls[axisName].addEventListener('keydown', (event) => onKeyboard(event, axisName))
  }
  pad.addEventListener('click', (event) => {
    if (interactive) event.stopPropagation()
  })

  return {
    update(state: ModFaceRenderState<'pad'>) {
      if (disposed) return
      const incoming = cloneDetached(state.mod) as Mod<'pad'>
      const sourceChanged = !sameSource(sourceMod, incoming)
      if (activeDrag && (!state.interactive || sourceChanged)) pointer.cancel('disabled')
      interactive = state.interactive
      if (!activeDrag || sourceChanged) {
        sourceMod = cloneDetached(incoming)
        current = cloneDetached(incoming)
      }
      paint()
    },
    dispose() {
      if (disposed) return
      pointer.dispose()
      disposed = true
      activeDrag = null
      face.remove()
    },
  }
}

export const padFaceDefinition: ModFaceDefinition<'pad'> = {
  kind: 'pad',
  mount: mountPadFace,
}
