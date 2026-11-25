import { MOD_PART_BOUNDS, normalizeMixerShares } from '../growth'
import type { Mod } from '../model'
import { cloneDetached } from '../snapshot'
import { mountInlineEdit, type InlineEditController } from './inlineEdit'
import {
  mountPointerGesture,
  type PointerGestureCancelReason,
  type PointerGestureController,
} from './pointerGesture'
import type { ModFaceDefinition, ModFaceMountContext, ModFaceRenderState } from './types'

const MIXER_MIN_SHARE = 3

type MixerBandBinding = {
  itemId: string
  band: HTMLElement
  share: HTMLElement
  label: InlineEditController
  grip?: HTMLElement
  pointer?: PointerGestureController
}

type MixerDragSession = {
  upperId: string
  lowerId: string
  wellHeight: number
  startY: number
  upperStart: number
  lowerStart: number
  baseline: Mod<'mixer'>
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

function structureKey(mod: Mod<'mixer'>): string {
  return mod.state.items.map(({ id }) => id).join(':')
}

function claimDiscretePointer(event: PointerEvent, enabled: boolean): void {
  if (enabled) event.stopPropagation()
}

function roundedShare(value: number): string {
  return `${Math.round(value)}%`
}

function mountMixerFace(context: ModFaceMountContext<'mixer'>) {
  const face = element('div', 'mod-face mod-face--mixer', context.root)
  const row = element('div', 'mod-row mod-row--mixer', face)
  const well = element('div', 'i-bd', row)
  const bindings = new Map<string, MixerBandBinding>()
  let sourceMod: Mod<'mixer'> | null = null
  let current: Mod<'mixer'> | null = null
  let interactive = false
  let renderedStructure = ''
  let activeDrag: MixerDragSession | null = null
  let renderedWellHeight = 0
  let resizeObserver: ResizeObserver | null = null
  let disposed = false

  const item = (itemId: string) => current?.state.items.find((candidate) => candidate.id === itemId)

  const measureWell = (): Pick<DOMRect, 'height'> | null => {
    const rect = well.getBoundingClientRect()
    if (!Number.isFinite(rect.height) || rect.height <= 0) return null
    renderedWellHeight = rect.height
    return { height: rect.height }
  }

  const paint = () => {
    if (!current) return
    const rank = current.state.items
      .map((candidate, index) => ({ id: candidate.id, value: candidate.v, index }))
      .sort((left, right) => right.value - left.value || left.index - right.index)
    for (const [index, candidate] of current.state.items.entries()) {
      const binding = bindings.get(candidate.id)
      if (!binding) continue
      const rankIndex = rank.findIndex(({ id }) => id === candidate.id)
      const strength = current.state.items.length > 1
        ? 60 - rankIndex * (30 / (current.state.items.length - 1))
        : 60
      binding.band.style.setProperty('--e-mod-mixer-share', candidate.v.toFixed(6))
      binding.band.style.setProperty('--e-mod-mixer-strength', `${Math.round(strength)}%`)
      binding.share.textContent = roundedShare(candidate.v)
      binding.label.update(candidate.label, interactive)
      binding.band.classList.toggle(
        'is-thin',
        renderedWellHeight > 0 && candidate.v / 100 * renderedWellHeight < 20,
      )

      const next = current.state.items[index + 1]
      if (!binding.grip || !next) continue
      const pairTotal = candidate.v + next.v
      binding.grip.tabIndex = interactive ? 0 : -1
      binding.grip.setAttribute('aria-disabled', String(!interactive))
      binding.grip.setAttribute('aria-label', `Seam between ${candidate.label} and ${next.label}`)
      binding.grip.setAttribute('aria-valuemin', String(MIXER_MIN_SHARE))
      binding.grip.setAttribute('aria-valuemax', String(pairTotal - MIXER_MIN_SHARE))
      binding.grip.setAttribute('aria-valuenow', String(Number(candidate.v.toFixed(2))))
      binding.grip.setAttribute(
        'aria-valuetext',
        `${roundedShare(candidate.v)} ${candidate.label.toLowerCase()}, ${roundedShare(next.v)} ${next.label.toLowerCase()}`,
      )
    }
  }

  const finishDrag = (session: MixerDragSession) => {
    if (session.finished) return
    session.finished = true
    if (activeDrag === session) activeDrag = null
    well.classList.remove('is-dragging')
    session.releaseGesture()
  }

  const cancelDrag = (session: MixerDragSession, _reason: PointerGestureCancelReason) => {
    try {
      current = cloneDetached(session.baseline)
      paint()
    } finally {
      finishDrag(session)
    }
  }

  const commitLocal = (next: Mod<'mixer'>, label: string, structural = false): boolean => {
    if (!context.commit(next, label)) return false
    sourceMod = cloneDetached(next)
    current = cloneDetached(next)
    if (structural) rebuild()
    else paint()
    return true
  }

  const applyPointer = (session: MixerDragSession, event: PointerEvent) => {
    if (!current || session.wellHeight <= 0) return
    const upper = item(session.upperId)
    const lower = item(session.lowerId)
    if (!upper || !lower) return
    const pairTotal = session.upperStart + session.lowerStart
    const delta = (event.clientY - session.startY) / session.wellHeight * 100
    upper.v = Math.min(
      pairTotal - MIXER_MIN_SHARE,
      Math.max(MIXER_MIN_SHARE, session.upperStart + delta),
    )
    lower.v = pairTotal - upper.v
    paint()
  }

  const adjustSeam = (event: KeyboardEvent, upperId: string, lowerId: string) => {
    if (!interactive || !current) return
    event.stopPropagation()
    const upper = item(upperId)
    const lower = item(lowerId)
    if (!upper || !lower) return
    const pairTotal = upper.v + lower.v
    const amount = event.shiftKey ? 5 : 1
    let nextUpper: number | undefined
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') nextUpper = upper.v - amount
    else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') nextUpper = upper.v + amount
    else if (event.key === 'Home') nextUpper = MIXER_MIN_SHARE
    else if (event.key === 'End') nextUpper = pairTotal - MIXER_MIN_SHARE
    if (nextUpper === undefined) return
    event.preventDefault()
    nextUpper = Math.min(pairTotal - MIXER_MIN_SHARE, Math.max(MIXER_MIN_SHARE, nextUpper))
    if (nextUpper === upper.v) return
    const next = cloneDetached(current)
    const nextUpperItem = next.state.items.find(({ id }) => id === upperId)
    const nextLowerItem = next.state.items.find(({ id }) => id === lowerId)
    if (!nextUpperItem || !nextLowerItem) return
    nextUpperItem.v = nextUpper
    nextLowerItem.v = pairTotal - nextUpper
    commitLocal(next, 'Adjust mixer')
  }

  const disposeBindings = () => {
    for (const binding of bindings.values()) {
      binding.pointer?.dispose()
      binding.label.dispose()
    }
    bindings.clear()
  }

  const addBand = (mod: Mod<'mixer'>, mixerItem: Mod<'mixer'>['state']['items'][number], index: number) => {
    const band = element('div', 'bd-band', well)
    band.dataset.modPartId = mixerItem.id
    const labelElement = element('span', 'mod-sub t-micro bd-lbl', band)
    const label = mountInlineEdit(labelElement, {
      ariaLabel: 'Mixer channel name',
      commit: (nextLabel) => {
        if (!current) return false
        const next = cloneDetached(current)
        const nextItem = next.state.items.find(({ id }) => id === mixerItem.id)
        if (!nextItem) return false
        nextItem.label = nextLabel.toUpperCase()
        return commitLocal(next, 'Rename mixer channel')
      },
    })
    const right = element('span', 'bd-right', band)
    const share = element('span', 'bd-share t-value', right)
    share.setAttribute('aria-hidden', 'true')

    if (mod.state.items.length > MOD_PART_BOUNDS.mixer.min) {
      band.classList.add('has-x')
      const remove = element('button', 'row-x', band, '×')
      remove.type = 'button'
      remove.setAttribute('aria-label', `Remove ${mixerItem.label}`)
      remove.addEventListener('pointerdown', (event) => claimDiscretePointer(event, interactive))
      remove.addEventListener('click', (event) => {
        if (!interactive || !current) return
        event.preventDefault()
        event.stopPropagation()
        const next = cloneDetached(current)
        const removeIndex = next.state.items.findIndex(({ id }) => id === mixerItem.id)
        if (removeIndex < 0 || next.state.items.length <= MOD_PART_BOUNDS.mixer.min) return
        next.state.items.splice(removeIndex, 1)
        normalizeMixerShares(next)
        commitLocal(next, 'Remove mixer channel', true)
      })
    }

    const next = mod.state.items[index + 1]
    if (!next) {
      bindings.set(mixerItem.id, { itemId: mixerItem.id, band, share, label })
      return
    }

    const grip = element('div', 'bd-grip', band)
    grip.setAttribute('role', 'slider')
    grip.setAttribute('aria-orientation', 'vertical')
    grip.addEventListener('keydown', (event) => adjustSeam(event, mixerItem.id, next.id))
    grip.addEventListener('click', (event) => {
      if (interactive) event.stopPropagation()
    })
    const pointer = mountPointerGesture(grip, {
      scheduler: context.animationFrames,
      isEnabled: () => interactive && activeDrag === null,
      start: (event) => {
        if (!current) return null
        const geometry = measureWell()
        const upper = item(mixerItem.id)
        const lower = item(next.id)
        if (!geometry || !upper || !lower) return null
        const session: MixerDragSession = {
          upperId: mixerItem.id,
          lowerId: next.id,
          wellHeight: geometry.height,
          startY: event.clientY,
          upperStart: upper.v,
          lowerStart: lower.v,
          baseline: cloneDetached(current),
          releaseGesture: context.beginGesture(),
          finished: false,
        }
        activeDrag = session
        well.classList.add('is-dragging')
        paint()
        return session
      },
      frame: applyPointer,
      complete: (session) => {
        try {
          if (!current) return
          const before = session.baseline.state.items.map(({ v }) => v)
          const after = current.state.items.map(({ v }) => v)
          if (before.some((value, itemIndex) => value !== after[itemIndex])) {
            const nextMod = cloneDetached(current)
            if (!context.commit(nextMod, 'Adjust mixer')) current = cloneDetached(session.baseline)
            else sourceMod = cloneDetached(nextMod)
          }
          paint()
        } finally {
          finishDrag(session)
        }
      },
      cancel: cancelDrag,
    })

    bindings.set(mixerItem.id, {
      itemId: mixerItem.id,
      band,
      share,
      label,
      grip,
      pointer,
    })
  }

  function rebuild() {
    if (!current || disposed) return
    disposeBindings()
    well.replaceChildren()
    current.state.items.forEach((mixerItem, index) => addBand(current!, mixerItem, index))
    renderedStructure = structureKey(current)
    measureWell()
    paint()
  }

  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      if (disposed || activeDrag) return
      measureWell()
      paint()
    })
    resizeObserver.observe(well)
  }

  return {
    update(state: ModFaceRenderState<'mixer'>) {
      if (disposed) return
      const incoming = cloneDetached(state.mod) as Mod<'mixer'>
      const sourceChanged = sourceMod === null || JSON.stringify(sourceMod) !== JSON.stringify(incoming)
      if (activeDrag && (!state.interactive || sourceChanged)) {
        for (const binding of bindings.values()) binding.pointer?.cancel('disabled')
      }
      interactive = state.interactive
      if (!activeDrag || sourceChanged) {
        sourceMod = cloneDetached(incoming)
        current = cloneDetached(incoming)
      }
      if (!current) return
      if (renderedStructure !== structureKey(current)) rebuild()
      else {
        if (!activeDrag) measureWell()
        paint()
      }
    },
    dispose() {
      if (disposed) return
      resizeObserver?.disconnect()
      resizeObserver = null
      disposeBindings()
      disposed = true
      activeDrag = null
      face.remove()
    },
  }
}

export const mixerFaceDefinition: ModFaceDefinition<'mixer'> = {
  kind: 'mixer',
  mount: mountMixerFace,
}
