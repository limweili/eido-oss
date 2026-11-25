import { MOD_PART_BOUNDS } from '../growth'
import type { Mod } from '../model'
import { cloneDetached } from '../snapshot'
import { resolveCardIdentity } from '../../ui/cardIdentity'
import {
  mountPointerGesture,
  type PointerGestureCancelReason,
  type PointerGestureController,
} from './pointerGesture'
import type { ModFaceDefinition, ModFaceMountContext, ModFaceRenderState } from './types'

type OrderTokenBinding = {
  itemIndex: number
  itemId: string
  token: HTMLElement
  label: OrderInlineEditController
  remove: HTMLButtonElement | null
  pointer: PointerGestureController
}

type OrderInlineEditController = Readonly<{
  begin: () => void
  update: (value: string, enabled: boolean) => void
  dispose: () => void
}>

type OrderDragSession = {
  itemIndex: number
  homeRank: number
  pickupOrder: number[]
  rects: Array<Pick<DOMRect, 'top' | 'height'>>
  pitch: number
  startY: number
  baseline: Mod<'order'>
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

function structureKey(mod: Mod<'order'>): string {
  return `${mod.state.items.map(({ id }) => id).join(':')}|${mod.state.perm.join(':')}`
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function orderEqual(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function shiftValue(value: number): string {
  return String(Number(value.toFixed(4)))
}

function claimDiscretePointer(event: PointerEvent, enabled: boolean): void {
  if (enabled) event.stopPropagation()
}

function claimDiscreteKey(event: KeyboardEvent, enabled: boolean): void {
  if (enabled && (event.key === 'Enter' || event.key === ' ')) event.stopPropagation()
}

function mountOrderInlineEdit(
  element: HTMLElement,
  token: HTMLElement,
  options: Readonly<{ ariaLabel: string; commit: (value: string) => boolean | void }>,
): OrderInlineEditController {
  let value = ''
  let enabled = false
  let editing = false
  let cancelled = false
  let restoreTokenFocus = false
  let disposed = false

  element.classList.add('e-edit')
  element.spellcheck = false
  element.setAttribute('role', 'textbox')
  element.setAttribute('aria-label', options.ariaLabel)

  const finish = () => {
    if (!editing) return
    editing = false
    const next = (element.textContent?.trim() ?? '').toUpperCase()
    if (!cancelled && next && next !== value && options.commit(next) !== false) value = next
    cancelled = false
    element.textContent = value
    element.setAttribute('contenteditable', 'false')
    element.tabIndex = -1
    if (restoreTokenFocus) token.focus()
    restoreTokenFocus = false
  }

  const begin = () => {
    if (!enabled || disposed || editing) return
    editing = true
    cancelled = false
    element.setAttribute('contenteditable', 'plaintext-only')
    element.tabIndex = 0
    element.focus()
  }

  const onDoubleClick = (event: MouseEvent) => {
    if (!enabled) return
    event.preventDefault()
    event.stopPropagation()
    begin()
  }
  const onBlur = () => finish()
  const onPointerDown = (event: PointerEvent) => {
    if (editing) event.stopPropagation()
  }
  const onClick = (event: MouseEvent) => {
    if (editing) event.stopPropagation()
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (!editing) return
    event.stopPropagation()
    if (event.key === 'Enter') {
      event.preventDefault()
      restoreTokenFocus = true
      element.blur()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      cancelled = true
      element.textContent = value
      restoreTokenFocus = true
      element.blur()
    }
  }

  element.addEventListener('dblclick', onDoubleClick)
  element.addEventListener('blur', onBlur)
  element.addEventListener('pointerdown', onPointerDown)
  element.addEventListener('click', onClick)
  element.addEventListener('keydown', onKeyDown)

  return {
    begin,
    update(nextValue, nextEnabled) {
      if (disposed) return
      value = nextValue
      enabled = nextEnabled
      element.setAttribute('aria-disabled', String(!enabled))
      if (!enabled && editing) {
        cancelled = true
        element.textContent = value
        element.blur()
      } else if (!editing) {
        element.textContent = value
        element.setAttribute('contenteditable', 'false')
        element.tabIndex = -1
      }
    },
    dispose() {
      if (disposed) return
      if (editing) {
        cancelled = true
        element.blur()
      }
      disposed = true
      element.removeEventListener('dblclick', onDoubleClick)
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

function mountOrderFace(context: ModFaceMountContext<'order'>) {
  const face = element('div', 'mod-face mod-face--order', context.root)
  let bindings: OrderTokenBinding[] = []
  let sourceMod: Mod<'order'> | null = null
  let current: Mod<'order'> | null = null
  let interactive = false
  let renderedStructure = ''
  let activeDrag: OrderDragSession | null = null
  let listElement: HTMLElement | null = null
  let disposed = false

  const bindingForIndex = (itemIndex: number) => (
    bindings.find((binding) => binding.itemIndex === itemIndex)
  )

  const paintRanks = () => {
    if (!current) return
    const rendered = current
    bindings.forEach((binding) => {
      const item = rendered.state.items[binding.itemIndex]
      if (!item || item.id !== binding.itemId) return
      const rank = rendered.state.perm.indexOf(binding.itemIndex)
      binding.token.classList.toggle('is-top', rank === 0)
      binding.token.setAttribute('aria-label', `${item.label}, rank ${rank + 1} of ${rendered.state.perm.length}`)
      binding.token.setAttribute('aria-posinset', String(rank + 1))
      binding.token.setAttribute('aria-setsize', String(rendered.state.perm.length))
    })
  }

  const paint = () => {
    if (!current) return
    const rendered = current
    listElement?.setAttribute('aria-label', `${rendered.title} ranking`)
    bindings.forEach((binding) => {
      const item = rendered.state.items[binding.itemIndex]
      if (!item || item.id !== binding.itemId) return
      binding.token.setAttribute('aria-disabled', String(!interactive))
      binding.token.tabIndex = interactive ? 0 : -1
      binding.label.update(item.label, interactive)
      binding.remove?.setAttribute('aria-label', `Remove ${item.label}`)
    })
    paintRanks()
  }

  const clearTransforms = () => {
    bindings.forEach(({ token }) => token.style.removeProperty('--e-mod-face-order-shift'))
  }

  const commitLocal = (
    next: Mod<'order'>,
    label: string,
    structural = false,
    focusItemId?: string,
  ): boolean => {
    if (!context.commit(next, label)) return false
    sourceMod = cloneDetached(next)
    current = cloneDetached(next)
    if (structural) rebuild()
    else paint()
    if (focusItemId) bindings.find(({ itemId }) => itemId === focusItemId)?.token.focus()
    return true
  }

  const finishDrag = (session: OrderDragSession) => {
    if (session.finished) return
    session.finished = true
    if (activeDrag === session) activeDrag = null
    bindingForIndex(session.itemIndex)?.token.classList.remove('is-lift')
    clearTransforms()
    session.releaseGesture()
  }

  const cancelDrag = (session: OrderDragSession, _reason: PointerGestureCancelReason) => {
    try {
      current = cloneDetached(session.baseline)
    } finally {
      finishDrag(session)
      paint()
    }
  }

  const applyPointer = (session: OrderDragSession, event: PointerEvent) => {
    if (!current) return
    const dy = event.clientY - session.startY
    const dragged = bindingForIndex(session.itemIndex)
    const draggedRect = session.rects[session.homeRank]
    if (!dragged || !draggedRect || draggedRect.height <= 0) return
    dragged.token.style.setProperty('--e-mod-face-order-shift', shiftValue(dy / draggedRect.height))

    const destination = clamp(
      session.homeRank + Math.round(dy / session.pitch),
      0,
      session.pickupOrder.length - 1,
    )
    const currentRank = current.state.perm.indexOf(session.itemIndex)
    if (destination !== currentRank) {
      current.state.perm.splice(currentRank, 1)
      current.state.perm.splice(destination, 0, session.itemIndex)
      paintRanks()
    }

    session.pickupOrder.forEach((itemIndex, originalRank) => {
      if (itemIndex === session.itemIndex) return
      const binding = bindingForIndex(itemIndex)
      const rect = session.rects[originalRank]
      if (!binding || !rect || rect.height <= 0) return
      const rank = current!.state.perm.indexOf(itemIndex)
      const shift = (rank - originalRank) * session.pitch / rect.height
      binding.token.style.setProperty('--e-mod-face-order-shift', shiftValue(shift))
    })
  }

  const onKeyboard = (event: KeyboardEvent, itemIndex: number) => {
    if (!interactive || !current) return
    const rank = current.state.perm.indexOf(itemIndex)
    if (rank < 0) return
    let destination: number | undefined
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      destination = Math.max(0, rank - 1)
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      destination = Math.min(current.state.perm.length - 1, rank + 1)
    } else if (event.key === 'Home') {
      destination = 0
    } else if (event.key === 'End') {
      destination = current.state.perm.length - 1
    }
    if (destination === undefined) return
    event.preventDefault()
    event.stopPropagation()
    if (destination === rank) return

    const next = cloneDetached(current)
    next.state.perm.splice(rank, 1)
    next.state.perm.splice(destination, 0, itemIndex)
    if (!context.commit(next, 'Reorder priorities')) return
    sourceMod = cloneDetached(next)
    current = cloneDetached(next)
    rebuild()
    bindingForIndex(itemIndex)?.token.focus()
  }

  const disposeBindings = () => {
    bindings.forEach(({ pointer, label }) => {
      pointer.dispose()
      label.dispose()
    })
    bindings = []
  }

  function rebuild() {
    if (!current || disposed) return
    disposeBindings()
    face.replaceChildren()
    const row = element('div', 'mod-row', face)
    const well = element('div', 'i-order', row)
    const numbers = element('div', 'i-order-nums', well)
    numbers.setAttribute('aria-hidden', 'true')
    const list = element('div', 'i-order-list', well)
    listElement = list
    list.setAttribute('role', 'list')

    current.state.perm.forEach((itemIndex, rank) => {
      const item = current!.state.items[itemIndex]
      if (!item) return
      element('div', 'i-order-num t-value', numbers, String(rank + 1))
      const token = element('div', 'i-order-token t-label', list)
      token.setAttribute('role', 'listitem')
      token.setAttribute('aria-roledescription', 'sortable item')
      token.dataset.modPartId = item.id
      const name = element('span', 'tk-name', token, item.label)
      const label = mountOrderInlineEdit(name, token, {
        ariaLabel: 'Priority name',
        commit: (nextLabel) => {
          if (!current) return false
          const next = cloneDetached(current)
          const nextItem = next.state.items[itemIndex]
          if (!nextItem) return false
          nextItem.label = nextLabel.toUpperCase()
          if (!context.commit(next, 'Rename priority')) return false
          sourceMod = cloneDetached(next)
          current = cloneDetached(next)
          paint()
          return true
        },
      })
      let remove: HTMLButtonElement | null = null
      if (current!.state.items.length > MOD_PART_BOUNDS.order.min) {
        remove = element('button', 'row-x', token, '×')
        remove.type = 'button'
        remove.setAttribute('aria-label', `Remove ${item.label}`)
        remove.addEventListener('pointerdown', (event) => claimDiscretePointer(event, interactive))
        remove.addEventListener('keydown', (event) => claimDiscreteKey(event, interactive))
        remove.addEventListener('click', (event) => {
          if (!interactive || !current) return
          event.preventDefault()
          event.stopPropagation()
          const next = cloneDetached(current)
          if (next.state.items.length <= MOD_PART_BOUNDS.order.min) return
          const removedRank = next.state.perm.indexOf(itemIndex)
          next.state.items.splice(itemIndex, 1)
          next.state.perm = next.state.perm
            .filter((candidate) => candidate !== itemIndex)
            .map((candidate) => candidate > itemIndex ? candidate - 1 : candidate)
          const focusIndex = next.state.perm[Math.min(removedRank, next.state.perm.length - 1)]
          commitLocal(next, 'Remove priority', true, next.state.items[focusIndex]?.id)
        })
      }
      token.addEventListener('keydown', (event) => {
        if (event.target !== token) return
        if (interactive && (event.key === 'Enter' || event.key === 'F2')) {
          event.preventDefault()
          event.stopPropagation()
          label.begin()
          return
        }
        onKeyboard(event, itemIndex)
      })

      const pointer = mountPointerGesture(token, {
        scheduler: context.animationFrames,
        isEnabled: () => interactive && activeDrag === null,
        start: (event) => {
          if (!current) return null
          const homeRank = current.state.perm.indexOf(itemIndex)
          if (homeRank < 0) return null
          const rects = bindings.map(({ token: candidate }) => {
            const rect = candidate.getBoundingClientRect()
            return { top: rect.top, height: rect.height }
          })
          const own = rects[homeRank]
          const adjacent = rects[homeRank + 1] ?? rects[homeRank - 1]
          const pitch = adjacent
            ? Math.abs(adjacent.top - own.top)
            : Number.NaN
          if (!own || !Number.isFinite(own.top) || !Number.isFinite(own.height) || own.height <= 0) return null
          if (!Number.isFinite(pitch) || pitch <= 0) return null
          const session: OrderDragSession = {
            itemIndex,
            homeRank,
            pickupOrder: current.state.perm.slice(),
            rects,
            pitch,
            startY: event.clientY,
            baseline: cloneDetached(current),
            releaseGesture: context.beginGesture(),
            finished: false,
          }
          activeDrag = session
          token.classList.add('is-lift')
          return session
        },
        frame: applyPointer,
        complete: (session) => {
          let rebuildAfter = false
          try {
            if (!current || orderEqual(current.state.perm, session.baseline.state.perm)) return
            const next = cloneDetached(current)
            if (!context.commit(next, 'Reorder priorities')) current = cloneDetached(session.baseline)
            else sourceMod = cloneDetached(next)
            rebuildAfter = true
          } finally {
            finishDrag(session)
            if (rebuildAfter) rebuild()
            else paint()
          }
        },
        cancel: cancelDrag,
      })

      bindings.push({ itemIndex, itemId: item.id, token, label, remove, pointer })
    })

    renderedStructure = structureKey(current)
    paint()
  }

  return {
    update(state: ModFaceRenderState<'order'>) {
      if (disposed) return
      const incoming = cloneDetached(state.mod) as Mod<'order'>
      face.style.setProperty('--e-mod-face-on-accent', resolveCardIdentity(incoming.accent).onSolid)
      const sourceChanged = sourceMod === null
        || JSON.stringify(sourceMod) !== JSON.stringify(incoming)

      if (activeDrag && (!state.interactive || sourceChanged)) {
        bindingForIndex(activeDrag.itemIndex)?.pointer.cancel('disabled')
      }
      interactive = state.interactive
      if (!activeDrag || sourceChanged) {
        sourceMod = cloneDetached(incoming)
        current = cloneDetached(incoming)
      }

      if (!current) return
      if (activeDrag) paint()
      else if (renderedStructure !== structureKey(current)) rebuild()
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

export const orderFaceDefinition: ModFaceDefinition<'order'> = {
  kind: 'order',
  mount: mountOrderFace,
}
