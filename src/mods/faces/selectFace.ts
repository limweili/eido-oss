import { MOD_PART_BOUNDS } from '../growth'
import type { Mod } from '../model'
import { cloneDetached } from '../snapshot'
import {
  mountPointerGesture,
  type PointerGestureCancelReason,
  type PointerGestureController,
} from './pointerGesture'
import type { ModFaceDefinition, ModFaceMountContext, ModFaceRenderState } from './types'

type SelectOptionBinding = {
  optionId: string
  cell: HTMLElement
  name: HTMLElement
  remove: HTMLButtonElement | null
}

type SelectDragSession = {
  baseline: Mod<'select'>
  rects: Array<Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>>
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

function structureKey(mod: Mod<'select'>): string {
  return mod.state.options.map(({ id }) => id).join(':')
}

function claimDiscretePointer(event: PointerEvent, enabled: boolean): void {
  if (enabled) event.stopPropagation()
}

function claimDiscreteKey(event: KeyboardEvent, enabled: boolean): void {
  if (enabled && (event.key === 'Enter' || event.key === ' ')) event.stopPropagation()
}

function mountSelectFace(context: ModFaceMountContext<'select'>) {
  const face = element('div', 'mod-face mod-face--select', context.root)
  let bindings: SelectOptionBinding[] = []
  let pointer: PointerGestureController | null = null
  let sourceMod: Mod<'select'> | null = null
  let current: Mod<'select'> | null = null
  let interactive = false
  let renderedStructure = ''
  let activeDrag: SelectDragSession | null = null
  let groupElement: HTMLElement | null = null
  let disposed = false

  const paint = () => {
    if (!current) return
    const rendered = current
    groupElement?.setAttribute('aria-label', `${rendered.title} options`)
    bindings.forEach((binding, index) => {
      const option = rendered.state.options[index]
      if (!option || option.id !== binding.optionId) return
      const picked = index === rendered.state.picked
      binding.name.textContent = option.label
      binding.cell.classList.toggle('is-picked', picked)
      binding.cell.setAttribute('aria-label', option.label)
      binding.cell.setAttribute('aria-checked', String(picked))
      binding.cell.setAttribute('aria-disabled', String(!interactive))
      binding.cell.tabIndex = interactive && picked ? 0 : -1
      binding.remove?.setAttribute('aria-label', `Remove ${option.label}`)
    })
  }

  const finishDrag = (session: SelectDragSession) => {
    if (session.finished) return
    session.finished = true
    if (activeDrag === session) activeDrag = null
    face.classList.remove('is-dragging')
    session.releaseGesture()
  }

  const cancelDrag = (session: SelectDragSession, _reason: PointerGestureCancelReason) => {
    try {
      current = cloneDetached(session.baseline)
      paint()
    } finally {
      finishDrag(session)
    }
  }

  const commitLocal = (
    next: Mod<'select'>,
    label: string,
    structural = false,
    focusOptionId?: string,
  ): boolean => {
    if (!context.commit(next, label)) return false
    sourceMod = cloneDetached(next)
    current = cloneDetached(next)
    if (structural) rebuild()
    else paint()
    if (focusOptionId) bindings.find(({ optionId }) => optionId === focusOptionId)?.cell.focus()
    return true
  }

  const pick = (index: number) => {
    if (!current || index < 0 || index >= current.state.options.length) return
    if (current.state.picked === index) return
    current.state.picked = index
    paint()
  }

  const hitIndex = (session: SelectDragSession, event: PointerEvent): number | undefined => {
    const index = session.rects.findIndex((rect) => (
      event.clientX >= rect.left
      && event.clientX <= rect.right
      && event.clientY >= rect.top
      && event.clientY <= rect.bottom
    ))
    return index >= 0 ? index : undefined
  }

  const applyPointer = (session: SelectDragSession, event: PointerEvent) => {
    const index = hitIndex(session, event)
    if (index !== undefined) pick(index)
  }

  const onKeyboard = (event: KeyboardEvent, optionId: string) => {
    if (!interactive || !current) return
    const index = current.state.options.findIndex(({ id }) => id === optionId)
    if (index < 0) return
    let nextIndex: number | undefined
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (index - 1 + current.state.options.length) % current.state.options.length
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (index + 1) % current.state.options.length
    } else if (event.key === 'Home') {
      nextIndex = 0
    } else if (event.key === 'End') {
      nextIndex = current.state.options.length - 1
    } else if (event.key === 'Enter' || event.key === ' ') {
      nextIndex = index
    }
    if (nextIndex === undefined) return
    event.preventDefault()
    event.stopPropagation()
    if (nextIndex === current.state.picked) return
    const next = cloneDetached(current)
    next.state.picked = nextIndex
    if (commitLocal(next, 'Pick option')) bindings[nextIndex]?.cell.focus()
  }

  const disposeBindings = () => {
    pointer?.dispose()
    pointer = null
    bindings = []
  }

  function rebuild() {
    if (!current || disposed) return
    disposeBindings()
    face.replaceChildren()
    const row = element('div', 'mod-row', face)
    const segmented = current.state.options.length <= 4
    const group = element('div', segmented ? 'i-seg' : 'i-stack', row)
    groupElement = group
    group.setAttribute('role', 'radiogroup')

    bindings = current.state.options.map((option, index) => {
      const slot = element('div', segmented ? 'i-seg-slot' : 'i-stack-slot', group)
      const cell = element('div', `${segmented ? 'i-seg-cell' : 'i-stack-row'} t-label`, slot)
      cell.setAttribute('role', 'radio')
      cell.dataset.modPartId = option.id
      cell.addEventListener('keydown', (event) => onKeyboard(event, option.id))
      const name = element('span', 'opt-name', cell, option.label)
      let remove: HTMLButtonElement | null = null

      if (current!.state.options.length > MOD_PART_BOUNDS.select.min) {
        remove = element('button', 'row-x', slot, '×')
        remove.type = 'button'
        remove.setAttribute('aria-label', `Remove ${option.label}`)
        remove.addEventListener('pointerdown', (event) => claimDiscretePointer(event, interactive))
        remove.addEventListener('keydown', (event) => claimDiscreteKey(event, interactive))
        remove.addEventListener('click', (event) => {
          if (!interactive || !current) return
          event.preventDefault()
          event.stopPropagation()
          const next = cloneDetached(current)
          if (next.state.options.length <= MOD_PART_BOUNDS.select.min) return
          next.state.options.splice(index, 1)
          next.state.picked = Math.min(next.state.picked, next.state.options.length - 1)
          const focusOptionId = next.state.options[Math.min(index, next.state.options.length - 1)]?.id
          commitLocal(next, 'Remove option', true, focusOptionId)
        })
      }
      return { optionId: option.id, cell, name, remove }
    })

    pointer = mountPointerGesture(group, {
      scheduler: context.animationFrames,
      isEnabled: () => interactive && activeDrag === null,
      start: (event) => {
        if (!current) return null
        const target = event.target instanceof Element
          ? event.target.closest<HTMLElement>('[role="radio"]')
          : null
        const targetIndex = bindings.findIndex(({ cell }) => cell === target)
        if (targetIndex < 0) return null
        const session: SelectDragSession = {
          baseline: cloneDetached(current),
          rects: bindings.map(({ cell }) => {
            const rect = cell.getBoundingClientRect()
            return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
          }),
          releaseGesture: context.beginGesture(),
          finished: false,
        }
        activeDrag = session
        face.classList.add('is-dragging')
        pick(targetIndex)
        return session
      },
      frame: applyPointer,
      complete: (session) => {
        try {
          if (!current || current.state.picked === session.baseline.state.picked) return
          const next = cloneDetached(current)
          if (!context.commit(next, 'Pick option')) current = cloneDetached(session.baseline)
          else sourceMod = cloneDetached(next)
          paint()
        } finally {
          finishDrag(session)
        }
      },
      cancel: cancelDrag,
    })

    renderedStructure = structureKey(current)
    paint()
  }

  return {
    update(state: ModFaceRenderState<'select'>) {
      if (disposed) return
      const incoming = cloneDetached(state.mod) as Mod<'select'>
      const sourceChanged = sourceMod === null
        || JSON.stringify(sourceMod) !== JSON.stringify(incoming)

      if (activeDrag && (!state.interactive || sourceChanged)) pointer?.cancel('disabled')
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

export const selectFaceDefinition: ModFaceDefinition<'select'> = {
  kind: 'select',
  mount: mountSelectFace,
}
