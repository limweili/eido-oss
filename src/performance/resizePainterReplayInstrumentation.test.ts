import { describe, expect, it } from 'vitest'
import {
  bindViteReactLayoutEffect,
  instrumentBoardResizeTerminalTimeout,
  instrumentCommittedBoardSceneProbe,
  instrumentScheduledCoordinatorRead,
} from './resizePainterReplayInstrumentation'

describe('resize painter replay route instrumentation', () => {
  it('binds useLayoutEffect from the exact Vite CommonJS React interop shape', () => {
    const source =
      'const forwardRef = __vite__cjsImport1_react["forwardRef"]; const useEffect = __vite__cjsImport1_react["useEffect"]; const useRef = __vite__cjsImport1_react["useRef"];\n' +
      'import __vite__cjsImport1_react from "/node_modules/.vite/deps/react.js?v=test";\n'

    expect(bindViteReactLayoutEffect(source)).toContain(
      'const useEffect = __vite__cjsImport1_react["useEffect"]; const useLayoutEffect = __vite__cjsImport1_react["useLayoutEffect"];',
    )
  })

  it('fails closed when Vite omits or duplicates the React effect binding', () => {
    expect(() => bindViteReactLayoutEffect('const useEffect = otherShape.useEffect')).toThrow(
      'Expected one Vite React useEffect binding; found 0',
    )
    const binding = 'const useEffect = __vite__react["useEffect"];'
    expect(() => bindViteReactLayoutEffect(`${binding}\n${binding}`)).toThrow(
      'Expected one Vite React useEffect binding; found 2',
    )
  })

  it('samples only scalar values from the uniquely committed Board scene', () => {
    const source = `
useEffect(() => {
  previousSceneRef.current = boardScene
}, [boardScene])
`

    const transformed = instrumentCommittedBoardSceneProbe(source)
    expect(transformed.match(/__EIDO_RESIZE_REPLAY_SCENE__/g)).toHaveLength(1)
    expect(transformed).toContain('visibleCardCount: boardScene.visibleCards.length')
    expect(transformed).toContain('detailCardCount: boardScene.detailCards.length')
    expect(transformed).toContain(
      'visibleConnectionCount: boardScene.visibleConnections.length',
    )
    expect(transformed).toContain('useCanvasConnections: boardScene.useCanvasConnections')
    expect(transformed.indexOf('__EIDO_RESIZE_REPLAY_SCENE__')).toBeLessThan(
      transformed.indexOf('previousSceneRef.current = boardScene'),
    )
  })

  it('fails closed when the committed Board scene marker is missing or duplicated', () => {
    expect(() => instrumentCommittedBoardSceneProbe('const scene = boardScene')).toThrow(
      'Expected one committed Board scene marker; found 0',
    )
    const marker = 'previousSceneRef.current = boardScene'
    expect(() => instrumentCommittedBoardSceneProbe(`${marker}\n${marker}`)).toThrow(
      'Expected one committed Board scene marker; found 2',
    )
  })

  it('captures the exact terminal frame, endpoint offsets, state, and raw node handles', () => {
    const source = `
const ordinaryNode = reactFlowStore.getState().nodeLookup.get(frame.cardId)
const coordinator = createBoardResizeTerminalCoordinator({
  onTimeout(frame, state) {
    const node = reactFlowStore.getState().nodeLookup.get(frame.cardId)
    console.warn('[eido] resize terminal reconciliation timed out', { node })
  },
})
`

    const transformed = instrumentBoardResizeTerminalTimeout(source)
    expect(transformed.match(/recordTerminalTimeout/g)).toHaveLength(1)
    expect(transformed).toContain(
      'geometry: { position: { ...frame.geometry.position }, size: { ...frame.geometry.size } }',
    )
    expect(transformed).toContain(
      'endpointOffsets: frame.endpointOffsets ? { source: copyOffset(frame.endpointOffsets.source), target: copyOffset(frame.endpointOffsets.target) } : undefined',
    )
    expect(transformed).toContain('state: { graph: state.graph, node: state.node }')
    expect(transformed).toContain(
      'positionAbsolute: { ...node.internals.positionAbsolute }',
    )
    expect(transformed).toContain(
      'measured: { width: node.measured.width ?? null, height: node.measured.height ?? null }',
    )
    expect(transformed).toContain(
      'sourceHandles: copyHandles(node.internals.handleBounds?.source)',
    )
    expect(transformed).toContain(
      'targetHandles: copyHandles(node.internals.handleBounds?.target)',
    )
    expect(transformed).toContain(
      '({ id: id ?? null, type: type ?? null, nodeId: nodeId ?? null, x, y, width, height, position: position ?? null })',
    )
    expect(transformed.indexOf('recordTerminalTimeout')).toBeGreaterThan(
      transformed.indexOf('onTimeout(frame, state)'),
    )
    expect(transformed.indexOf('recordTerminalTimeout')).toBeLessThan(
      transformed.indexOf('console.warn'),
    )
  })

  it('fails closed when the terminal timeout anchor is missing or duplicated', () => {
    expect(() => instrumentBoardResizeTerminalTimeout('const state = readState(frame)')).toThrow(
      'Expected one Board resize terminal timeout block; found 0',
    )
    const timeout = `
onTimeout(frame, state) {
  const node = reactFlowStore.getState().nodeLookup.get(frame.cardId)
  console.warn('timeout')
}
`
    expect(() => instrumentBoardResizeTerminalTimeout(`${timeout}\n${timeout}`)).toThrow(
      'Expected one Board resize terminal timeout block; found 2',
    )
  })

  it('instruments only the scheduled-rAF coordinator read', () => {
    const source = `
const schedule = () => {
  scheduledFrame = requestFrame(() => {
    const frame = activeFrame
    const state = readState(frame)
    schedule()
  })
}
const unsubscribeTerminal = store.subscribeTerminal(start)
const unsubscribeState = subscribeState?.(() => {
  const state = readState(frame)
})
`

    const transformed = instrumentScheduledCoordinatorRead(source)
    expect(transformed.match(/recordCoordinatorSample/g)).toHaveLength(1)
    expect(transformed.indexOf('recordCoordinatorSample')).toBeLessThan(
      transformed.indexOf('const unsubscribeTerminal'),
    )
  })

  it('fails closed when the scheduled callback has more than one read', () => {
    const source = `
scheduledFrame = requestFrame(() => {
  const state = readState(frame)
  const state = readState(frame)
})
const unsubscribeTerminal = store.subscribeTerminal(start)
`
    expect(() => instrumentScheduledCoordinatorRead(source)).toThrow(
      'Expected one scheduled-rAF coordinator readState sample; found 2',
    )
  })
})
