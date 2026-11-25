import { growMod, MOD_PART_BOUNDS, stepMatrixCell } from '../growth'
import type { Mod } from '../model'
import { readModContext } from '../prompt'
import { cloneDetached } from '../snapshot'
import { mountInlineEdit, type InlineEditController } from './inlineEdit'
import type { ModFaceDefinition, ModFaceMountContext, ModFaceRenderState } from './types'

type MatrixCellBinding = {
  rowId: string
  columnId: string
  cell: HTMLButtonElement
  dot: HTMLElement
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

function structureKey(mod: Mod<'matrix'>): string {
  return `${mod.state.rows.map(({ id }) => id).join(':')}|${mod.state.cols.map(({ id }) => id).join(':')}`
}

function matrixWord(mod: Mod<'matrix'>, value: number): string {
  const named = mod.state.stepNames[value]
  if (named) return named.toLowerCase()
  if (value < 1) return 'none'
  return `${Math.round(value / (mod.state.steps - 1) * 100)}%`
}

function claimDiscretePointer(event: PointerEvent, enabled: boolean): void {
  if (enabled) event.stopPropagation()
}

function mountMatrixFace(context: ModFaceMountContext<'matrix'>) {
  const face = element('div', 'mod-face mod-face--matrix', context.root)
  const rowLabels = new Map<string, InlineEditController>()
  const columnLabels = new Map<string, InlineEditController>()
  let current: Mod<'matrix'> | null = null
  let interactive = false
  let renderedStructure = ''
  let wrap: HTMLElement | null = null
  let grid: HTMLElement | null = null
  let summary: HTMLElement | null = null
  let cells: MatrixCellBinding[] = []
  let resizeObserver: ResizeObserver | null = null
  let placementFrame: number | null = null
  let disposed = false

  const cancelPlacement = () => {
    if (placementFrame === null) return
    context.animationFrames.cancel(placementFrame)
    placementFrame = null
  }

  const place = () => {
    placementFrame = null
    if (!wrap || !grid || cells.length === 0 || disposed) return
    const wrapRect = wrap.getBoundingClientRect()
    const firstRect = cells[0].cell.getBoundingClientRect()
    const lastRect = cells[cells.length - 1].cell.getBoundingClientRect()
    if (
      !Number.isFinite(wrapRect.width)
      || !Number.isFinite(wrapRect.height)
      || wrapRect.width <= 0
      || wrapRect.height <= 0
      || firstRect.width <= 0
      || firstRect.height <= 0
    ) return

    const percent = (value: number, total: number) => `${(value / total * 100).toFixed(4)}%`
    wrap.style.setProperty('--e-mod-matrix-left', percent(firstRect.left - wrapRect.left, wrapRect.width))
    wrap.style.setProperty('--e-mod-matrix-top', percent(firstRect.top - wrapRect.top, wrapRect.height))
    wrap.style.setProperty('--e-mod-matrix-width', percent(lastRect.right - firstRect.left, wrapRect.width))
    wrap.style.setProperty('--e-mod-matrix-height', percent(lastRect.bottom - firstRect.top, wrapRect.height))
  }

  const schedulePlace = () => {
    if (disposed || placementFrame !== null) return
    placementFrame = context.animationFrames.request(place)
  }

  const cellIndexes = (binding: MatrixCellBinding): { row: number; column: number } | null => {
    if (!current) return null
    const row = current.state.rows.findIndex(({ id }) => id === binding.rowId)
    const column = current.state.cols.findIndex(({ id }) => id === binding.columnId)
    return row < 0 || column < 0 ? null : { row, column }
  }

  const paint = () => {
    if (!current) return
    for (const row of current.state.rows) rowLabels.get(row.id)?.update(row.label, interactive)
    for (const column of current.state.cols) columnLabels.get(column.id)?.update(column.label, interactive)
    for (const binding of cells) {
      const indexes = cellIndexes(binding)
      if (!indexes) continue
      const row = current.state.rows[indexes.row]
      const column = current.state.cols[indexes.column]
      const value = current.state.cells[indexes.row][indexes.column]
      const word = matrixWord(current, value)
      const ratio = value < 1 ? 0 : value / (current.state.steps - 1)
      binding.dot.style.setProperty('--e-mod-matrix-scale', ratio.toFixed(4))
      binding.dot.classList.toggle('is-empty', value < 1)
      binding.cell.disabled = !interactive
      binding.cell.setAttribute('aria-disabled', String(!interactive))
      binding.cell.setAttribute('aria-label', `${row.label} on ${column.label}: ${word}`)
      binding.cell.setAttribute('aria-valuetext', word)
      binding.cell.dataset.matrixValue = String(value)
      binding.cell.title = `${row.label} on ${column.label}: ${word}`
    }
    if (grid) grid.setAttribute('aria-label', `${current.title} matrix`)
    if (summary) summary.textContent = readModContext(current).sentences.map(({ text }) => text).join(' ')
    schedulePlace()
  }

  const commitLocal = (next: Mod<'matrix'>, label: string, structural = false): boolean => {
    if (!context.commit(next, label)) return false
    current = cloneDetached(next)
    if (structural) rebuild()
    else paint()
    return true
  }

  const setCell = (
    binding: MatrixCellBinding,
    direction: 'forward' | 'backward' | 'first' | 'last',
  ) => {
    if (!interactive || !current) return
    const indexes = cellIndexes(binding)
    if (!indexes) return
    const next = cloneDetached(current)
    const before = next.state.cells[indexes.row][indexes.column]
    let after: number
    if (direction === 'forward') after = stepMatrixCell(next, indexes.row, indexes.column)
    else if (direction === 'backward') {
      after = (before - 1 + next.state.steps) % next.state.steps
      next.state.cells[indexes.row][indexes.column] = after
    } else {
      after = direction === 'first' ? 0 : next.state.steps - 1
      next.state.cells[indexes.row][indexes.column] = after
    }
    if (after === before) return
    commitLocal(next, 'Step matrix cell')
  }

  const disposeStructure = () => {
    cancelPlacement()
    resizeObserver?.disconnect()
    resizeObserver = null
    for (const label of rowLabels.values()) label.dispose()
    for (const label of columnLabels.values()) label.dispose()
    rowLabels.clear()
    columnLabels.clear()
    cells = []
  }

  const addRemoveButton = (
    parent: HTMLElement,
    ariaLabel: string,
    remove: () => void,
  ) => {
    const button = element('button', 'row-x', parent, '×')
    button.type = 'button'
    button.setAttribute('aria-label', ariaLabel)
    button.addEventListener('pointerdown', (event) => claimDiscretePointer(event, interactive))
    button.addEventListener('keydown', (event) => {
      if (interactive) event.stopPropagation()
    })
    button.addEventListener('click', (event) => {
      if (!interactive) return
      event.preventDefault()
      event.stopPropagation()
      remove()
    })
  }

  function rebuild() {
    if (!current || disposed) return
    disposeStructure()
    face.replaceChildren()
    wrap = element('div', 'i-mx-wrap', face)
    grid = element('div', 'i-mx-grid', wrap)
    grid.setAttribute('role', 'group')
    grid.style.gridTemplateColumns = `minmax(52px, auto) repeat(${current.state.cols.length}, 44px)`
    grid.style.gridTemplateRows = `auto repeat(${current.state.rows.length}, 44px)`
    element('div', 'mx-corner', grid)

    for (const column of current.state.cols) {
      const columnLabel = element('div', 'mx-lbl mx-lbl--col', grid)
      const text = element('span', 'mod-sub t-micro', columnLabel)
      columnLabels.set(column.id, mountInlineEdit(text, {
        ariaLabel: 'Matrix column name',
        commit: (nextLabel) => {
          if (!current) return false
          const next = cloneDetached(current)
          const nextColumn = next.state.cols.find(({ id }) => id === column.id)
          if (!nextColumn) return false
          nextColumn.label = nextLabel.toUpperCase()
          return commitLocal(next, 'Rename matrix column')
        },
      }))
      if (current.state.cols.length > MOD_PART_BOUNDS.matrix.min) {
        addRemoveButton(columnLabel, `Remove ${column.label} column`, () => {
          if (!current) return
          const next = cloneDetached(current)
          const index = next.state.cols.findIndex(({ id }) => id === column.id)
          if (index < 0 || next.state.cols.length <= MOD_PART_BOUNDS.matrix.min) return
          next.state.cols.splice(index, 1)
          next.state.cells.forEach((row) => row.splice(index, 1))
          commitLocal(next, 'Remove matrix column', true)
        })
      }
    }

    for (const [rowIndex, row] of current.state.rows.entries()) {
      const rowLabel = element('div', 'mx-lbl mx-lbl--row', grid)
      if (current.state.rows.length > MOD_PART_BOUNDS.matrix.min) {
        addRemoveButton(rowLabel, `Remove ${row.label} row`, () => {
          if (!current) return
          const next = cloneDetached(current)
          const index = next.state.rows.findIndex(({ id }) => id === row.id)
          if (index < 0 || next.state.rows.length <= MOD_PART_BOUNDS.matrix.min) return
          next.state.rows.splice(index, 1)
          next.state.cells.splice(index, 1)
          commitLocal(next, 'Remove matrix row', true)
        })
      }
      const text = element('span', 'mod-sub t-micro', rowLabel)
      rowLabels.set(row.id, mountInlineEdit(text, {
        ariaLabel: 'Matrix row name',
        commit: (nextLabel) => {
          if (!current) return false
          const next = cloneDetached(current)
          const nextRow = next.state.rows.find(({ id }) => id === row.id)
          if (!nextRow) return false
          nextRow.label = nextLabel.toUpperCase()
          return commitLocal(next, 'Rename matrix row')
        },
      }))

      for (const [columnIndex, column] of current.state.cols.entries()) {
        const cell = element(
          'button',
          `mx-cell${columnIndex === current.state.cols.length - 1 ? ' eR' : ''}${rowIndex === current.state.rows.length - 1 ? ' eB' : ''}`,
          grid,
        )
        cell.type = 'button'
        const dot = element('span', 'mx-dot', cell)
        dot.setAttribute('aria-hidden', 'true')
        const binding: MatrixCellBinding = { rowId: row.id, columnId: column.id, cell, dot }
        cell.addEventListener('pointerdown', (event) => claimDiscretePointer(event, interactive))
        cell.addEventListener('click', (event) => {
          if (!interactive) return
          event.preventDefault()
          event.stopPropagation()
          setCell(binding, 'forward')
        })
        cell.addEventListener('keydown', (event) => {
          if (!interactive) return
          event.stopPropagation()
          let direction: 'forward' | 'backward' | 'first' | 'last' | null = null
          if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowRight' || event.key === 'ArrowUp') {
            direction = 'forward'
          } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') direction = 'backward'
          else if (event.key === 'Home') direction = 'first'
          else if (event.key === 'End') direction = 'last'
          if (!direction) return
          event.preventDefault()
          setCell(binding, direction)
        })
        cells.push(binding)
      }
    }

    element('div', 'mx-frame', wrap).setAttribute('aria-hidden', 'true')
    if (current.state.rows.length < MOD_PART_BOUNDS.matrix.max) {
      const addRow = element('button', 'mx-ghost mx-ghost--row', wrap, '+')
      addRow.type = 'button'
      addRow.setAttribute('aria-label', 'Add a matrix row')
      addRow.addEventListener('pointerdown', (event) => claimDiscretePointer(event, interactive))
      addRow.addEventListener('keydown', (event) => {
        if (interactive) event.stopPropagation()
      })
      addRow.addEventListener('click', (event) => {
        if (!interactive || !current) return
        event.preventDefault()
        event.stopPropagation()
        const next = cloneDetached(current)
        if (growMod(next, { matrixAxis: 'row' })) commitLocal(next, 'Add matrix row', true)
      })
    }
    if (current.state.cols.length < MOD_PART_BOUNDS.matrix.max) {
      const addColumn = element('button', 'mx-ghost mx-ghost--column', wrap, '+')
      addColumn.type = 'button'
      addColumn.setAttribute('aria-label', 'Add a matrix column')
      addColumn.addEventListener('pointerdown', (event) => claimDiscretePointer(event, interactive))
      addColumn.addEventListener('keydown', (event) => {
        if (interactive) event.stopPropagation()
      })
      addColumn.addEventListener('click', (event) => {
        if (!interactive || !current) return
        event.preventDefault()
        event.stopPropagation()
        const next = cloneDetached(current)
        if (growMod(next, { matrixAxis: 'column' })) commitLocal(next, 'Add matrix column', true)
      })
    }
    summary = element('span', 'mx-summary', wrap)
    summary.setAttribute('aria-live', 'polite')
    summary.setAttribute('aria-atomic', 'true')
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(schedulePlace)
      resizeObserver.observe(wrap)
    }
    renderedStructure = structureKey(current)
    paint()
  }

  return {
    update(state: ModFaceRenderState<'matrix'>) {
      if (disposed) return
      const incoming = cloneDetached(state.mod) as Mod<'matrix'>
      interactive = state.interactive
      current = cloneDetached(incoming)
      if (renderedStructure !== structureKey(current)) rebuild()
      else paint()
    },
    dispose() {
      if (disposed) return
      disposeStructure()
      disposed = true
      wrap = null
      grid = null
      summary = null
      face.remove()
    },
  }
}

export const matrixFaceDefinition: ModFaceDefinition<'matrix'> = {
  kind: 'matrix',
  mount: mountMatrixFace,
}
