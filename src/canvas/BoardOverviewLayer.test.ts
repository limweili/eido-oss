// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Card, Connection } from '../graph/types'
import { createSeedMod } from '../mods'
import {
  CONNECTOR_NODE_METRICS,
  painterPaletteForTheme,
  painterPaletteIdentity,
  type PainterPalette,
} from '../ui/tokens'
import { MAP_BAND_MAX_ZOOM, READING_BAND_MIN_ZOOM, summaryForCard } from './boardScene'
import {
  BoardOverviewLayer,
  createOverviewDrawScheduler,
  createLabelFontRevisionTracker,
  drawOverviewLayer,
  overviewPaintBand,
  paintedRepresentationForBand,
} from './BoardOverviewLayer'
import { labelEllipsisMissesForTests, paintedLabelFrameCap } from './labelLayer'
import { createBoardRenderIndex, renderedCardSize } from './renderPlanning'
import { createBoardResizeHotGeometryStore } from './boardResizeHotGeometry'
import {
  bandCrossfade,
  paintedBadgeRadius,
  paintedConnectionBadgeGeometry,
  paintedPortGeometry,
} from './zoomChrome'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete (document as unknown as Record<string, unknown>).fonts
  delete window.__EIDO_FORCE_OVERVIEW_DRAW__
  delete window.__EIDO_OVERVIEW_CARD_IDS__
})

describe('createOverviewDrawScheduler', () => {
  const paintIdentity = 'light:v1'

  it('coalesces content-only commits into one dirty frame instead of drawing per commit', () => {
    const prePaintDraws: number[] = []
    const scheduler = createOverviewDrawScheduler(() => prePaintDraws.push(prePaintDraws.length))
    scheduler.onPropsCommit(new Set(['a', 'b']), paintIdentity)
    scheduler.consumeDirty() // the mount draw

    // A storm of drag commits within one frame: suppression membership is
    // stable but each scene rebuild hands the layer a fresh Set object.
    for (let commit = 0; commit < 8; commit += 1) {
      scheduler.onPropsCommit(new Set(['a', 'b']), paintIdentity)
    }

    expect(prePaintDraws).toHaveLength(0)
    expect(scheduler.consumeDirty()).toBe(true) // the next frame draws once...
    expect(scheduler.consumeDirty()).toBe(false) // ...and only once
  })

  it('does not draw pre-paint on the first commit after mount', () => {
    const prePaintDraws: number[] = []
    const scheduler = createOverviewDrawScheduler(() => prePaintDraws.push(prePaintDraws.length))

    scheduler.onPropsCommit(new Set(['a']), paintIdentity)

    expect(prePaintDraws).toHaveLength(0)
    expect(scheduler.isDirty()).toBe(true)
  })

  it('draws pre-paint when a card is promoted into the suppression set', () => {
    const prePaintDraws: number[] = []
    const scheduler = createOverviewDrawScheduler(() => prePaintDraws.push(prePaintDraws.length))
    scheduler.onPropsCommit(new Set(['a']), paintIdentity)
    scheduler.consumeDirty()

    scheduler.onPropsCommit(new Set(['a', 'b']), paintIdentity)

    expect(prePaintDraws).toHaveLength(1)
  })

  it('draws pre-paint when suppression lifts so demoted cards reappear without a gap', () => {
    const prePaintDraws: number[] = []
    const scheduler = createOverviewDrawScheduler(() => prePaintDraws.push(prePaintDraws.length))
    scheduler.onPropsCommit(new Set(['a', 'b']), paintIdentity)
    scheduler.consumeDirty()

    scheduler.onPropsCommit(new Set(), paintIdentity)

    expect(prePaintDraws).toHaveLength(1)
  })

  it('treats swapped membership at equal size as a suppression change', () => {
    const prePaintDraws: number[] = []
    const scheduler = createOverviewDrawScheduler(() => prePaintDraws.push(prePaintDraws.length))
    scheduler.onPropsCommit(new Set(['a']), paintIdentity)
    scheduler.consumeDirty()

    scheduler.onPropsCommit(new Set(['b']), paintIdentity)

    expect(prePaintDraws).toHaveLength(1)
  })

  it('draws pre-paint when a synchronized DOM edge hands off to the canvas', () => {
    const prePaintDraws: number[] = []
    const scheduler = createOverviewDrawScheduler(() => prePaintDraws.push(prePaintDraws.length))
    scheduler.onPropsCommit(new Set(['card']), paintIdentity, new Set(['connection']))
    scheduler.consumeDirty()

    scheduler.onPropsCommit(new Set(['card']), paintIdentity, new Set())

    expect(prePaintDraws).toHaveLength(1)
  })

  it('marks dirty for resize without drawing pre-paint', () => {
    const prePaintDraws: number[] = []
    const scheduler = createOverviewDrawScheduler(() => prePaintDraws.push(prePaintDraws.length))
    scheduler.onPropsCommit(new Set(['a']), paintIdentity)
    scheduler.consumeDirty()

    scheduler.markDirty()

    expect(prePaintDraws).toHaveLength(0)
    expect(scheduler.consumeDirty()).toBe(true)
  })

  it('pre-paints exactly once when the paint identity changes', () => {
    const prePaintDraws: number[] = []
    const scheduler = createOverviewDrawScheduler(() => prePaintDraws.push(prePaintDraws.length))
    scheduler.onPropsCommit(new Set(['a']), 'light:v1')
    scheduler.consumeDirty()

    scheduler.onPropsCommit(new Set(['a']), 'dark:v1')

    expect(prePaintDraws).toHaveLength(1)
    expect(scheduler.consumeDirty()).toBe(true)
  })

  it('coalesces simultaneous suppression and paint-identity changes into one pre-paint', () => {
    const prePaintDraws: number[] = []
    const scheduler = createOverviewDrawScheduler(() => prePaintDraws.push(prePaintDraws.length))
    scheduler.onPropsCommit(new Set(['a']), 'light:v1')
    scheduler.consumeDirty()

    scheduler.onPropsCommit(new Set(['a', 'b']), 'dark:v1')

    expect(prePaintDraws).toHaveLength(1)
  })

  it('coalesces commits that keep the same paint identity', () => {
    const prePaintDraws: number[] = []
    const scheduler = createOverviewDrawScheduler(() => prePaintDraws.push(prePaintDraws.length))
    scheduler.onPropsCommit(new Set(['a']), 'light:v1')
    scheduler.consumeDirty()

    scheduler.onPropsCommit(new Set(['a']), 'light:v1')
    scheduler.onPropsCommit(new Set(['a']), 'light:v1')

    expect(prePaintDraws).toHaveLength(0)
    expect(scheduler.consumeDirty()).toBe(true)
    expect(scheduler.consumeDirty()).toBe(false)
  })

  it('derives identity from every nested painter role value, not only the advertised cache key', () => {
    const palette = painterPaletteForTheme('light')
    const nestedRolePaths = [
      ['board', 'fill'],
      ['board', 'gridDot'],
      ...(['note', 'ask', 'result', 'title', 'group', 'mod', 'conversation'] as const).flatMap((role) => [
        ['cards', role, 'fill'],
        ['cards', role, 'stroke'],
      ]),
      ['connections', 'helps'],
      ['connections', 'avoid'],
      ['connections', 'modifies'],
      ['selection'],
      ['hover'],
      ['port', 'fill'],
      ['port', 'stroke'],
      ['badge', 'fill'],
      ['badge', 'stroke'],
      ['label', 'ink'],
      ['label', 'softInk'],
      ['label', 'halo'],
    ] as string[][]

    for (const path of nestedRolePaths) {
      const changed = JSON.parse(JSON.stringify(palette)) as Record<string, unknown>
      let owner = changed
      for (const segment of path.slice(0, -1)) owner = owner[segment] as Record<string, unknown>
      const leaf = path[path.length - 1]
      owner[leaf] = `${String(owner[leaf])}:changed`

      expect((changed as unknown as PainterPalette).cacheKey, path.join('.')).toBe(palette.cacheKey)
      expect(painterPaletteIdentity(changed as unknown as PainterPalette), path.join('.')).not.toBe(
        painterPaletteIdentity(palette),
      )
    }
  })
})

describe('label font revision', () => {
  it('increments the cache revision and dirties the painter as one font-ready transition', () => {
    const markDirty = vi.fn()
    const tracker = createLabelFontRevisionTracker(markDirty)

    expect(tracker.current()).toBe(0)
    tracker.markReady()

    expect(tracker.current()).toBe(1)
    expect(markDirty).toHaveBeenCalledTimes(1)
  })
})

describe('overviewPaintBand', () => {
  it('is a pure function of zoom outside the crossfade windows', () => {
    expect(overviewPaintBand(0.25)).toBe('overview')
    expect(overviewPaintBand(0.1)).toBe('map')
    expect(overviewPaintBand(1)).toBe('reading')
  })

  it('switches at the crossfade curve midpoint with no zoom history', () => {
    // CH3's window spans 0.1275–0.1725 around the 0.15 threshold; the curve's
    // midpoint (t = 0.5, exactly the threshold) is where the representation
    // flips. Same zoom, same band — regardless of how the user got there.
    expect(overviewPaintBand(0.1275)).toBe('map')
    expect(overviewPaintBand(0.14)).toBe('map')
    expect(overviewPaintBand(MAP_BAND_MAX_ZOOM)).toBe('map')
    expect(overviewPaintBand(0.16)).toBe('overview')
    expect(overviewPaintBand(0.1725)).toBe('overview')
  })
})

describe('paintedRepresentationForBand', () => {
  it('maps Map to the pill and every other band to the Overview shape', () => {
    expect(paintedRepresentationForBand('map')).toBe('map')
    expect(paintedRepresentationForBand('overview')).toBe('overview')
    // Reading has no painted representation of its own — DOM cards own it —
    // so a Reading-band frame that still paints uses the Overview shape.
    expect(paintedRepresentationForBand('reading')).toBe('overview')
  })
})

type RecordedOp = {
  op: string
  args: unknown[]
  globalAlpha: number
  fillStyle: string
  strokeStyle: string
  lineWidth: number
  lineDash: number[]
  path: Array<{ op: string; args: unknown[] }>
}

type RecordingContext = CanvasRenderingContext2D & { ops: RecordedOp[] }

function recordingContext(): RecordingContext {
  const ops: RecordedOp[] = []
  const state = { globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1, lineDash: [] as number[] }
  let path: Array<{ op: string; args: unknown[] }> = []
  const pathOps = new Set(['moveTo', 'lineTo', 'quadraticCurveTo', 'bezierCurveTo', 'arc', 'roundRect'])
  const record = (op: string) =>
    function (...args: unknown[]) {
      if (op === 'beginPath') path = []
      else if (pathOps.has(op)) path.push({ op, args })
      ops.push({ op, args, ...state, lineDash: [...state.lineDash], path: path.map((entry) => ({ ...entry })) })
    }
  const context: Record<string, unknown> = { ops }
  for (const op of [
    'save',
    'restore',
    'setTransform',
    'clearRect',
    'beginPath',
    'moveTo',
    'lineTo',
    'quadraticCurveTo',
    'bezierCurveTo',
    'arc',
    'roundRect',
    'fill',
    'stroke',
    'clip',
    'fillRect',
    'fillText',
    'strokeText',
    'drawImage',
  ]) {
    context[op] = record(op)
  }
  context.setLineDash = (...dash: unknown[]) => {
    state.lineDash = [...((dash[0] as number[]) ?? [])]
    record('setLineDash')(...dash)
  }
  context.getLineDash = () => [...state.lineDash]
  context.measureText = (text: string) => ({ width: text.length * 6 })
  for (const key of ['globalAlpha', 'fillStyle', 'strokeStyle', 'lineWidth', 'lineCap', 'lineJoin', 'font', 'textBaseline'] as const) {
    Object.defineProperty(context, key, {
      get: () => state[key as keyof typeof state],
      set: (value) => {
        ;(state as Record<string, unknown>)[key] = value
      },
    })
  }
  return context as unknown as RecordingContext
}

function fakeCanvas(context: RecordingContext): HTMLCanvasElement {
  return {
    width: 0,
    height: 0,
    style: {},
    dataset: {} as DOMStringMap,
    getContext: () => context,
  } as unknown as HTMLCanvasElement
}

function note(id: string, x: number, y: number): Card {
  return {
    id,
    kind: 'note',
    blocks: [{ id: `${id}-block`, text: `Note ${id}` }],
    position: { x, y },
  }
}

function connect(id: string, from: string, to: string, overrides: Partial<Connection> = {}): Connection {
  return {
    id,
    from: { cardId: from },
    to: { cardId: to },
    strength: 'strong',
    polarity: 'helps',
    role: 'feeds',
    ...overrides,
  }
}

function alphaPaint(hex: string, alpha: number): string {
  const value = Number.parseInt(hex.slice(1), 16)
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`
}

type Deferred<T> = {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function installMountedLayerHarness({
  fontLoad,
  cacheBitmaps,
}: {
  fontLoad: ReturnType<typeof vi.fn>
  cacheBitmaps: boolean
}) {
  const mainContext = recordingContext()
  const retainedContext = recordingContext()
  const retainedCanvases: HTMLCanvasElement[] = []
  const bitmapContexts: RecordingContext[] = []
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    if (this.hasAttribute('data-board-overview-layer')) return mainContext
    if (this.hasAttribute('data-board-overview-retained-layer')) {
      if (!retainedCanvases.includes(this)) retainedCanvases.push(this)
      return retainedContext
    }
    if (!cacheBitmaps) return null
    const bitmapContext = recordingContext()
    bitmapContexts.push(bitmapContext)
    return bitmapContext
  } as never)

  let nextFrameId = 1
  const frames = new Map<number, FrameRequestCallback>()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const frameId = nextFrameId
    nextFrameId += 1
    frames.set(frameId, callback)
    return frameId
  })
  vi.stubGlobal('cancelAnimationFrame', (frameId: number) => {
    frames.delete(frameId)
  })
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { load: fontLoad },
  })

  return {
    mainContext,
    retainedContext,
    retainedCanvases,
    bitmapContexts,
    frames,
    flushFrame() {
      const next = frames.entries().next().value as [number, FrameRequestCallback] | undefined
      if (!next) throw new Error('No scheduled overview frame to flush')
      const [frameId, callback] = next
      frames.delete(frameId)
      callback(performance.now())
    },
  }
}

function mountedLayerScene(id: string, includeConnection: boolean) {
  const cards = includeConnection
    ? [note(`${id}-a`, 100, 100), note(`${id}-b`, 600, 100)]
    : [note(`${id}-a`, 100, 100)]
  const connections = includeConnection ? [connect(`${id}-connection`, cards[0].id, cards[1].id)] : []
  return {
    renderIndex: createBoardRenderIndex(cards, connections),
    viewport: { x: 20, y: 20, zoom: 0.25 },
    viewportSize: VIEWPORT_SIZE,
    marginPx: 200,
    renderCards: true,
    renderConnections: true,
    selectedCardIds: new Set<string>(),
    hoveredCardId: null,
    hoveredConnectionId: null,
    reactCardIds: new Set<string>(),
    suppressedCardIds: new Set<string>(),
    measuredCardSizesById: new Map<string, { width: number; height: number }>(),
    readingCardOpacity: 0,
    cardSummariesById: new Map(cards.map((card) => [card.id, summaryForCard(card)])),
  }
}

const VIEWPORT_SIZE = { width: 1200, height: 800 }

function draw({
  cards,
  connections = [],
  connectionCandidateCount = connections.length,
  zoom,
  selectedCardIds = new Set<string>(),
  hoveredCardId = null,
  hoveredConnectionId = null,
  reactCardIds = new Set<string>(),
  suppressedCardIds = new Set<string>(),
  measuredCardSizesById = new Map<string, { width: number; height: number }>(),
  readingCardOpacity = 0,
  cardSummariesById = new Map(),
  paintLabels = true,
  palette = painterPaletteForTheme('light'),
}: {
  cards: Card[]
  connections?: Connection[]
  connectionCandidateCount?: number
  zoom: number
  selectedCardIds?: ReadonlySet<string>
  hoveredCardId?: string | null
  hoveredConnectionId?: string | null
  reactCardIds?: ReadonlySet<string>
  suppressedCardIds?: ReadonlySet<string>
  measuredCardSizesById?: ReadonlyMap<string, { width: number; height: number }>
  readingCardOpacity?: number
  cardSummariesById?: ReadonlyMap<string, ReturnType<typeof summaryForCard>>
  paintLabels?: boolean
  palette?: PainterPalette
}) {
  const context = recordingContext()
  const canvas = fakeCanvas(context)
  drawOverviewLayer({
    canvas,
    renderIndex: createBoardRenderIndex(cards, connections),
    cards,
    connections,
    connectionCandidateCount,
    viewport: { x: 20, y: 20, zoom },
    viewportSize: VIEWPORT_SIZE,
    renderCards: true,
    selectedCardIds,
    hoveredCardId,
    hoveredConnectionId,
    reactCardIds,
    suppressedCardIds,
    measuredCardSizesById,
    readingCardOpacity,
    cardSummariesById,
    paintLabels,
    palette,
  })
  return { context, canvas, dataset: canvas.dataset as Record<string, string> }
}

describe('mounted BoardOverviewLayer paint invalidation', () => {
  it('releases retained DPR planes when a stationary resize aborts', () => {
    const harness = installMountedLayerHarness({
      fontLoad: vi.fn(() => new Promise<FontFace[]>(() => undefined)),
      cacheBitmaps: false,
    })
    const active = { ...note('abort-active', 100, 100), size: { width: 260, height: 180 } }
    const resizeHotGeometryStore = createBoardResizeHotGeometryStore()
    render(createElement(BoardOverviewLayer, {
      ...mountedLayerScene('abort-retained-plane', false),
      renderIndex: createBoardRenderIndex([active], []),
      selectedCardIds: new Set([active.id]),
      cardSummariesById: new Map([[active.id, summaryForCard(active)]]),
      resizeHotGeometryStore,
      theme: 'light' as const,
    }))

    act(() => {
      resizeHotGeometryStore.receive(active.id, {
        type: 'begin',
        sessionId: 1,
        geometry: { position: active.position, size: active.size! },
      })
    })
    const planes = harness.retainedCanvases.slice(-4)
    expect(planes).toHaveLength(4)
    expect(planes.every((plane) => plane.width > 0 && plane.height > 0)).toBe(true)

    act(() => {
      resizeHotGeometryStore.receive(active.id, { type: 'abort', sessionId: 1 })
    })
    expect(planes.every((plane) => plane.width === 0 && plane.height === 0)).toBe(true)
  })

  it('releases every superseded, invalidated, acknowledged, and unmounted retained plan', () => {
    const harness = installMountedLayerHarness({
      fontLoad: vi.fn(() => new Promise<FontFace[]>(() => undefined)),
      cacheBitmaps: false,
    })
    const active = { ...note('lifecycle-active', 100, 100), size: { width: 260, height: 180 } }
    const resizeHotGeometryStore = createBoardResizeHotGeometryStore()
    const props = {
      ...mountedLayerScene('lifecycle-retained-plane', false),
      renderIndex: createBoardRenderIndex([active], []),
      selectedCardIds: new Set([active.id]),
      cardSummariesById: new Map([[active.id, summaryForCard(active)]]),
      resizeHotGeometryStore,
    }
    const view = render(createElement(BoardOverviewLayer, { ...props, theme: 'light' as const }))
    const startGeometry = { position: active.position, size: active.size! }

    act(() => {
      resizeHotGeometryStore.receive(active.id, { type: 'begin', sessionId: 1, geometry: startGeometry })
    })
    const first = harness.retainedCanvases.slice(-4)
    act(() => {
      resizeHotGeometryStore.receive(active.id, { type: 'begin', sessionId: 2, geometry: startGeometry })
    })
    const second = harness.retainedCanvases.slice(-4)
    expect(first.every((plane) => plane.width === 0 && plane.height === 0)).toBe(true)
    expect(second.every((plane) => plane.width > 0 && plane.height > 0)).toBe(true)

    act(() => {
      resizeHotGeometryStore.receive(active.id, {
        type: 'preview',
        sessionId: 2,
        geometry: { position: active.position, size: { width: 300, height: 210 } },
      })
    })
    view.rerender(createElement(BoardOverviewLayer, { ...props, theme: 'dark' as const }))
    const third = harness.retainedCanvases.slice(-4)
    expect(second.every((plane) => plane.width === 0 && plane.height === 0)).toBe(true)
    expect(third.every((plane) => plane.width > 0 && plane.height > 0)).toBe(true)

    act(() => {
      resizeHotGeometryStore.receive(active.id, {
        type: 'commit',
        sessionId: 2,
        geometry: { position: active.position, size: { width: 300, height: 210 } },
      })
      resizeHotGeometryStore.acknowledge(active.id, 2)
    })
    expect(third.every((plane) => plane.width === 0 && plane.height === 0)).toBe(true)

    act(() => {
      resizeHotGeometryStore.receive(active.id, { type: 'begin', sessionId: 3, geometry: startGeometry })
    })
    const fourth = harness.retainedCanvases.slice(-4)
    view.unmount()
    expect(fourth.every((plane) => plane.width === 0 && plane.height === 0)).toBe(true)
  })

  it('composes canonical diagnostics while the hot Card crosses the viewport and after invalidation', () => {
    const harness = installMountedLayerHarness({
      fontLoad: vi.fn(() => new Promise<FontFace[]>(() => undefined)),
      cacheBitmaps: false,
    })
    const active = { ...note('diagnostic-active', 100, 100), size: { width: 260, height: 180 } }
    const cold = { ...note('diagnostic-cold', 700, 100), size: { width: 260, height: 180 } }
    const connection = connect('diagnostic-connection', active.id, cold.id)
    const resizeHotGeometryStore = createBoardResizeHotGeometryStore()
    const props = {
      ...mountedLayerScene('diagnostic-retained-plane', false),
      renderIndex: createBoardRenderIndex([active, cold], [connection]),
      selectedCardIds: new Set([active.id]),
      cardSummariesById: new Map([
        [active.id, summaryForCard(active)],
        [cold.id, summaryForCard(cold)],
      ]),
      resizeHotGeometryStore,
    }
    const view = render(createElement(BoardOverviewLayer, { ...props, theme: 'light' as const }))
    const canvas = view.container.querySelector<HTMLCanvasElement>('[data-board-overview-layer]')!
    act(() => {
      resizeHotGeometryStore.receive(active.id, {
        type: 'begin',
        sessionId: 1,
        geometry: { position: active.position, size: active.size! },
      })
      resizeHotGeometryStore.receive(active.id, {
        type: 'preview',
        sessionId: 1,
        geometry: { position: active.position, size: { width: 300, height: 210 } },
      })
    })
    const inside = {
      cards: Number(canvas.dataset.renderedCardCount),
      representations: Number(canvas.dataset.representationCount),
      labels: Number(canvas.dataset.paintedLabelCount),
      eligible: Number(canvas.dataset.eligibleLabelCandidateCount),
    }
    expect(inside.cards).toBe(2)
    expect(window.__EIDO_OVERVIEW_CARD_IDS__).toEqual(new Set([active.id, cold.id]))

    act(() => {
      resizeHotGeometryStore.receive(active.id, {
        type: 'preview',
        sessionId: 1,
        geometry: { position: { x: 10_000, y: 10_000 }, size: { width: 300, height: 210 } },
      })
    })
    expect(canvas.dataset.renderedCardCount).toBe(String(inside.cards - 1))
    expect(canvas.dataset.representationCount).toBe(String(inside.representations - 1))
    expect(canvas.dataset.paintedLabelCount).toBe(String(inside.labels - 1))
    expect(canvas.dataset.eligibleLabelCandidateCount).toBe(String(inside.eligible - 1))
    expect(canvas.dataset.connectionCandidateCount).toBe('1')
    expect(canvas.dataset.connectionCapApplied).toBe('false')
    expect(canvas.dataset.resizeAnchorCount).toBe('0')
    expect(window.__EIDO_OVERVIEW_CARD_IDS__).toEqual(new Set([cold.id]))
    expect(
      Number(canvas.dataset.drawn) + Number(canvas.dataset.ramped) + Number(canvas.dataset.dropped),
    ).toBe(Number(canvas.dataset.eligibleLabelCandidateCount))

    act(() => {
      resizeHotGeometryStore.receive(active.id, {
        type: 'preview',
        sessionId: 1,
        geometry: { position: active.position, size: { width: 320, height: 220 } },
      })
    })
    const preInvalidationPlanes = harness.retainedCanvases.slice(-4)
    view.rerender(createElement(BoardOverviewLayer, { ...props, theme: 'dark' as const }))
    expect(preInvalidationPlanes.every((plane) => plane.width === 0 && plane.height === 0)).toBe(true)
    expect(canvas.dataset.renderedCardCount).toBe(String(inside.cards))
    expect(canvas.dataset.representationCount).toBe(String(inside.representations))
    expect(canvas.dataset.paintedLabelCount).toBe(String(inside.labels))
    expect(window.__EIDO_OVERVIEW_CARD_IDS__).toEqual(new Set([active.id, cold.id]))
  })

  // Synthetic consumer-only replay gate. LowZoom does not produce this hot
  // lifecycle; the real producer+consumer E2E gate is CardShell at 0.325.
  it.each([
    ['Map', 0.1],
    ['Map-side crossfade', 0.14],
    ['Overview-side crossfade', 0.16],
    ['Overview', 0.25],
  ])('keeps consumer-only Map/Overview resize replay bounded in %s', (_band, zoom) => {
    const harness = installMountedLayerHarness({
      fontLoad: vi.fn(() => new Promise<FontFace[]>(() => undefined)),
      cacheBitmaps: false,
    })
    const active = { ...note('resize-active', 400, 300), size: { width: 260, height: 180 } }
    const target = { ...note('resize-target', 1_200, 300), size: { width: 260, height: 180 } }
    const source = { ...note('resize-source', 0, 500), size: { width: 260, height: 180 } }
    const background = Array.from({ length: 180 }, (_, index) => ({
      ...note(`background-${index}`, 80 + (index % 18) * 260, 900 + Math.floor(index / 18) * 210),
      size: { width: 220, height: 160 },
    }))
    const cards = [active, target, source, ...background]
    const incidentConnections = [
      connect('resize-outgoing', active.id, target.id),
      connect('resize-incoming', source.id, active.id),
    ]
    const unrelatedConnections = Array.from({ length: 62 }, (_, index) =>
      connect(
        `background-connection-${index}`,
        background[index * 2].id,
        background[index * 2 + 1].id,
      ),
    )
    const baseIndex = createBoardRenderIndex(cards, [...incidentConnections, ...unrelatedConnections])
    const query = vi.fn(baseIndex.query)
    const cardById = vi.fn(baseIndex.cardById)
    const renderIndex = { ...baseIndex, query, cardById }
    const resizeHotGeometryStore = createBoardResizeHotGeometryStore()
    const view = render(createElement(BoardOverviewLayer, {
      theme: 'light' as const,
      renderIndex,
      viewport: { x: 20, y: 20, zoom },
      viewportSize: VIEWPORT_SIZE,
      marginPx: 200,
      renderCards: true,
      renderConnections: true,
      selectedCardIds: new Set([active.id]),
      hoveredCardId: null,
      reactCardIds: new Set<string>(),
      suppressedCardIds: new Set<string>(),
      measuredCardSizesById: new Map<string, { width: number; height: number }>(),
      readingCardOpacity: 0,
      cardSummariesById: new Map(cards.map((card) => [card.id, summaryForCard(card)])),
      resizeHotGeometryStore,
    }))
    const canvas = view.container.querySelector<HTMLCanvasElement>('[data-board-overview-layer]')!
    const start = { position: active.position, size: active.size }
    act(() => {
      resizeHotGeometryStore.receive(active.id, { type: 'begin', sessionId: 91, geometry: start })
    })

    // One cold query/plan may prepare the retained base at begin. From this
    // point until pointer release, all board-sized work is frozen.
    const frozen = {
      queries: query.mock.calls.length,
      cardReads: cardById.mock.calls.length,
      fullDraws: canvas.dataset.overviewDrawCount,
    }
    const previews = [
      { position: active.position, size: { width: 300, height: 210 } },
      { position: active.position, size: { width: 340, height: 235 } },
      { position: active.position, size: { width: 380, height: 260 } },
    ]
    const operationsAtBegin = harness.mainContext.ops.length
    for (const geometry of previews) {
      act(() => {
        resizeHotGeometryStore.receive(active.id, { type: 'preview', sessionId: 91, geometry })
      })
    }

    expect(query).toHaveBeenCalledTimes(frozen.queries)
    expect(cardById).toHaveBeenCalledTimes(frozen.cardReads)
    expect(canvas.dataset.overviewDrawCount).toBe(frozen.fullDraws)
    expect(canvas.dataset.resizeHotCardVisits).toBe(String(previews.length))
    const capturedConnectionCount = incidentConnections.length + unrelatedConnections.length
    expect(capturedConnectionCount).toBe(64)
    expect(canvas.dataset.resizeHotConnectionVisits).toBe(String(previews.length * capturedConnectionCount))
    expect(canvas.dataset.resizeHotIncidentConnectionCount).toBe(String(incidentConnections.length))
    expect(canvas.dataset.resizeHotCapturedConnectionCount).toBe(String(capturedConnectionCount))

    const previewOps = harness.mainContext.ops.slice(operationsAtBegin)
    const retainedRestores = previewOps.filter(
      (op) => op.op === 'drawImage' && op.args[0] instanceof HTMLCanvasElement,
    )
    // Connections replay their exact captured order. Four retained planes
    // restore cold card bodies, frozen nonactive labels, the captured active
    // label, and cold anchors; only active geometry/anchors are recomputed.
    expect(retainedRestores).toHaveLength(previews.length * 4)
    const connectionStrokes = previewOps.filter(
      (op) => op.op === 'stroke' && op.path.some((pathOp) => pathOp.op === 'bezierCurveTo'),
    )
    expect(connectionStrokes).toHaveLength(previews.length * capturedConnectionCount)

    const representationPaints = bandCrossfade(zoom, {
      mapMaxZoom: MAP_BAND_MAX_ZOOM,
      readingMinZoom: READING_BAND_MIN_ZOOM,
    }) ? 2 : 1
    expect(canvas.dataset.resizeHotRepresentationPaintCount).toBe(String(representationPaints))
    const finalGeometry = previews[previews.length - 1]
    const hotFrame = {
      x: finalGeometry.position.x * zoom + 20,
      y: finalGeometry.position.y * zoom + 20,
      width: finalGeometry.size.width * zoom,
      height: finalGeometry.size.height * zoom,
    }
    const ports = paintedPortGeometry(hotFrame)
    let finalRestoreAt = -1
    let restoresSeen = 0
    for (let index = previewOps.length - 1; index >= 0; index -= 1) {
      const op = previewOps[index]
      if (op.op === 'drawImage' && op.args[0] instanceof HTMLCanvasElement) {
        restoresSeen += 1
        if (restoresSeen === 4) {
          finalRestoreAt = index
          break
        }
      }
    }
    const finalPreviewOps = previewOps.slice(finalRestoreAt)
    const finalPortArcs = finalPreviewOps.filter((op) => {
      if (op.op !== 'arc') return false
      return [ports.left, ports.right].some(
        (port) =>
          Math.abs(Number(op.args[0]) - port.x) <= 1 &&
          Math.abs(Number(op.args[1]) - port.y) <= 1 &&
          Math.abs(Number(op.args[2]) - ports.radius) <= 1,
      )
    })
    expect(finalPortArcs).toHaveLength(representationPaints * 2)

    const finalConnectionStrokes = connectionStrokes.slice(-capturedConnectionCount)
    expect(finalConnectionStrokes).toHaveLength(capturedConnectionCount)
    const outgoing = finalConnectionStrokes.find((op) => {
      const move = op.path.find((pathOp) => pathOp.op === 'moveTo')
      return move && Math.abs(Number(move.args[0]) - (hotFrame.x + hotFrame.width)) <= 1
    })
    const incoming = finalConnectionStrokes.find((op) => {
      const curve = op.path.find((pathOp) => pathOp.op === 'bezierCurveTo')
      return curve && Math.abs(Number(curve.args[4]) - hotFrame.x) <= 1
    })
    expect(outgoing?.path.find((pathOp) => pathOp.op === 'moveTo')?.args[1]).toBeCloseTo(
      hotFrame.y + hotFrame.height / 2,
      0,
    )
    expect(incoming?.path.find((pathOp) => pathOp.op === 'bezierCurveTo')?.args[5]).toBeCloseTo(
      hotFrame.y + hotFrame.height / 2,
      0,
    )
  })

  it('refreshes latest state before one synchronous light→dark pre-paint', () => {
    const pendingFont = deferred<FontFace[]>()
    const harness = installMountedLayerHarness({
      fontLoad: vi.fn(() => pendingFont.promise),
      cacheBitmaps: false,
    })
    const scene = mountedLayerScene('theme-switch-integration', true)
    const view = render(createElement(BoardOverviewLayer, { ...scene, theme: 'light' as const }))
    const canvas = view.container.querySelector<HTMLCanvasElement>('[data-board-overview-layer]')!
    expect(canvas.dataset.overviewDrawCount).toBe('1')
    const operationsBeforeThemeCommit = harness.mainContext.ops.length

    view.rerender(createElement(BoardOverviewLayer, { ...scene, theme: 'dark' as const }))

    const dark = painterPaletteForTheme('dark')
    const synchronousPrePaint = harness.mainContext.ops.slice(operationsBeforeThemeCommit)
    expect(canvas.dataset.overviewDrawCount).toBe('2')
    expect(harness.frames.size).toBe(1) // the next rAF has not run
    expect(
      synchronousPrePaint.some(
        (op) =>
          op.op === 'fill' &&
          op.fillStyle === dark.cards.note.fill &&
          op.path.some((pathOp) => pathOp.op === 'quadraticCurveTo'),
      ),
    ).toBe(true)
    expect(
      synchronousPrePaint.some(
        (op) =>
          op.op === 'stroke' &&
          op.strokeStyle === dark.connections.helps &&
          op.path.some((pathOp) => pathOp.op === 'bezierCurveTo'),
      ),
    ).toBe(true)
    expect(
      synchronousPrePaint.some((op) => op.op === 'fillText' && op.fillStyle === dark.label.ink),
    ).toBe(true)
  })

  it('turns resolved font readiness into one revision-1 bitmap and ellipsis redraw', async () => {
    const fontReady = deferred<FontFace[]>()
    const fontLoad = vi.fn(() => fontReady.promise)
    const harness = installMountedLayerHarness({ fontLoad, cacheBitmaps: true })
    const scene = mountedLayerScene('font-ready-integration-unique', false)
    const ellipsisBeforeMount = labelEllipsisMissesForTests()
    const view = render(createElement(BoardOverviewLayer, { ...scene, theme: 'light' as const }))
    const canvas = view.container.querySelector<HTMLCanvasElement>('[data-board-overview-layer]')!
    const entriesAtRevision0 = Number(canvas.dataset.cacheEntries)

    expect(canvas.dataset.overviewDrawCount).toBe('1')
    expect(canvas.dataset.labelCacheMissesPerFrame).toBe('1')
    expect(harness.bitmapContexts).toHaveLength(1)
    expect(labelEllipsisMissesForTests() - ellipsisBeforeMount).toBe(1)

    await act(async () => {
      fontReady.resolve([])
      await fontReady.promise
      await Promise.resolve()
    })
    expect(canvas.dataset.overviewDrawCount).toBe('1') // dirty, not drawn outside rAF

    const ellipsisBeforeRevision1 = labelEllipsisMissesForTests()
    act(() => harness.flushFrame())

    expect(canvas.dataset.overviewDrawCount).toBe('2')
    expect(canvas.dataset.labelCacheMissesPerFrame).toBe('1')
    expect(Number(canvas.dataset.cacheEntries)).toBe(entriesAtRevision0 + 1)
    expect(harness.bitmapContexts).toHaveLength(2)
    expect(labelEllipsisMissesForTests() - ellipsisBeforeRevision1).toBe(1)

    act(() => harness.flushFrame())
    expect(canvas.dataset.overviewDrawCount).toBe('2') // exactly one dirty redraw
    expect(fontLoad).toHaveBeenCalledTimes(1)
  })

  it('does not redraw when font loading rejects', async () => {
    const fontReady = deferred<FontFace[]>()
    const harness = installMountedLayerHarness({
      fontLoad: vi.fn(() => fontReady.promise),
      cacheBitmaps: false,
    })
    const scene = mountedLayerScene('font-reject-integration', false)
    const view = render(createElement(BoardOverviewLayer, { ...scene, theme: 'light' as const }))
    const canvas = view.container.querySelector<HTMLCanvasElement>('[data-board-overview-layer]')!

    await act(async () => {
      fontReady.reject(new Error('font unavailable'))
      await fontReady.promise.catch(() => undefined)
      await Promise.resolve()
    })
    act(() => harness.flushFrame())

    expect(canvas.dataset.overviewDrawCount).toBe('1')
  })

  it('does not redraw when font loading resolves after unmount', async () => {
    const fontReady = deferred<FontFace[]>()
    const harness = installMountedLayerHarness({
      fontLoad: vi.fn(() => fontReady.promise),
      cacheBitmaps: false,
    })
    const scene = mountedLayerScene('font-unmount-integration', false)
    const view = render(createElement(BoardOverviewLayer, { ...scene, theme: 'light' as const }))
    const canvas = view.container.querySelector<HTMLCanvasElement>('[data-board-overview-layer]')!
    expect(canvas.dataset.overviewDrawCount).toBe('1')

    view.unmount()
    await act(async () => {
      fontReady.resolve([])
      await fontReady.promise
      await Promise.resolve()
    })

    expect(harness.frames.size).toBe(0)
    expect(canvas.dataset.overviewDrawCount).toBe('1')
  })
})

describe('painted Title cards', () => {
  const titleCard = (id: string, text: string, size = { width: 400, height: 200 }): Card => ({
    id,
    kind: 'title',
    blocks: [{ id: `${id}-block`, text }],
    position: { x: 100, y: 100 },
    size,
  })

  const fillTextOps = (context: RecordingContext) =>
    context.ops.filter((op) => op.op === 'fillText')

  it('paints type alone: no paper, no border at rest, no ports', () => {
    const card = titleCard('landmark', 'North star')

    const { context } = draw({ cards: [card], zoom: 0.25 })

    // A fill or stroke here is a card body the founder never drew. The DOM
    // Title card is transparent at rest, and so is its painted half.
    expect(context.ops.filter((op) => op.op === 'fill')).toHaveLength(0)
    expect(context.ops.filter((op) => op.op === 'stroke')).toHaveLength(0)
    expect(context.ops.filter((op) => op.op === 'arc')).toHaveLength(0)
    expect(fillTextOps(context).map((op) => op.args[0])).toEqual(['North star'])
  })

  it('scales its type with the board so a band crossing changes only who draws', () => {
    const card = titleCard('landmark', 'North star')
    const paintedSize = (zoom: number) => {
      const painted = fillTextOps(draw({ cards: [card], zoom }).context)[0]
      return Number.parseFloat(String((painted as unknown as { font: string }).font).match(/([\d.]+)px/)![1])
    }

    // Halving the zoom halves the painted type: no fixed-size stand-in.
    expect(paintedSize(0.5)).toBeCloseTo(paintedSize(0.25) * 2, 4)
  })

  it('paints nothing at all under a Title card the DOM already owns', () => {
    const card = titleCard('landmark', 'North star')

    const { context } = draw({
      cards: [card],
      zoom: 1,
      reactCardIds: new Set([card.id]),
      readingCardOpacity: 1,
    })

    // Other kinds get a silhouette fill for motion continuity. Filling one
    // here would put paper behind transparent type (the founder's report).
    expect(context.ops.filter((op) => op.op === 'fill')).toHaveLength(0)
    expect(fillTextOps(context)).toHaveLength(0)
  })

  it('keeps the agent-unadopted dashed accent the mounted card also shows', () => {
    const agent = { kind: 'agent', client: 'codex', sessionId: 'agent-session' } as const
    const card = { ...titleCard('landmark', 'North star'), createdBy: agent, lastModifiedBy: agent } as Card
    const palette = painterPaletteForTheme('light')

    const { context } = draw({ cards: [card], zoom: 0.25, palette })

    expect(context.ops.find((op) => op.op === 'stroke')).toMatchObject({
      strokeStyle: palette.agentUnadoptedAccent,
      lineDash: [4, 4],
    })
  })
})

describe('semantic overview palette', () => {
  it.each([
    ['note', 'note'],
    ['askAi', 'ask'],
    ['result', 'result'],
    ['group', 'group'],
  ] as const)('uses the neutral %s role from cards.%s', (kind, role) => {
    const palette = painterPaletteForTheme('dark')
    const card = { ...note(kind, 0, 0), kind } as Card

    const { context } = draw({ cards: [card], zoom: 0.25, palette })

    expect(context.ops.find((op) => op.op === 'fill')?.fillStyle).toBe(palette.cards[role].fill)
    expect(context.ops.find((op) => op.op === 'stroke')?.strokeStyle).toBe(palette.cards[role].stroke)
  })

  it('uses the active theme neutral card tokens for Note cards', () => {
    const palette = painterPaletteForTheme('dark')

    const { context } = draw({ cards: [note('a', 0, 0)], zoom: 0.25, palette })

    expect(context.ops.find((op) => op.op === 'fill')?.fillStyle).toBe(palette.cards.note.fill)
    expect(context.ops.find((op) => op.op === 'stroke')?.strokeStyle).toBe(palette.cards.note.stroke)
  })

  it('dashes the exact Group body stroke then resets before the next card', () => {
    const palette = painterPaletteForTheme('light')
    const group = { ...note('group', 0, 0), kind: 'group' } as Card
    const nextNote = note('next', 500, 0)

    const { context } = draw({ cards: [group, nextNote], zoom: 0.25, palette })
    const bodyStrokes = context.ops.filter(
      (op) => op.op === 'stroke' && op.path.some((pathOp) => pathOp.op === 'quadraticCurveTo'),
    )

    expect(bodyStrokes).toHaveLength(2)
    expect(bodyStrokes[0]).toMatchObject({ strokeStyle: palette.cards.group.stroke, lineDash: [4, 4] })
    expect(bodyStrokes[1]).toMatchObject({ strokeStyle: palette.cards.note.stroke, lineDash: [] })
  })

  it('paints Groups behind member Cards regardless of saved-board order', () => {
    const palette = painterPaletteForTheme('light')
    const member = { ...note('member', 120, 120), groupId: 'group' }
    const group = {
      ...note('group', 0, 0),
      kind: 'group',
      size: { width: 720, height: 520 },
      headerColor: '#123456',
      headerFill: 'full',
    } as Card

    const { context } = draw({ cards: [member, group], zoom: 0.25, palette })
    const bodyFills = context.ops.filter(
      (op) => op.op === 'fill' && op.path.some((pathOp) => pathOp.op === 'quadraticCurveTo'),
    )

    expect(bodyFills).toHaveLength(2)
    expect(bodyFills[0]?.fillStyle).toBe('rgba(18, 52, 86, 0.16)')
    expect(bodyFills[1]?.fillStyle).toBe(palette.cards.note.fill)
    const memberPorts = paintedPortGeometry({
      x: member.position.x * 0.25 + 20,
      y: member.position.y * 0.25 + 20,
      width: 260 * 0.25,
      height: 180 * 0.25,
    })
    const memberPortFillIndex = context.ops.findIndex(
      (op) =>
        op.op === 'fill' &&
        op.path.some(
          (pathOp) =>
            pathOp.op === 'arc' &&
            pathOp.args[0] === memberPorts.left.x &&
            pathOp.args[1] === memberPorts.left.y &&
            pathOp.args[2] === memberPorts.radius,
        ),
    )
    expect(memberPortFillIndex).toBeGreaterThan(context.ops.indexOf(bodyFills[0]!))
  })

  it.each([
    ['Map', MAP_BAND_MAX_ZOOM],
    ['Overview', 0.25],
  ])('paints every Agent-creatable Card with the named dashed accent in %s detail', (_band, zoom) => {
    const palette = painterPaletteForTheme('dark')
    const agent = { kind: 'agent', client: 'codex', sessionId: 'agent-session' } as const
    const user = { kind: 'user', client: 'eido-desktop', sessionId: 'user-session' } as const

    for (const kind of ['note', 'askAi', 'title', 'group', 'conversation'] as const) {
      const agentCard = {
        ...note(kind, 0, 0),
        kind,
        createdBy: agent,
        lastModifiedBy: agent,
      } as Card
      const agentStroke = draw({ cards: [agentCard], zoom, palette }).context.ops.find(
        (op) => op.op === 'stroke' && op.path.some((pathOp) => pathOp.op === 'quadraticCurveTo'),
      )
      expect(agentStroke, kind).toMatchObject({
        strokeStyle: palette.agentUnadoptedAccent,
        lineDash: [4, 4],
      })

      const adoptedStroke = draw({
        cards: [{ ...agentCard, lastModifiedBy: user }],
        zoom,
        palette,
      }).context.ops.find(
        (op) => op.op === 'stroke' && op.path.some((pathOp) => pathOp.op === 'quadraticCurveTo'),
      )
      expect(adoptedStroke?.strokeStyle, kind).not.toBe(palette.agentUnadoptedAccent)
    }
  })

  it.each([
    ['helps', {}, 'helps', []],
    ['avoid', { polarity: 'pushesAgainst' }, 'avoid', [0.1, 7]],
    ['modifies', { role: 'modifies' }, 'modifies', [0.1, 7]],
  ] as const)('uses the exact %s connection role paint', (_name, overrides, role, dash) => {
    const palette = painterPaletteForTheme('dark')
    const cards = [note('a', 0, 0), note('b', 500, 0)]

    const { context } = draw({
      cards,
      connections: [connect('c', 'a', 'b', overrides as Partial<Connection>)],
      zoom: 0.25,
      palette,
    })
    const connectionStroke = context.ops.find(
      (op) => op.op === 'stroke' && op.path.some((pathOp) => pathOp.op === 'bezierCurveTo'),
    )

    expect(connectionStroke).toMatchObject({ strokeStyle: palette.connections[role], lineDash: dash })
  })

  it('uses exact Direct/Light weights and applies hover only as +1.2px at Reading detail', () => {
    const cards = [note('a', 0, 0), note('b', 500, 0)]
    const direct = draw({
      cards,
      connections: [connect('direct', 'a', 'b')],
      zoom: READING_BAND_MIN_ZOOM,
    }).context
    const light = draw({
      cards,
      connections: [connect('light', 'a', 'b', { strength: 'weak' })],
      zoom: READING_BAND_MIN_ZOOM,
    }).context
    const hovered = draw({
      cards,
      connections: [connect('hovered', 'a', 'b', { strength: 'weak' })],
      zoom: READING_BAND_MIN_ZOOM,
      hoveredConnectionId: 'hovered',
    }).context
    const connectionStroke = (context: RecordingContext) => context.ops.find(
      (op) => op.op === 'stroke' && op.path.some((pathOp) => pathOp.op === 'bezierCurveTo'),
    )

    expect(connectionStroke(direct)?.lineWidth).toBe(3)
    expect(connectionStroke(light)).toMatchObject({ lineWidth: 1.5, lineDash: [] })
    expect(connectionStroke(hovered)?.lineWidth).toBe(2.7)
  })

  it.each([
    ['Map', MAP_BAND_MAX_ZOOM],
    ['Overview', 0.25],
  ])('uses the thin connection weight in %s detail', (_band, zoom) => {
    const cards = [note('a', 0, 0), note('b', 500, 0)]
    const { context } = draw({
      cards,
      connections: [connect('direct', 'a', 'b')],
      zoom,
    })
    const connectionStroke = context.ops.find(
      (op) => op.op === 'stroke' && op.path.some((pathOp) => pathOp.op === 'bezierCurveTo'),
    )

    expect(connectionStroke?.lineWidth).toBe(1.5)
  })

  it('grows only the hovered connection badge from the shared midpoint geometry', () => {
    const cards = [note('a', 0, 0), note('b', 500, 0)]
    const rest = draw({ cards, connections: [connect('wire', 'a', 'b')], zoom: 0.25 }).context
    const hovered = draw({
      cards,
      connections: [connect('wire', 'a', 'b')],
      zoom: 0.25,
      hoveredConnectionId: 'wire',
    }).context
    const badgeRadius = (context: RecordingContext) => context.ops.find(
      (op) => op.op === 'arc' && op.args[2] === paintedBadgeRadius(0.25),
    )?.args[2] as number | undefined
    const expandedBadgeRadius = paintedConnectionBadgeGeometry(
      { sourceX: 0, sourceY: 0, targetX: 1, targetY: 0 },
      0.25,
      { expanded: true },
    ).radius
    const hoveredBadgeRadius = hovered.ops.find(
      (op) => op.op === 'arc' && op.args[2] === expandedBadgeRadius,
    )?.args[2] as number | undefined

    expect(badgeRadius(rest)).toBe(paintedBadgeRadius(0.25))
    expect(hoveredBadgeRadius).toBe(expandedBadgeRadius)
  })

  it.each([
    ['mod', 'mod'],
    ['conversation', 'conversation'],
  ] as const)('uses the sanctioned %s semantic wash and stroke', (kind, role) => {
    const palette = painterPaletteForTheme('dark')
    const card = { ...note(kind, 0, 0), kind } as Card

    const { context } = draw({ cards: [card], zoom: 0.25, palette })

    expect(context.ops.find((op) => op.op === 'fill')?.fillStyle).toBe(palette.cards[role].fill)
    expect(context.ops.find((op) => op.op === 'stroke')?.strokeStyle).toBe(palette.cards[role].stroke)
  })

  it('derives a custom header wash at paint time while preserving the raw stroke', () => {
    const palette = painterPaletteForTheme('dark')
    const card = { ...note('custom', 0, 0), headerColor: '#123456' } as Card

    const { context } = draw({ cards: [card], zoom: 0.25, palette })

    expect(context.ops.find((op) => op.op === 'fill')?.fillStyle).toBe('rgba(18, 52, 86, 0.16)')
    expect(context.ops.find((op) => op.op === 'stroke')?.strokeStyle).toBe('#123456')
  })

  it('uses theme port and badge roles instead of painter-local colours', () => {
    const palette = {
      ...painterPaletteForTheme('dark'),
      port: { fill: '#010203', stroke: '#040506' },
      badge: { fill: '#070809', stroke: '#0a0b0c' },
    } as PainterPalette
    const cards = [note('a', 0, 0), note('b', 500, 0)]

    const { context } = draw({ cards, connections: [connect('c', 'a', 'b')], zoom: 0.25, palette })

    const arcFills = context.ops.filter((op) => op.op === 'fill' && op.path.some((pathOp) => pathOp.op === 'arc'))
    const arcStrokes = context.ops.filter((op) => op.op === 'stroke' && op.path.some((pathOp) => pathOp.op === 'arc'))
    const radiusOf = (op: RecordedOp) => op.path.find((pathOp) => pathOp.op === 'arc')?.args[2]
    const portRadius = paintedPortGeometry({ x: 20, y: 20, width: 65, height: 45 }).radius
    const badgeRadius = paintedBadgeRadius(0.25)
    const portOuterFills = arcFills.filter((op) => radiusOf(op) === portRadius)
    const portInnerFills = arcFills.filter(
      (op) => radiusOf(op) === portRadius - CONNECTOR_NODE_METRICS.stroke,
    )
    const portStrokes = arcStrokes.filter((op) => radiusOf(op) === portRadius)
    const badgeFills = arcFills.filter((op) => radiusOf(op) === badgeRadius)
    const badgeStrokes = arcStrokes.filter((op) => radiusOf(op) === badgeRadius)

    expect(portOuterFills).toHaveLength(4)
    expect(portInnerFills).toHaveLength(4)
    expect(portStrokes).toHaveLength(0)
    expect(portOuterFills.every((op) => op.fillStyle === palette.port.stroke)).toBe(true)
    expect(portInnerFills.every((op) => op.fillStyle === palette.port.fill)).toBe(true)
    expect(badgeFills).toHaveLength(1)
    expect(badgeStrokes).toHaveLength(1)
    expect(badgeFills[0].fillStyle).toBe(palette.badge.fill)
    expect(badgeStrokes[0].strokeStyle).toBe(palette.badge.stroke)
  })

  it('associates selection, hover, and resize-anchor operations with their exact roles', () => {
    const palette = {
      ...painterPaletteForTheme('dark'),
      selection: '#123456',
      hover: '#654321',
    } as PainterPalette

    const selected = draw({
      cards: [note('selected', 0, 0)],
      zoom: 0.25,
      selectedCardIds: new Set(['selected']),
      palette,
    }).context
    const selectionBoundary = selected.ops.find(
      (op) => op.op === 'stroke' && op.strokeStyle === palette.selection,
    )
    const anchors = selected.ops.filter(
      (op) =>
        op.op === 'fill' &&
        op.fillStyle === palette.selection &&
        op.path.some((pathOp) => pathOp.op === 'quadraticCurveTo'),
    )
    expect(selectionBoundary?.path.some((pathOp) => pathOp.op === 'quadraticCurveTo')).toBe(true)
    expect(anchors).toHaveLength(4)

    const hovered = draw({
      cards: [note('hovered', 0, 0)],
      zoom: 0.25,
      hoveredCardId: 'hovered',
      palette,
    }).context
    const hoverRing = hovered.ops.find(
      (op) => op.op === 'stroke' && op.strokeStyle === alphaPaint(palette.hover, 0.35),
    )
    expect(hoverRing?.path.some((pathOp) => pathOp.op === 'quadraticCurveTo')).toBe(true)
    expect(hovered.ops.some((op) => op.op === 'fill' && op.fillStyle === palette.selection)).toBe(false)
  })

  it('uses the exact Card path for selected boundary ink across every painted kind', () => {
    const palette = painterPaletteForTheme('light')
    const kinds: Card['kind'][] = [
      'note',
      'askAi',
      'result',
      'mod',
      'group',
      'conversation',
      'title',
    ]

    for (const kind of kinds) {
      const card = {
        ...note(`selected-${kind}`, 0, 0),
        kind,
        ...(kind === 'mod'
          ? {
              modV2: createSeedMod('slider', {
                createId: (role, ordinal) => `selected-${kind}-${role}-${ordinal}`,
              }),
            }
          : {}),
      } as Card
      const zoom = 0.25
      const { context } = draw({
        cards: [card],
        zoom,
        selectedCardIds: new Set([card.id]),
        palette,
      })
      const selectedBoundaries = context.ops.filter(
        (op) =>
          op.op === 'stroke' &&
          op.strokeStyle === palette.selection &&
          op.path.some((pathOp) => pathOp.op === 'quadraticCurveTo'),
      )
      expect(selectedBoundaries, kind).toHaveLength(1)
      const selectedBoundary = selectedBoundaries[0]!
      const points = selectedBoundary.path.flatMap((pathOp) => {
        const coordinates = pathOp.args.map(Number)
        const pairs: Array<{ x: number; y: number }> = []
        for (let index = 0; index + 1 < coordinates.length; index += 2) {
          pairs.push({ x: coordinates[index]!, y: coordinates[index + 1]! })
        }
        return pairs
      })
      const size = renderedCardSize(card)
      expect(Math.min(...points.map((point) => point.x)), `${kind} left`).toBeCloseTo(20, 5)
      expect(Math.min(...points.map((point) => point.y)), `${kind} top`).toBeCloseTo(20, 5)
      expect(Math.max(...points.map((point) => point.x)), `${kind} right`).toBeCloseTo(
        20 + size.width * zoom,
        5,
      )
      expect(Math.max(...points.map((point) => point.y)), `${kind} bottom`).toBeCloseTo(
        20 + size.height * zoom,
        5,
      )
      expect(selectedBoundary.lineWidth, kind).toBe(1)
      expect(selectedBoundary.lineDash, kind).toEqual(kind === 'group' ? [4, 4] : [])
    }
  })

  it('keeps direct canvas colour assignments out of the scoped painters', () => {
    const sources = ['Board.tsx', 'BoardOverviewLayer.tsx', 'labelLayer.ts'].map((file) =>
      readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, ''),
    )
    const rawColourLiteral = /['"](?:#[0-9a-fA-F]{3,8}|rgba?\([^'"]*\))['"]/

    for (const source of sources) {
      expect(source).not.toMatch(rawColourLiteral)
    }
  })
})

describe('drawOverviewLayer representations', () => {
  it('paints a bounded body excerpt only for a Reading safety Card', () => {
    const card = { ...note('demoted', 0, 0), size: { width: 420, height: 260 } }
    const summary = {
      label: 'Demoted note',
      preview: 'A bounded plain text excerpt keeps the safety representation recognisable without mounting its semantic Card body.',
      displayPriority: 'user-authored' as const,
    }
    const cardSummariesById = new Map([[card.id, summary]])

    const safety = draw({
      cards: [card],
      zoom: 0.5,
      readingCardOpacity: 1,
      cardSummariesById,
      paintLabels: false,
    })
    const safetyLines = safety.context.ops
      .filter((op) => op.op === 'fillText')
      .map((op) => String(op.args[0]))

    expect(safetyLines.length).toBeGreaterThan(1)
    expect(safetyLines.length).toBeLessThanOrEqual(6)
    expect(safetyLines.join(' ')).toContain('bounded plain text excerpt')
    expect(safety.dataset.safetyPreviewLineCount).toBe(String(safetyLines.length))

    const mounted = draw({
      cards: [card],
      zoom: 0.5,
      readingCardOpacity: 1,
      reactCardIds: new Set([card.id]),
      cardSummariesById,
      paintLabels: false,
    })
    expect(mounted.context.ops.filter((op) => op.op === 'fillText')).toHaveLength(0)
    expect(mounted.dataset.safetyPreviewLineCount).toBe('0')

    const overview = draw({
      cards: [card],
      zoom: 0.25,
      readingCardOpacity: 0,
      cardSummariesById,
      paintLabels: false,
    })
    expect(overview.context.ops.filter((op) => op.op === 'fillText')).toHaveLength(0)
    expect(overview.dataset.safetyPreviewLineCount).toBe('0')
  })

  it('bounds all safety preview lines by the existing viewport-area text budget', () => {
    const cards = Array.from({ length: 100 }, (_, index) => ({
      ...note(`demoted-${index}`, 0, 0),
      size: { width: 420, height: 260 },
    }))
    const cardSummariesById = new Map(cards.map((card) => [card.id, {
      label: `Demoted note ${card.id}`,
      preview: 'A bounded safety excerpt repeats enough words to require several painted lines inside every overlapping Card.',
      displayPriority: 'user-authored' as const,
    }]))

    const { dataset } = draw({
      cards,
      zoom: 0.5,
      readingCardOpacity: 1,
      cardSummariesById,
      paintLabels: false,
    })

    expect(Number(dataset.safetyPreviewLineCount)).toBe(paintedLabelFrameCap(VIEWPORT_SIZE))
  })

  it('paints every card as the Overview shape with CH2 port discs and no text', () => {
    const cards = [note('a', 0, 0), note('b', 500, 100), note('c', 100, 400)]

    const { context, dataset } = draw({ cards, zoom: 0.25 })

    expect(dataset.representation).toBe('overview')
    expect(dataset.representationCount).toBe('3')
    expect(dataset.renderedCardCount).toBe('3')
    expect(dataset.silhouetteCardCount).toBe('0')
    // No text at any painted tier — labels are B2's screen-space layer.
    expect(context.ops.filter((op) => op.op === 'fillText' || op.op === 'strokeText')).toHaveLength(0)

    // Port discs come from the shared geometry owner, byte-identical to what
    // the pointer layer hit-tests: two outer arcs per card at exactly
    // paintedPortGeometry's centres and radius, with separate inset fills.
    const arcs = context.ops.filter((op) => op.op === 'arc')
    const outerArcs = arcs.filter((op) => op.args[2] === CONNECTOR_NODE_METRICS.diameter / 2)
    expect(outerArcs).toHaveLength(cards.length * 2)
    const zoom = 0.25
    for (const card of cards) {
      const frame = {
        x: card.position.x * zoom + 20,
        y: card.position.y * zoom + 20,
        width: 260 * zoom,
        height: 180 * zoom,
      }
      const ports = paintedPortGeometry(frame)
      for (const port of [ports.left, ports.right]) {
        expect(
          outerArcs.some(
            (op) => op.args[0] === port.x && op.args[1] === port.y && op.args[2] === ports.radius,
          ),
        ).toBe(true)
      }
    }
  })

  it('paints every card as the Map pill with CH2 port discs and no text at map band', () => {
    const cards = [note('a', 0, 0), note('b', 500, 100)]

    const { context, dataset } = draw({ cards, zoom: 0.1 })

    expect(dataset.representation).toBe('map')
    expect(dataset.representationCount).toBe('2')
    expect(context.ops.filter((op) => op.op === 'fillText' || op.op === 'strokeText')).toHaveLength(0)

    // Map pills paint port discs exactly as Overview does (#320 amendment 9,
    // the epic's port-floor decision): same shared geometry owner, so the
    // pointer layer's hit == paint holds at every canvas-painted zoom.
    const arcs = context.ops.filter((op) => op.op === 'arc')
    const outerArcs = arcs.filter((op) => op.args[2] === CONNECTOR_NODE_METRICS.diameter / 2)
    expect(outerArcs).toHaveLength(cards.length * 2)
    const zoom = 0.1
    for (const card of cards) {
      const frame = {
        x: card.position.x * zoom + 20,
        y: card.position.y * zoom + 20,
        width: 260 * zoom,
        height: 180 * zoom,
      }
      const ports = paintedPortGeometry(frame)
      for (const port of [ports.left, ports.right]) {
        expect(
          outerArcs.some(
            (op) => op.args[0] === port.x && op.args[1] === port.y && op.args[2] === ports.radius,
          ),
        ).toBe(true)
      }
    }
  })

  it.each([0.14, 0.16])('crossfades Map and Overview shape opacity from the zoom-pure curve at zoom %s', (zoom) => {
    const { context, dataset } = draw({ cards: [note('a', 0, 0)], zoom })
    const fade = bandCrossfade(zoom, {
      mapMaxZoom: MAP_BAND_MAX_ZOOM,
      readingMinZoom: READING_BAND_MIN_ZOOM,
    })

    expect(fade).toMatchObject({ from: 'map', to: 'overview' })
    // Both crossfading representations paint their body plus the outer and
    // inner fills for two inset-ring port discs
    // (amendment 9): the same disc lands twice at identical geometry, once
    // per shape at that shape's alpha (1−t and t) — sanctioned double-paint.
    expect(context.ops.filter((op) => op.op === 'fill').map((op) => op.globalAlpha)).toEqual([
      ...Array(5).fill(1 - fade!.t),
      ...Array(5).fill(fade!.t),
    ])
    expect(dataset.renderedCardCount).toBe('1')
    expect(dataset.representationCount).toBe('1')
  })

  it('fades the Overview body inversely to the mounted Reading body', () => {
    const { context, dataset } = draw({
      cards: [note('a', 0, 0)],
      zoom: 0.325,
      readingCardOpacity: 0.5,
      reactCardIds: new Set(['a']),
    })

    expect(context.ops.filter((op) => op.op === 'fill').map((op) => op.globalAlpha)).toEqual(
      Array(5).fill(0.5),
    )
    expect(dataset.readingCardOpacity).toBe('0.5')
    expect(dataset.overviewCardOpacity).toBe('0.5')
  })

  it('paints card bodies at constant full opacity — decay is gone (ADR 0021)', () => {
    const cards = [note('a', 0, 0), note('b', 500, 100)]

    const { context } = draw({ cards, zoom: 0.25 })

    const bodyPaints = context.ops.filter((op) => op.op === 'fill' || op.op === 'stroke')
    expect(bodyPaints.length).toBeGreaterThan(0)
    expect(bodyPaints.every((op) => op.globalAlpha === 1)).toBe(true)
  })

  it('paints one solid set of selected-card corner grabbers with the card', () => {
    const { context, dataset } = draw({
      cards: [note('selected', 0, 0), note('plain', 500, 100)],
      zoom: 0.4,
      selectedCardIds: new Set(['selected']),
    })

    expect(dataset.resizeAnchorCount).toBe('4')
    const solidAnchorPaints = context.ops.filter(
      (op) => op.op === 'fill' && op.fillStyle === '#2f6f5e' && op.globalAlpha === 1,
    )
    expect(solidAnchorPaints).toHaveLength(4)
  })

  it('draws mounted cards as measured-size silhouettes: no ports, counted apart', () => {
    const cards = [note('mounted', 0, 0), note('free', 500, 100)]
    const measured = new Map([['mounted', { width: 260, height: 96 }]])

    const { context, dataset } = draw({
      cards,
      zoom: 0.5,
      reactCardIds: new Set(['mounted']),
      measuredCardSizesById: measured,
    })

    expect(dataset.representationCount).toBe('1')
    expect(dataset.silhouetteCardCount).toBe('1')
    expect(dataset.renderedCardCount).toBe('2')
    // Only the free card gets port discs; the silhouette must stay bare so
    // nothing bleeds through the React node above it (#217).
    expect(
      context.ops.filter(
        (op) => op.op === 'arc' && op.args[2] === CONNECTOR_NODE_METRICS.diameter / 2,
      ),
    ).toHaveLength(2)
    // The mounted fallback follows the measured DOM frame and its transformed
    // 8px Card radius exactly: 260x96 at z=.5 becomes 130x48 with r=4.
    // Painter-owned Overview/Map Cards retain the existing custom path.
    const silhouettePath = context.ops.find((op) => op.op === 'roundRect')
    expect(silhouettePath?.args).toEqual([20, 20, 130, 48, 4])
  })

  it('keeps an unmounted canvas card aligned to its last measured DOM footprint', () => {
    const cards = [note('tall', 0, 0)]
    const measuredHeight = 1_200
    const zoom = 0.1

    const { context } = draw({
      cards,
      zoom,
      // Zooming below Reading unmounts every visual React card, but the
      // measurement captured while it was mounted remains the exact visual
      // footprint that the low-detail representation must preserve.
      reactCardIds: new Set(),
      measuredCardSizesById: new Map([['tall', { width: 260, height: measuredHeight }]]),
    })

    const cardTop = 20
    const measuredBottom = cardTop + measuredHeight * zoom
    const defaultEstimateBottom = cardTop + 180 * zoom
    const lineYs = context.ops
      .filter((op) => op.op === 'lineTo' || op.op === 'moveTo')
      .map((op) => op.args[1] as number)

    expect(lineYs.some((y) => y === measuredBottom)).toBe(true)
    expect(lineYs.some((y) => y === defaultEstimateBottom)).toBe(false)
  })

  it('leaves all mounted Card boundary ink to the DOM, normal and selected', () => {
    // The motion fallback supplies fill continuity only. A normal or selected
    // DOM Card owns its one exact border, so no sharper canvas outline can
    // leak from behind it during pan/zoom.
    for (const selectedCardIds of [new Set<string>(), new Set(['mounted'])]) {
      const { context, dataset } = draw({
        cards: [note('mounted', 0, 0)],
        zoom: 0.5,
        selectedCardIds,
        reactCardIds: new Set(['mounted']),
        measuredCardSizesById: new Map([['mounted', { width: 260, height: 96 }]]),
      })

      expect(dataset.silhouetteCardCount).toBe('1')
      expect(context.ops.filter((op) => op.op === 'stroke')).toHaveLength(0)
      expect(context.ops.find((op) => op.op === 'roundRect')?.args[4]).toBe(4)
      expect(context.ops.filter((op) => op.op === 'arc')).toHaveLength(0)
    }
  })

  it('recolours selected boundaries while keeping hover as a separate quiet ring', () => {
    const cards = [note('picked', 0, 0), note('hovered', 500, 100), note('plain', 100, 400)]
    const palette = painterPaletteForTheme('light')

    const { context } = draw({
      cards,
      zoom: 0.25,
      selectedCardIds: new Set(['picked']),
      hoveredCardId: 'hovered',
      palette,
    })

    const strokes = context.ops.filter((op) => op.op === 'stroke')
    expect(strokes.filter((op) => op.strokeStyle === palette.selection)).toHaveLength(1)
    expect(strokes.filter((op) => op.strokeStyle === 'rgba(47, 111, 94, 0.35)')).toHaveLength(1)
  })
})

describe('drawOverviewLayer connection accounting', () => {
  it('draws badges at the CH2 radius and counts density-capped badges as omissions', () => {
    // 40 parallel connections at overview zoom (badge limit 32): every line
    // paints, 32 badges paint, and the 8 past the cap increment the omission
    // counter instead of disappearing silently.
    const cards = [note('a', 0, 0), note('b', 800, 200)]
    const connections = Array.from({ length: 40 }, (_, i) => connect(`c${i}`, 'a', 'b'))

    const { context, dataset } = draw({ cards, connections, zoom: 0.4 })

    expect(dataset.renderedConnectionCount).toBe('40')
    expect(dataset.renderedConnectionBadgeCount).toBe('32')
    expect(dataset.omittedConnectionBadgeCount).toBe('8')
    expect(dataset.connectionCandidateCount).toBe('40')
    expect(dataset.connectionCapApplied).toBe('false')

    const badgeArcs = context.ops.filter((op) => op.op === 'arc')
    expect(badgeArcs).toHaveLength(32 + cards.length * 4)
    const badgeRadius = paintedBadgeRadius(0.4)
    expect(badgeArcs.filter((op) => op.args[2] === badgeRadius)).toHaveLength(32)
  })

  it('counts the exact candidates the density cap removed, from the untruncated source', () => {
    // The render window hands the painter the query-TRUNCATED candidate list
    // plus the TRUE candidate count: 80 window candidates truncated to the
    // zoom-0.4 cap of 64 → the cap applied and removed exactly 16 — the
    // parked H2 omission E1's artifact records (2,200 painted of 10,000),
    // surfaced as a real counter.
    const cards = [note('a', 0, 0), note('b', 800, 200)]
    const truncated = Array.from({ length: 64 }, (_, i) => connect(`c${i}`, 'a', 'b'))

    const { dataset } = draw({ cards, connections: truncated, connectionCandidateCount: 80, zoom: 0.4 })

    expect(dataset.connectionCandidateCount).toBe('80')
    expect(dataset.connectionCapApplied).toBe('true')
    expect(dataset.omittedConnectionCount).toBe('16')
    expect(dataset.renderedConnectionCount).toBe('64')
  })

  it('reports no omission when the candidate set merely EQUALS the cap', () => {
    // Exactly 64 candidates at the 64 cap: nothing was truncated, so a
    // length-equals-limit heuristic would lie. The true candidate count says
    // no omission happened.
    const cards = [note('a', 0, 0), note('b', 800, 200)]
    const exact = Array.from({ length: 64 }, (_, i) => connect(`c${i}`, 'a', 'b'))

    const { dataset } = draw({ cards, connections: exact, connectionCandidateCount: 64, zoom: 0.4 })

    expect(dataset.connectionCandidateCount).toBe('64')
    expect(dataset.connectionCapApplied).toBe('false')
    expect(dataset.omittedConnectionCount).toBe('0')
    expect(dataset.renderedConnectionCount).toBe('64')
  })
})

describe('summaryForCard', () => {
  it('bounds the label and preview it hands the scene seam', () => {
    const card = note('long', 0, 0)
    card.blocks = [{ id: 'long-block', text: `${'Readable body '.repeat(40)}` }]

    const summary = summaryForCard(card)

    expect(summary.label.startsWith('Readable body Readable body')).toBe(true)
    expect(summary.label.length).toBeLessThanOrEqual(58)
    expect(summary.preview).toHaveLength(90)
    expect(summary.preview.endsWith('...')).toBe(true)
  })

  it('does not duplicate the label as the preview for short note text', () => {
    const card = note('short', 0, 0)
    card.blocks = [{ id: 'short-block', text: 'Tiny note' }]

    expect(summaryForCard(card)).toEqual({ label: 'Tiny note', preview: 'note', displayPriority: 'user-authored' })
  })

  it('summarizes Mod cards from the v2 Mod title', () => {
    const card: Card = {
      id: 'mod',
      kind: 'mod',
      blocks: [{ id: 'mod-block', text: '' }],
      position: { x: 0, y: 0 },
      modV2: createSeedMod('slider', {
        title: 'Tone',
        createId: (_, ordinal) => `tone-${ordinal}`,
      }),
    }

    expect(summaryForCard(card)).toEqual({ label: 'Tone', preview: 'Tone', displayPriority: 'system-generated' })
  })
})
