const VITE_REACT_EFFECT_BINDING =
  /const useEffect = ([A-Za-z_$][\w$]*)\["useEffect"\];/g

/**
 * Adds a layout-effect binding to Vite's transformed CommonJS React import.
 *
 * Capture routes receive Vite output, not the authored TSX import. Keep this
 * fail-closed so a Vite interop-shape change stops evidence collection instead
 * of silently downgrading the synchronous commit probe.
 */
export function bindViteReactLayoutEffect(source: string) {
  const matches = [...source.matchAll(VITE_REACT_EFFECT_BINDING)]
  if (matches.length !== 1) {
    throw new Error(`Expected one Vite React useEffect binding; found ${matches.length}`)
  }
  const [marker, reactBinding] = matches[0]!
  return source.replace(
    marker,
    `${marker} const useLayoutEffect = ${reactBinding}["useLayoutEffect"];`,
  )
}

/**
 * Exposes the already-committed Board scene without re-running any planning.
 *
 * The probe intentionally copies only scalar counts and routing flags. Keeping
 * the anchor fail-closed makes a Board lifecycle change invalidate capture
 * rather than silently sampling an uncommitted or independently-derived scene.
 */
export function instrumentCommittedBoardSceneProbe(source: string) {
  const marker = 'previousSceneRef.current = boardScene'
  const occurrences = source.split(marker).length - 1
  if (occurrences !== 1) {
    throw new Error(`Expected one committed Board scene marker; found ${occurrences}`)
  }
  return source.replace(
    marker,
    [
      'globalThis.__EIDO_RESIZE_REPLAY_SCENE__ = {',
      '      visibleCardCount: boardScene.visibleCards.length,',
      '      detailCardCount: boardScene.detailCards.length,',
      '      visibleConnectionCount: boardScene.visibleConnections.length,',
      '      fullyDetailed: boardScene.fullyDetailed,',
      '      useCanvasConnections: boardScene.useCanvasConnections,',
      '      showConnections: boardScene.showConnections,',
      '      readingCardOpacity: boardScene.readingCardOpacity,',
      '      boardDetailTextWeight: boardScene.boardDetailTextWeight,',
      '    };',
      '    previousSceneRef.current = boardScene',
    ].join('\n'),
  )
}

/**
 * Captures the authoritative terminal frame and React Flow node only when the
 * bounded reconciliation loop times out. The route transform is deliberately
 * scoped to the unique onTimeout block: the same node lookup also appears in
 * the ordinary state reader, where sampling would perturb every settle frame.
 */
export function instrumentBoardResizeTerminalTimeout(source: string) {
  const timeoutAnchor = 'onTimeout(frame, state) {'
  const timeoutOccurrences = source.split(timeoutAnchor).length - 1
  if (timeoutOccurrences !== 1) {
    throw new Error(`Expected one Board resize terminal timeout block; found ${timeoutOccurrences}`)
  }

  const timeoutStart = source.indexOf(timeoutAnchor)
  const warningStart = source.indexOf('console.warn', timeoutStart)
  if (warningStart < 0) {
    throw new Error('Missing Board resize terminal timeout warning')
  }
  const nodeMarker = 'const node = reactFlowStore.getState().nodeLookup.get(frame.cardId)'
  const timeoutPrefix = source.slice(timeoutStart, warningStart)
  const nodeOccurrences = timeoutPrefix.split(nodeMarker).length - 1
  if (nodeOccurrences !== 1) {
    throw new Error(`Expected one timeout node lookup; found ${nodeOccurrences}`)
  }
  const nodeStart = source.indexOf(nodeMarker, timeoutStart)
  const lineEnd = source.indexOf('\n', nodeStart + nodeMarker.length)
  if (lineEnd < 0 || lineEnd >= warningStart) {
    throw new Error('Missing timeout node lookup line ending')
  }

  const statement = [
    '        {',
    '          const copyHandles = (handles) => (handles ?? []).map(({ id, type, nodeId, x, y, width, height, position }) => ({ id: id ?? null, type: type ?? null, nodeId: nodeId ?? null, x, y, width, height, position: position ?? null }))',
    '          const copyOffset = (offset) => offset ? { x: offset.x, y: offset.y } : undefined',
    '          globalThis.__EIDO_RESIZE_REPLAY_CAPTURE__?.recordTerminalTimeout({',
    '            frame: {',
    '              cardId: frame.cardId,',
    '              sessionId: frame.sessionId,',
    '              phase: frame.phase,',
    '              geometry: { position: { ...frame.geometry.position }, size: { ...frame.geometry.size } },',
    '              endpointOffsets: frame.endpointOffsets ? { source: copyOffset(frame.endpointOffsets.source), target: copyOffset(frame.endpointOffsets.target) } : undefined,',
    '            },',
    '            state: { graph: state.graph, node: state.node },',
    '            node: node ? {',
    '              positionAbsolute: { ...node.internals.positionAbsolute },',
    '              measured: { width: node.measured.width ?? null, height: node.measured.height ?? null },',
    '              sourceHandles: copyHandles(node.internals.handleBounds?.source),',
    '              targetHandles: copyHandles(node.internals.handleBounds?.target),',
    '            } : null,',
    '          })',
    '        }',
  ].join('\n')
  return `${source.slice(0, lineEnd + 1)}${statement}\n${source.slice(lineEnd + 1)}`
}

/** Injects evidence at the coordinator's scheduled-rAF read, never its state subscription. */
export function instrumentScheduledCoordinatorRead(source: string) {
  const scheduleAnchor = 'scheduledFrame = requestFrame(() => {'
  const anchorOccurrences = source.split(scheduleAnchor).length - 1
  if (anchorOccurrences !== 1) {
    throw new Error(
      `Expected one scheduled coordinator callback; found ${anchorOccurrences}`,
    )
  }
  const callbackStart = source.indexOf(scheduleAnchor)
  const subscriptionStart = source.indexOf('const unsubscribeTerminal', callbackStart)
  const readMarker = 'const state = readState(frame)'
  const scheduledCallback =
    subscriptionStart < 0 ? '' : source.slice(callbackStart, subscriptionStart)
  const scheduledReadOccurrences = scheduledCallback.split(readMarker).length - 1
  if (scheduledReadOccurrences !== 1) {
    throw new Error(
      `Expected one scheduled-rAF coordinator readState sample; found ${scheduledReadOccurrences}`,
    )
  }
  const readStart = source.indexOf(readMarker, callbackStart)
  if (readStart < 0 || subscriptionStart < 0 || readStart >= subscriptionStart) {
    throw new Error('Missing scheduled-rAF coordinator readState sample')
  }
  const lineEnd = source.indexOf('\n', readStart + readMarker.length)
  if (lineEnd < 0 || lineEnd >= subscriptionStart) {
    throw new Error('Missing scheduled-rAF coordinator readState line ending')
  }
  const statement = [
    '      {',
    '        const hotFrame = store.getSnapshot()',
    '        globalThis.__EIDO_RESIZE_REPLAY_CAPTURE__?.recordCoordinatorSample({',
    '          frame: { cardId: frame.cardId, sessionId: frame.sessionId, phase: frame.phase, geometry: { position: { ...frame.geometry.position }, size: { ...frame.geometry.size } } },',
    '          hotFrame: hotFrame ? { cardId: hotFrame.cardId, sessionId: hotFrame.sessionId, phase: hotFrame.phase, geometry: { position: { ...hotFrame.geometry.position }, size: { ...hotFrame.geometry.size } } } : null,',
    '          state: { graph: state.graph, node: state.node },',
    '          stableFrames,',
    '          matchingFramesBefore: matchingFrames,',
    '          absentNodeGraphFramesBefore: absentNodeGraphFrames,',
    '        })',
    '      }',
  ].join('\n')
  return `${source.slice(0, lineEnd + 1)}${statement}\n${source.slice(lineEnd + 1)}`
}
