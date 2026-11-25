import { expect, test, type CDPSession, type Page } from '@playwright/test'
import { execSync } from 'node:child_process'
import * as nodeFs from 'node:fs'
import os from 'node:os'
import { createRichCardBenchmarkBoard } from '../graph/perfFixtures'
import {
  IMAGE_RENDITION_CANDIDATE_BUDGETS,
  type ImageRenditionSnapshot,
} from '../shared/imageRenditions'
import {
  IMAGE_RENDITION_CANDIDATE_IMAGE_SPECS,
  IMAGE_RENDITION_CANDIDATE_CONTRACT,
  IMAGE_RENDITION_CANDIDATE_LIMITATIONS,
  adaptImageRenditionCandidateBoard,
  aggregateImageRenditionDocumentState,
  assertExactImageRenditionGalleryCaptionAfterCopy,
  assertExactImageRenditionGalleryCaptionCopy,
  assertNoImageRenditionBrowserErrors,
  assertNoImageRenditionResolverFailures,
  decodeExactImageRenditionsInDocument,
  diagnoseImageRenditionFailure,
  GALLERY_CLICK_TOPBAR_CLEARANCE_PX,
  galleryClickCameraAdjustment,
  imageRenditionRepeatedTraversalReady,
  publishImageRenditionCandidateArtifact,
  readImageRenditionGalleryProbe,
  readImageRenditionRepeatedTraversalProbe,
  recordImageRenditionConsoleError,
  recordImageRenditionPageError,
  runImageRenditionCandidateObservationWorkflow,
  selectExactImageRenditionGalleryCaption,
  waitForImageRenditionResolverCondition,
  type ImageRenditionAppProbe,
  type ImageCompressionSample,
  type ImageRenditionCandidateArtifact,
  type ImageRenditionCandidateReference,
  type ImageRenditionTraversal,
} from './imageRenditionCandidate'
import type { RichCardRawArtifact } from './richCardBenchmark'

const MODE = process.env.EIDO_IMAGE_RENDITION_MODE === 'probe' ? 'probe' : 'capture'
const ARTIFACT_PATH = process.env.EIDO_IMAGE_RENDITION_ARTIFACT ??
  'src/performance/baselines/imageRenditionCandidate.raw.json'
const TARGET = { boardX: 800, boardY: 2_350, zoom: 0.5 }
const AWAY = { boardX: 5_900, boardY: 1_400, zoom: 0.5 }
const BUDGETS = IMAGE_RENDITION_CANDIDATE_BUDGETS
const LIMITATION_TARGET = 'synthetic-alpha-square.png'

test(`${MODE} visibility-aware image rendition candidate`, async ({ page, browser }) => {
  test.setTimeout(MODE === 'probe' ? 4 * 60_000 : 15 * 60_000)
  if (MODE === 'capture') removeCandidatePublication()
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  const browserErrors: Pick<ImageRenditionAppProbe, 'consoleErrors' | 'pageErrors'> = {
    consoleErrors: [],
    pageErrors: [],
  }
  page.on('console', (message) => {
    if (message.type() === 'error') {
      recordImageRenditionConsoleError(browserErrors, {
        text: message.text(),
        location: message.location(),
      })
    }
  })
  page.on('pageerror', (error) => recordImageRenditionPageError(browserErrors, error.stack ?? error.message))
  try {
    await page.goto('/')
    await waitForCoreRuntime(page)
    assertNoImageRenditionBrowserErrors(browserErrors)
    await loadFixture(page)
    const canonicalFixtureBoard = createRichCardBenchmarkBoard()
    const candidateReferences = await generateCandidateFixtureReferences(page)
    const fixtureBoard = adaptImageRenditionCandidateBoard(canonicalFixtureBoard, candidateReferences)
    await preflightCandidateReferencesThroughBrowserRenderer(page, candidateReferences)
    await applyCandidateFixtureReferences(page, fixtureBoard)
    await setViewportForBoardPoint(page, TARGET)
    await waitForCandidateImages(page)
    const cdp = await page.context().newCDPSession(page)

    const fixtureImages = fixtureBoard.cards.flatMap((card) =>
      (card.assets ?? [])
        .filter((asset) => asset.kind === 'image')
        .map((asset, index) => ({ card, asset, index })),
    )
    expect(fixtureImages).toHaveLength(9)
    const canonicalFixtureImages = canonicalFixtureBoard.cards.flatMap((card) =>
      (card.assets ?? []).filter((asset) => asset.kind === 'image'),
    )
    expect(canonicalFixtureImages).toHaveLength(9)

    let boardBefore!: Awaited<ReturnType<typeof boardEvidence>>
    let pasteCompression!: ImageRenditionCandidateArtifact['pasteCompression']
    const traversalCount = MODE === 'probe' ? 1 : IMAGE_RENDITION_CANDIDATE_CONTRACT.minimumTraversals
    const traversals: ImageRenditionTraversal[] = []

    const workflow = await runImageRenditionCandidateObservationWorkflow({
      mode: MODE,
      observeStartup: async () => {
        const startup = await observeCandidateStartupLimitations(page, cdp)
        assertNoImageRenditionBrowserErrors(browserErrors)
        await assertResolverState(page, 'after startup')
        return startup
      },
      observeTraversals: async () => {
        await setViewportForBoardPoint(page, AWAY)
        boardBefore = await boardEvidence(page)
        pasteCompression = await measurePasteCompression(page)
        for (let index = 0; index < traversalCount; index += 1) {
          const cameraSpeed = IMAGE_RENDITION_CANDIDATE_CONTRACT.cameraSpeeds[index % 3]
          const warmth = index === 0 ? 'cold' as const : 'warm' as const
          const traversal = await measureTraversal(page, cdp, index + 1, cameraSpeed, warmth)
          traversals.push(traversal)
          assertNoImageRenditionBrowserErrors(browserErrors)
          assertNoImageRenditionResolverFailures(traversal.snapshot, `after traversal ${index + 1}`)
        }
      },
      activateGallery: async (measured) => measured ? measureGallery(page) : openGalleryForCopyProof(page),
      observeCopy: () => observeCandidateGalleryCaptionCopy(page, LIMITATION_TARGET),
    })
    const limitations = candidateLimitations(workflow.startup, workflow.copy)

    if (MODE === 'probe') {
      assertNoImageRenditionBrowserErrors(browserErrors)
      expect(traversals[0].blankReplacements).toBe(0)
      expect(traversals[0].snapshot.decodedBytes).toBeLessThanOrEqual(BUDGETS.maxDecodedBytes)
      expect(traversals[0].snapshot.renditionBytes).toBeLessThanOrEqual(BUDGETS.maxRenditionBytes)
      console.log('NON-EVIDENCE image rendition probe passed one bounded traversal; no artifact was written.')
      return
    }

    const gallery = workflow.gallery
    if (!gallery) throw new Error('Measured gallery activation did not produce gallery evidence.')
    assertNoImageRenditionBrowserErrors(browserErrors)
    await assertResolverState(page, 'after gallery')
    const boardAfter = await boardEvidence(page)
    const baseline = baselineEvidence()
    const sourceRunUrl = githubRunUrl()
    const artifact: ImageRenditionCandidateArtifact = {
      schemaVersion: 2,
      contractId: IMAGE_RENDITION_CANDIDATE_CONTRACT.id,
      candidate: {
        enabled: true,
        description: 'Purpose-sized renditions over candidate-only PNG/JPEG references; legacy SVG readability remains fallback-only and canonical #402 evidence stays unchanged.',
        productionDefaultChanged: false,
      },
      environment: {
        provider: process.env.GITHUB_ACTIONS === 'true' ? 'github-actions' : 'local-unmanaged',
        os: `${os.platform()} ${os.release()}`,
        cpu: os.cpus()[0]?.model ?? 'unknown',
        logicalCores: os.cpus().length,
        memoryBytes: os.totalmem(),
        browser: `Chromium ${browser.version()}`,
        node: process.version,
        commit: execSync('git rev-parse HEAD').toString().trim(),
        capturedAt: new Date().toISOString(),
      },
      capture: {
        commands: [
          'VITE_EIDO_IMAGE_RENDITION_CANDIDATE=1 EIDO_IMAGE_RENDITION_MODE=capture npx playwright test --config playwright.performance.config.ts src/performance/imageRenditionCandidate.perf.ts',
        ],
        runner: process.env.RUNNER_NAME ?? 'unmanaged-local-runner',
        ...(sourceRunUrl ? { sourceRunUrl } : {}),
      },
      limitations,
      budgets: BUDGETS,
      baseline,
      fixture: {
        id: IMAGE_RENDITION_CANDIDATE_CONTRACT.fixtureId,
        referencePolicy: 'Candidate-only PNG/JPEG references; legacy canonical SVG remains an authoritative fallback/readability case; canonical #402 evidence is unchanged.',
        referenceComparison: {
          canonical: {
            storedCompressedBytes: canonicalFixtureImages.reduce((total, asset) => total + asset.size, 0),
            mimeHistogram: imageMimeHistogram(canonicalFixtureImages),
          },
          candidate: {
            storedCompressedBytes: boardBefore.storedImageBytes,
            mimeHistogram: imageMimeHistogram(fixtureImages.map(({ asset }) => asset)),
          },
          storageAssessment: 'unmeasured-confounded',
        },
        imageCount: fixtureImages.length,
        cases: fixtureImages.map(({ asset, index }) => ({
          id: asset.id,
          sourceWidth: asset.width ?? 1,
          sourceHeight: asset.height ?? 1,
          alpha: IMAGE_RENDITION_CANDIDATE_IMAGE_SPECS.find((spec) => spec.assetId === asset.id)!.alpha,
          displayWidth: index % 3 === 0 ? 144 : 240,
          displayHeight: index % 3 === 0 ? 108 : 180,
        })),
        boardJsonBytesBefore: boardBefore.bytes,
        boardJsonBytesAfter: boardAfter.bytes,
        serializationMs: boardBefore.serializationMs,
        storedCompressedBytesBefore: boardBefore.storedImageBytes,
        storedCompressedBytesAfter: boardAfter.storedImageBytes,
      },
      pasteCompression,
      traversals,
      gallery,
      authoritative: {
        boardReferencesBefore: boardBefore.references,
        boardReferencesAfter: boardAfter.references,
        derivedReferenceLeaks: boardAfter.references.filter((reference) =>
          reference.startsWith('blob:') || /rendition|thumbnail/i.test(reference),
        ).length,
        aiCompatibilityTest: 'src/graph/cardAssetCompat.test.ts',
        exportCompatibilityTest: 'src/graph/cardAssetCompat.test.ts',
      },
    }

    await publishImageRenditionCandidateArtifact({
      artifact,
      artifactPath: ARTIFACT_PATH,
      awaitBrowserBarrier: () => waitForFrames(page, 2),
      assertBrowserState: () => assertNoImageRenditionBrowserErrors(browserErrors),
      assertResolverState: () => assertResolverState(page, 'immediately before publication'),
    })
    console.log(`Image rendition raw artifact: ${ARTIFACT_PATH}`)
  } catch (cause) {
    if (MODE === 'capture') removeCandidatePublication()
    throw await diagnoseImageRenditionFailure(
      cause,
      () => readImageRenditionAppProbe(page, browserErrors),
    )
  }
})

async function waitForCoreRuntime(page: Page) {
  await page.waitForFunction(() => {
    const graph = (window as unknown as {
      __eido?: { getState: () => { hydrated: boolean } }
    }).__eido
    return Boolean(document.querySelector('#root')?.childElementCount) &&
      Boolean(window.__EIDO_PERF__) &&
      graph?.getState().hydrated === true &&
      Boolean((window as unknown as { __EIDO_SET_VIEWPORT__?: unknown }).__EIDO_SET_VIEWPORT__)
  }, undefined, { timeout: 30_000 })
}

async function loadFixture(page: Page) {
  const loaded = await page.evaluate(() => window.__EIDO_PERF__?.loadFixture('richCardBenchmark'))
  expect(loaded).toMatchObject({ cards: 131, outputs: 2 })
}

async function generateCandidateFixtureReferences(
  page: Page,
): Promise<ImageRenditionCandidateReference[]> {
  return page.evaluate((specs) => {
    const references = specs.map((spec, index) => {
      const canvas = document.createElement('canvas')
      canvas.width = spec.width
      canvas.height = spec.height
      const context = canvas.getContext('2d')
      if (!context) throw new Error(`Candidate fixture canvas unavailable for ${spec.assetId}`)
      context.clearRect(0, 0, spec.width, spec.height)
      context.fillStyle = spec.alpha
        ? `rgba(${54 + index * 7}, 112, 190, 0.55)`
        : `rgb(${120 + index * 9}, 92, 48)`
      context.fillRect(0, 0, spec.width, spec.height)
      context.fillStyle = spec.alpha ? 'rgba(247, 211, 107, 0.68)' : 'rgb(37, 75, 101)'
      context.fillRect(
        Math.floor(spec.width * 0.2),
        Math.floor(spec.height * 0.2),
        Math.max(1, Math.floor(spec.width * 0.6)),
        Math.max(1, Math.floor(spec.height * 0.6)),
      )
      const dataUrl = spec.mimeType === 'image/png'
        ? canvas.toDataURL('image/png')
        : canvas.toDataURL('image/jpeg', 0.82)
      return { assetId: spec.assetId, mimeType: spec.mimeType, dataUrl }
    })
    return references
  }, IMAGE_RENDITION_CANDIDATE_IMAGE_SPECS)
}

async function preflightCandidateReferencesThroughBrowserRenderer(
  page: Page,
  references: readonly ImageRenditionCandidateReference[],
) {
  await page.evaluate(async ({ candidateReferences, specs }) => {
    const loadModule = new Function(
      'return import("/src/shared/imageRenditions.ts")',
    ) as () => Promise<{
      browserImageRenditionRender: (request: {
        asset: {
          id: string
          kind: 'image'
          name: string
          mimeType: string
          dataUrl: string
          size: number
          createdAt: string
          width: number
          height: number
        }
        referenceIdentity: string
        key: string
        purpose: 'card-thumbnail'
        width: number
        height: number
      }) => Promise<{
        src: string
        width: number
        height: number
        revoke?: () => void
      }>
    }>
    const { browserImageRenditionRender } = await loadModule()
    for (const reference of candidateReferences) {
      const spec = specs.find((candidate) => candidate.assetId === reference.assetId)
      if (!spec) throw new Error(`Missing candidate preflight spec for ${reference.assetId}`)
      let rendered: Awaited<ReturnType<typeof browserImageRenditionRender>> | undefined
      try {
        rendered = await browserImageRenditionRender({
          asset: {
            id: reference.assetId,
            kind: 'image',
            name: `${reference.assetId}.${reference.mimeType === 'image/png' ? 'png' : 'jpg'}`,
            mimeType: reference.mimeType,
            dataUrl: reference.dataUrl,
            size: reference.dataUrl.length,
            createdAt: '2026-07-15T00:00:00.000Z',
            width: spec.width,
            height: spec.height,
          },
          referenceIdentity: `candidate-preflight:${reference.assetId}`,
          key: `candidate-preflight:${reference.assetId}:card-thumbnail:240x180`,
          purpose: 'card-thumbnail',
          width: 240,
          height: 180,
        })
        const response = await fetch(rendered.src)
        const bitmap = await createImageBitmap(await response.blob())
        try {
          if (bitmap.width !== rendered.width || bitmap.height !== rendered.height) {
            throw new Error(`Candidate renderer output dimensions changed for ${reference.assetId}`)
          }
        } finally {
          bitmap.close()
        }
      } finally {
        rendered?.revoke?.()
      }
    }
  }, { candidateReferences: references, specs: IMAGE_RENDITION_CANDIDATE_IMAGE_SPECS })
}

async function applyCandidateFixtureReferences(
  page: Page,
  adaptedBoard: ReturnType<typeof createRichCardBenchmarkBoard>,
) {
  const replacements = adaptedBoard.cards.flatMap((card) => card.assets ?? [])
    .filter((asset) => asset.kind === 'image')
    .map((asset) => ({
      id: asset.id,
      mimeType: asset.mimeType,
      dataUrl: asset.dataUrl,
      size: asset.size,
      compression: asset.compression,
    }))
  await page.evaluate((candidateAssets) => {
    const graph = (window as unknown as {
      __eido?: {
        getState: () => {
          cards: Array<{
            id: string
            assets?: Array<{
              id: string
              kind: string
              name: string
              mimeType: string
              dataUrl: string
              size: number
              width?: number
              height?: number
              originalMimeType?: string
              compression?: 'compressed'
            }>
          }>
        }
        setState: (partial: { cards: unknown[] }) => void
      }
    }).__eido
    if (!graph) throw new Error('Missing graph runtime for candidate fixture adaptation')
    const replacementById = new Map(candidateAssets.map((asset) => [asset.id, asset]))
    if (replacementById.size !== 9 || candidateAssets.length !== 9) {
      throw new Error('Candidate fixture apply requires exactly nine unique image references')
    }
    const state = graph.getState()
    const liveImageIds = state.cards.flatMap((card) => card.assets ?? [])
      .filter((asset) => asset.kind === 'image')
      .map((asset) => asset.id)
    if (
      liveImageIds.length !== 9 || new Set(liveImageIds).size !== 9 ||
      liveImageIds.some((id) => !replacementById.has(id))
    ) {
      throw new Error('Loaded canonical fixture does not match the exact candidate image asset set')
    }
    graph.setState({
      cards: state.cards.map((card) => {
        if (!card.assets?.some((asset) => replacementById.has(asset.id))) return card
        return {
          ...card,
          assets: card.assets.map((asset) => {
            const replacement = replacementById.get(asset.id)
            return replacement
              ? {
                  ...asset,
                  ...replacement,
                  name: asset.name.replace(/\.[^.]+$/, replacement.mimeType === 'image/png' ? '.png' : '.jpg'),
                }
              : asset
          }),
        }
      }),
    })
  }, replacements)
  await waitForFrames(page, 2)
}

async function waitForCandidateImages(page: Page, timeout = 60_000) {
  const selector =
    '[data-id^="benchmark-images-"] img[data-image-rendition-purpose][data-image-rendition-derived="true"]'
  const deadline = Date.now() + timeout
  while (true) {
    const [runtime, readiness] = await Promise.all([
      page.evaluate(() => {
        const candidate = (window as unknown as {
          __EIDO_IMAGE_RENDITION_CANDIDATE__?: {
            enabled: boolean
            snapshot: () => ImageRenditionSnapshot
          }
        }).__EIDO_IMAGE_RENDITION_CANDIDATE__
        const snapshot = candidate?.snapshot()
        return {
          candidateEnabled: candidate?.enabled === true,
          detailNodeCount: document.querySelectorAll('.react-flow__node').length,
          failures: snapshot?.failures ?? 0,
          requestsByPurpose: snapshot?.requestsByPurpose,
        }
      }),
      page.evaluate(aggregateImageRenditionDocumentState, undefined),
    ])
    if (runtime.failures > 0) {
      throw new Error(
        `Image rendition resolver failed before readiness; failures=${runtime.failures}; ` +
        `requestsByPurpose=${JSON.stringify(runtime.requestsByPurpose ?? {})}`,
      )
    }
    if (
      runtime.candidateEnabled && runtime.detailNodeCount > 0 &&
      readiness.purposeMarkedImageCount === 9 && readiness.derivedImageCount === 9 &&
      readiness.decodedReadyImageCount === 9
    ) break
    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out waiting for exactly nine candidate images; ` +
        `purposeMarked=${readiness.purposeMarkedImageCount}; derived=${readiness.derivedImageCount}; ` +
        `decodedReady=${readiness.decodedReadyImageCount}`,
      )
    }
    await page.waitForTimeout(50)
  }
  await page.evaluate(decodeExactImageRenditionsInDocument, {
    selector,
    expectedCount: 9,
  })
}

async function observeCandidateStartupLimitations(
  page: Page,
  cdp: CDPSession,
): Promise<{ target: string; found: true; matchingNodes: number }> {
  const target = LIMITATION_TARGET
  const found = await page.evaluate((targetName) => {
    const browserWindow = window as unknown as { find?: (text: string) => boolean }
    return browserWindow.find?.(targetName) === true
  }, target)
  if (!found) throw new Error(`Synthetic visible asset-name search did not find ${target}.`)

  const copyProbeSentinel = `eido-image-rendition-copy-precondition-${Date.now()}`
  await page.evaluate(async (sentinel) => {
    await navigator.clipboard.writeText(sentinel)
    const preconditioned = await navigator.clipboard.readText()
    if (preconditioned !== sentinel) {
      throw new Error('Candidate clipboard precondition was not readable through the granted permission.')
    }
  }, copyProbeSentinel)

  await cdp.send('Accessibility.enable')
  const tree = (await cdp.send('Accessibility.getFullAXTree')) as {
    nodes?: Array<{ name?: { value?: string }; role?: { value?: string } }>
  }
  const matchingNodes = (tree.nodes ?? []).filter(
    (node) => node.role?.value === 'image' && node.name?.value === target,
  ).length
  if (matchingNodes <= 0) throw new Error(`Synthetic image AX role/name match missing for ${target}.`)

  return { target, found: true, matchingNodes }
}

async function observeCandidateGalleryCaptionCopy(page: Page, target: string) {
  let intendedText = ''
  let copiedText = ''
  try {
    intendedText = await page.evaluate(selectExactImageRenditionGalleryCaption, target)
    await page.keyboard.press(os.platform() === 'darwin' ? 'Meta+C' : 'Control+C')
    copiedText = await page.evaluate(() => navigator.clipboard.readText())
    await page.evaluate(assertExactImageRenditionGalleryCaptionAfterCopy, target)
    assertExactImageRenditionGalleryCaptionCopy(target, intendedText, copiedText)
  } finally {
    await page.evaluate(() => window.getSelection()?.removeAllRanges())
  }
  return { intendedText, copiedText }
}

function candidateLimitations(
  startup: Awaited<ReturnType<typeof observeCandidateStartupLimitations>>,
  copy: Awaited<ReturnType<typeof observeCandidateGalleryCaptionCopy>>,
): ImageRenditionCandidateArtifact['limitations'] {
  return {
    preAuthorizedSacrifice: false,
    search: {
      status: 'observed',
      target: startup.target,
      found: startup.found,
      method: IMAGE_RENDITION_CANDIDATE_LIMITATIONS.search.method,
      unmeasured: [...IMAGE_RENDITION_CANDIDATE_LIMITATIONS.search.unmeasured],
    },
    copy: {
      status: 'observed',
      intendedText: copy.intendedText,
      copiedText: copy.copiedText,
      method: IMAGE_RENDITION_CANDIDATE_LIMITATIONS.copy.method,
      unmeasured: [...IMAGE_RENDITION_CANDIDATE_LIMITATIONS.copy.unmeasured],
    },
    accessibility: {
      status: 'observed',
      role: 'image',
      expectedName: startup.target,
      matchingNodes: startup.matchingNodes,
      method: IMAGE_RENDITION_CANDIDATE_LIMITATIONS.accessibility.method,
      unmeasured: [...IMAGE_RENDITION_CANDIDATE_LIMITATIONS.accessibility.unmeasured],
    },
  }
}

async function readImageRenditionAppProbe(
  page: Page,
  browserErrors: Pick<ImageRenditionAppProbe, 'consoleErrors' | 'pageErrors'>,
): Promise<ImageRenditionAppProbe> {
  const [state, imageState] = await Promise.all([
    page.evaluate(() => {
      const candidate = (window as unknown as {
        __EIDO_IMAGE_RENDITION_CANDIDATE__?: {
          enabled: boolean
          snapshot: () => ImageRenditionSnapshot
        }
      }).__EIDO_IMAGE_RENDITION_CANDIDATE__
      const graph = (window as unknown as {
        __eido?: { getState: () => { hydrated: boolean } }
      }).__eido
      const snapshot = candidate?.snapshot()
      return {
        rootChildCount: document.querySelector('#root')?.childElementCount ?? 0,
        performanceRuntime: Boolean(window.__EIDO_PERF__),
        graphRuntime: graph?.getState().hydrated === true,
        viewportRuntime: Boolean((window as unknown as { __EIDO_SET_VIEWPORT__?: unknown }).__EIDO_SET_VIEWPORT__),
        candidateRuntimePresent: Boolean(candidate),
        candidateEnabled: candidate?.enabled === true,
        detailNodeCount: document.querySelectorAll('.react-flow__node').length,
        overviewCardCount: Number(
          document.querySelector<HTMLElement>('[data-board-overview-layer]')?.dataset.renderedCardCount ?? 0,
        ),
        resolverFailures: snapshot?.failures ?? 0,
        resolverRequestsByPurpose: snapshot?.requestsByPurpose ?? {
          'card-thumbnail': 0,
          'passive-card': 0,
          'active-card': 0,
          'gallery-thumbnail': 0,
          gallery: 0,
        },
      }
    }),
    page.evaluate(aggregateImageRenditionDocumentState, undefined),
  ])
  return { ...state, ...imageState, ...browserErrors }
}

async function setViewportForBoardPoint(
  page: Page,
  target: { boardX: number; boardY: number; zoom: number },
) {
  await page.evaluate(({ boardX, boardY, zoom }) => {
    const flow = document.querySelector('.react-flow')
    const rect = flow?.getBoundingClientRect()
    const setViewport = (window as unknown as {
      __EIDO_SET_VIEWPORT__?: (value: { x: number; y: number; zoom: number }) => void
    }).__EIDO_SET_VIEWPORT__
    if (!rect || !setViewport) throw new Error('Missing Eido viewport runtime')
    setViewport({
      x: rect.left + rect.width / 2 - boardX * zoom,
      y: rect.top + rect.height / 2 - boardY * zoom,
      zoom,
    })
  }, target)
  await waitForFrames(page, 2)
}

async function moveToImageCluster(
  page: Page,
  cameraSpeed: ImageRenditionTraversal['cameraSpeed'],
) {
  if (cameraSpeed === 'settled') {
    await setViewportForBoardPoint(page, TARGET)
    return
  }
  await page.evaluate(() => window.dispatchEvent(new WheelEvent('wheel', { deltaY: 80 })))
  if (cameraSpeed === 'fast-pan') {
    await setViewportForBoardPoint(page, TARGET)
  } else {
    for (let step = 1; step <= 6; step += 1) {
      const ratio = step / 6
      await setViewportForBoardPoint(page, {
        boardX: AWAY.boardX + (TARGET.boardX - AWAY.boardX) * ratio,
        boardY: AWAY.boardY + (TARGET.boardY - AWAY.boardY) * ratio,
        zoom: TARGET.zoom,
      })
    }
  }
  await page.waitForTimeout(220)
}

async function measureTraversal(
  page: Page,
  cdp: CDPSession,
  repetition: number,
  cameraSpeed: ImageRenditionTraversal['cameraSpeed'],
  warmth: ImageRenditionTraversal['warmth'],
): Promise<ImageRenditionTraversal> {
  const before = await candidateSnapshot(page)
  await beginBlankObserver(page)
  const trace = await beginTrace(cdp)
  const startedAt = performance.now()
  await moveToImageCluster(page, cameraSpeed)
  await waitForImageRenditionResolverCondition({
    stage: 'repeated traversal image readiness',
    timeoutMs: 90_000,
    readProbe: () => page.evaluate(readImageRenditionRepeatedTraversalProbe, undefined),
    isReady: imageRenditionRepeatedTraversalReady,
  })
  const readinessMs = performance.now() - startedAt
  const imageButtons = page.locator('[data-id^="benchmark-images-"] .card-attachment-open')
  const buttonCount = await imageButtons.count()
  for (let index = 0; index < buttonCount; index += 1) await imageButtons.nth(index).focus()
  await waitForImageRenditionResolverCondition({
    stage: 'active-card request and eviction readiness',
    timeoutMs: 90_000,
    readProbe: async () => {
      const snapshot = await candidateSnapshot(page)
      return {
        snapshot,
        value: {
          activeCardRequests: snapshot.requestsByPurpose['active-card'],
          evictions: snapshot.evictions,
        },
      }
    },
    isReady: (value) => value.activeCardRequests >= 9 && value.evictions > 0,
  })
  await waitForFrames(page, 2)
  const traceEvents = await trace.stop()
  const atTarget = await candidateSnapshot(page)
  const blankReplacements = await endBlankObserver(page)
  await setViewportForBoardPoint(page, AWAY)
  await page.waitForTimeout(220)
  const afterAway = await candidateSnapshot(page)
  return {
    repetition,
    cameraSpeed,
    warmth,
    durationMs: round(performance.now() - startedAt),
    firstDecodeMs: round(Math.max(0, atTarget.decodeMs - before.decodeMs)),
    paintCompositeMs: round(traceDurationMs(traceEvents, ['Paint', 'CompositeLayers'])),
    readinessMs: round(readinessMs),
    cacheGrowthBytes: Math.max(
      0,
      afterAway.decodedBytes + afterAway.renditionBytes - before.decodedBytes - before.renditionBytes,
    ),
    blankReplacements,
    offscreenSharperRenders: Math.max(0, afterAway.misses - atTarget.misses),
    snapshot: afterAway,
  }
}

async function candidateSnapshot(page: Page): Promise<ImageRenditionSnapshot> {
  return page.evaluate(() => {
    const candidate = (window as unknown as {
      __EIDO_IMAGE_RENDITION_CANDIDATE__?: { snapshot: () => ImageRenditionSnapshot }
    }).__EIDO_IMAGE_RENDITION_CANDIDATE__
    if (!candidate) throw new Error('Missing image rendition candidate runtime')
    return candidate.snapshot()
  })
}

async function assertResolverState(page: Page, stage: string) {
  assertNoImageRenditionResolverFailures(await candidateSnapshot(page), stage)
}

function removeCandidatePublication() {
  const rmSync = (nodeFs as unknown as {
    rmSync: (file: string, options: { force: true }) => void
  }).rmSync
  rmSync(ARTIFACT_PATH, { force: true })
  rmSync(`${ARTIFACT_PATH}.tmp`, { force: true })
}

async function beginBlankObserver(page: Page) {
  await page.evaluate(() => {
    const state: { blank: number; observer?: MutationObserver } = { blank: 0 }
    const inspect = () => {
      for (const image of document.querySelectorAll<HTMLImageElement>(
        '[data-id^="benchmark-images-"] img[data-image-rendition-purpose]',
      )) {
        if (!image.getAttribute('src')) state.blank += 1
      }
    }
    const observer = new MutationObserver(inspect)
    state.observer = observer
    observer.observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['src'] })
    inspect()
    ;(window as unknown as { __EIDO_IMAGE_BLANK_OBSERVER__?: typeof state })
      .__EIDO_IMAGE_BLANK_OBSERVER__ = state
  })
}

async function endBlankObserver(page: Page): Promise<number> {
  return page.evaluate(() => {
    const state = (window as unknown as {
      __EIDO_IMAGE_BLANK_OBSERVER__?: { blank: number; observer: MutationObserver }
    }).__EIDO_IMAGE_BLANK_OBSERVER__
    state?.observer.disconnect()
    return state?.blank ?? 0
  })
}

async function activateGallery(page: Page, measured: boolean) {
  await setViewportForBoardPoint(page, TARGET)
  const card = page.locator('.react-flow__node[data-id="benchmark-images-alpha"]')
  const before = await card.boundingBox()
  if (!before) throw new Error('Missing image Card before gallery activation')
  const open = card.locator('.card-attachment-open').first()
  await open.focus()
  const beforeClick = await moveGalleryAffordanceBelowTopbar(page)
  console.log(`GALLERY_CLICK real locator.click follows focus preactivation; ${formatGalleryClickGeometry(beforeClick)}`)
  const startedAt = measured ? performance.now() : undefined
  try {
    await open.click({ timeout: 5_000 })
  } catch (cause) {
    const failure = new Error(
      `Gallery click did not complete within 5000ms after focus preactivation and camera adjustment. ${formatGalleryClickGeometry(beforeClick)}`,
    ) as Error & { cause?: unknown }
    failure.cause = cause
    throw failure
  }
  await waitForImageRenditionResolverCondition({
    stage: 'gallery derived and decoded readiness',
    timeoutMs: 90_000,
    readProbe: () => page.evaluate(readImageRenditionGalleryProbe, undefined),
    isReady: (value) => value.derived && value.decodedReady,
  })
  const settledReadyMs = startedAt === undefined ? undefined : performance.now() - startedAt
  const after = await card.boundingBox()
  if (!after) throw new Error('Missing image Card after gallery activation')
  if (settledReadyMs === undefined) return undefined
  return {
    activationMs: round(settledReadyMs),
    settledReadyMs: round(settledReadyMs),
    cardBoundsBefore: { width: round(before.width), height: round(before.height) },
    cardBoundsAfter: { width: round(after.width), height: round(after.height) },
    purpose: 'gallery' as const,
    derived: true,
  }
}

async function measureGallery(page: Page): Promise<ImageRenditionCandidateArtifact['gallery']> {
  const gallery = await activateGallery(page, true)
  if (!gallery) throw new Error('Measured gallery activation unexpectedly omitted timing evidence.')
  return gallery
}

async function openGalleryForCopyProof(page: Page) {
  await activateGallery(page, false)
}

async function moveGalleryAffordanceBelowTopbar(page: Page) {
  const geometry = await page.evaluate(() => {
    const button = document.querySelector<HTMLElement>(
      '.react-flow__node[data-id="benchmark-images-alpha"] .card-attachment-open',
    )
    const topbar = document.querySelector<HTMLElement>('.topbar')
    const client = document.querySelector<HTMLElement>('.react-flow')
    const viewport = document.querySelector<HTMLElement>('.react-flow__viewport')
    const setViewport = (window as unknown as {
      __EIDO_SET_VIEWPORT__?: (value: { x: number; y: number; zoom: number }) => void
    }).__EIDO_SET_VIEWPORT__
    if (!button || !topbar || !client || !viewport || !setViewport) {
      throw new Error('Missing gallery button, topbar, React Flow client, viewport, or camera setter.')
    }
    const transform = getComputedStyle(viewport).transform
    const matrix = /^matrix\(([^)]+)\)$/.exec(transform)?.[1].split(',').map(Number)
    if (!matrix || matrix.length !== 6 || matrix.some((value) => !Number.isFinite(value))) {
      throw new Error(`Cannot read React Flow camera matrix: ${transform}`)
    }
    const rect = (element: Element) => {
      const value = element.getBoundingClientRect()
      return { x: value.x, y: value.y, width: value.width, height: value.height }
    }
    const buttonRect = rect(button)
    const point = document.elementFromPoint(
      buttonRect.x + buttonRect.width / 2,
      buttonRect.y + buttonRect.height / 2,
    )
    return {
      button: buttonRect,
      topbar: rect(topbar),
      client: rect(client),
      camera: { x: matrix[4], y: matrix[5], zoom: matrix[0] },
      pointTarget: point instanceof HTMLElement ? `${point.tagName}.${point.className}` : point?.nodeName ?? 'none',
    }
  })
  const adjustment = galleryClickCameraAdjustment(geometry)
  if (!adjustment) return { ...geometry, adjustment: null }
  await page.evaluate((camera) => {
    const setViewport = (window as unknown as {
      __EIDO_SET_VIEWPORT__?: (value: { x: number; y: number; zoom: number }) => void
    }).__EIDO_SET_VIEWPORT__
    if (!setViewport) throw new Error('Missing Eido viewport runtime during gallery camera adjustment')
    setViewport(camera)
  }, adjustment.camera)
  await waitForFrames(page, 2)
  const after = await page.evaluate(() => {
    const button = document.querySelector<HTMLElement>(
      '.react-flow__node[data-id="benchmark-images-alpha"] .card-attachment-open',
    )
    const topbar = document.querySelector<HTMLElement>('.topbar')
    if (!button || !topbar) throw new Error('Missing gallery button or topbar after camera adjustment.')
    const buttonRect = button.getBoundingClientRect()
    const topbarRect = topbar.getBoundingClientRect()
    const point = document.elementFromPoint(
      buttonRect.x + buttonRect.width / 2,
      buttonRect.y + buttonRect.height / 2,
    )
    return {
      button: { x: buttonRect.x, y: buttonRect.y, width: buttonRect.width, height: buttonRect.height },
      topbar: { x: topbarRect.x, y: topbarRect.y, width: topbarRect.width, height: topbarRect.height },
      pointTarget: point instanceof HTMLElement ? `${point.tagName}.${point.className}` : point?.nodeName ?? 'none',
    }
  })
  if (after.button.y < after.topbar.y + after.topbar.height + GALLERY_CLICK_TOPBAR_CLEARANCE_PX) {
    throw new Error(`Gallery camera adjustment left the affordance under the topbar. ${formatGalleryClickGeometry({ ...geometry, adjustment, after })}`)
  }
  return { ...geometry, adjustment, after }
}

function formatGalleryClickGeometry(value: unknown) {
  return JSON.stringify(value)
}

async function boardEvidence(page: Page) {
  return page.evaluate(() => {
    const graph = (window as unknown as {
      __eido?: {
        getState: () => {
          cards: Array<{ assets?: Array<{ kind: string; dataUrl: string; size: number }> }>
          connections: unknown[]
          outputs: unknown[]
          runs: unknown[]
        }
      }
    }).__eido
    if (!graph) throw new Error('Missing graph runtime')
    const state = graph.getState()
    const board = {
      version: 1,
      cards: state.cards,
      connections: state.connections,
      outputs: state.outputs,
      runs: state.runs,
    }
    const startedAt = performance.now()
    const serialized = JSON.stringify(board)
    const serializationMs = performance.now() - startedAt
    const images = state.cards.flatMap((card) => card.assets ?? []).filter((asset) => asset.kind === 'image')
    return {
      bytes: new TextEncoder().encode(serialized).byteLength,
      serializationMs: Math.round(serializationMs * 100) / 100,
      references: images.map((asset) => asset.dataUrl),
      storedImageBytes: images.reduce((total, image) => total + image.size, 0),
    }
  })
}

function imageMimeHistogram(images: ReadonlyArray<{ mimeType: string }>) {
  const histogram: Record<string, number> = {}
  for (const image of images) histogram[image.mimeType] = (histogram[image.mimeType] ?? 0) + 1
  return histogram
}

async function measurePasteCompression(
  page: Page,
): Promise<ImageRenditionCandidateArtifact['pasteCompression']> {
  return page.evaluate(async () => {
    const loadModule = new Function(
      'return import("/src/shared/imageCompression.ts")',
    ) as () => Promise<{
      compressImage: (
        file: File,
        codec?: unknown,
        instrumentation?: { onComplete: (metrics: Omit<ImageCompressionSample, 'id' | 'alpha'>) => void },
      ) => Promise<{ dataUrl: string }>
    }>
    const { compressImage } = await loadModule()
    const cases = [
      { id: 'alpha-1600x1200', width: 1600, height: 1200, alpha: true, seed: 3 },
      { id: 'opaque-2048x2048', width: 2048, height: 2048, alpha: false, seed: 7 },
      { id: 'alpha-640x360', width: 640, height: 360, alpha: true, seed: 11 },
    ]
    const samples: ImageCompressionSample[] = []
    const references: string[] = []
    for (const sample of cases) {
      const canvas = document.createElement('canvas')
      canvas.width = sample.width
      canvas.height = sample.height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Synthetic paste canvas unavailable')
      context.fillStyle = sample.alpha ? 'rgba(54, 112, 190, 0.55)' : '#d97732'
      context.fillRect(0, 0, sample.width, sample.height)
      for (let index = 0; index < 24; index += 1) {
        context.fillStyle = sample.alpha
          ? `rgba(${(index * 31 + sample.seed) % 255}, 190, 90, 0.62)`
          : `rgb(${(index * 31 + sample.seed) % 255}, 90, 170)`
        context.fillRect(
          (index * 83 + sample.seed) % sample.width,
          (index * 47 + sample.seed) % sample.height,
          Math.max(8, sample.width / 12),
          Math.max(8, sample.height / 14),
        )
      }
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (value) => value ? resolve(value) : reject(new Error('Synthetic paste encode failed')),
          'image/png',
        ),
      )
      const file = new File([blob], `${sample.id}.png`, { type: 'image/png' })
      let metrics: Omit<ImageCompressionSample, 'id' | 'alpha'> | undefined
      const result = await compressImage(file, undefined, {
        onComplete: (value) => { metrics = value },
      })
      if (!metrics) throw new Error(`Missing compression metrics for ${sample.id}`)
      samples.push({
        ...metrics,
        id: sample.id,
        alpha: sample.alpha,
        width: sample.width,
        height: sample.height,
      })
      references.push(result.dataUrl)
    }
    const serializationStart = performance.now()
    const serialized = JSON.stringify({ references })
    return {
      samples,
      serializationMs: Math.round((performance.now() - serializationStart) * 100) / 100,
      serializedBytes: new TextEncoder().encode(serialized).byteLength,
    }
  })
}

function baselineEvidence(): ImageRenditionCandidateArtifact['baseline'] {
  const artifact = JSON.parse(
    nodeFs.readFileSync('src/performance/baselines/richCardBaseline.raw.json', 'utf8'),
  ) as RichCardRawArtifact
  const cold = artifact.runs.filter((run) => run.scenarioId === 'cold-image-traversal')
  const warm = artifact.runs.filter((run) => run.scenarioId === 'warm-image-revisit')
  return {
    commit: artifact.environment.commit,
    storedCompressedBytes: artifact.fixture.storedImageBytes,
    decodedPixelEstimateBytes: artifact.fixture.decodedPixelEstimateBytes,
    coldDecodeMs: median(cold.map((run) => run.images.decodeMs ?? 0)),
    warmDecodeMs: median(warm.map((run) => run.images.decodeMs ?? 0)),
    coldPaintCompositeMs: median(cold.map((run) => run.paintCompositeMs ?? 0)),
    warmPaintCompositeMs: median(warm.map((run) => run.paintCompositeMs ?? 0)),
  }
}

async function beginTrace(cdp: CDPSession) {
  const events: Array<{ name?: string; dur?: number }> = []
  const onData = (event: { value?: Array<{ name?: string; dur?: number }> }) => events.push(...(event.value ?? []))
  cdp.on('Tracing.dataCollected', onData)
  await cdp.send('Tracing.start', {
    categories: 'devtools.timeline,disabled-by-default-devtools.timeline.frame',
    options: 'sampling-frequency=10000',
  })
  return {
    async stop() {
      const complete = new Promise<void>((resolve) => cdp.once('Tracing.tracingComplete', () => resolve()))
      await cdp.send('Tracing.end')
      await complete
      cdp.off('Tracing.dataCollected', onData)
      return events
    },
  }
}

function traceDurationMs(events: Array<{ name?: string; dur?: number }>, names: string[]) {
  return events.reduce(
    (total, event) => total + (event.name && names.includes(event.name) ? (event.dur ?? 0) / 1_000 : 0),
    0,
  )
}

async function waitForFrames(page: Page, count: number) {
  await page.evaluate((frames) => new Promise<void>((resolve) => {
    let remaining = frames
    const step = () => {
      remaining -= 1
      if (remaining <= 0) resolve()
      else requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }), count)
}

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

function round(value: number) {
  return Math.round(value * 100) / 100
}

function githubRunUrl() {
  const server = process.env.GITHUB_SERVER_URL
  const repository = process.env.GITHUB_REPOSITORY
  const runId = process.env.GITHUB_RUN_ID
  return server && repository && runId ? `${server}/${repository}/actions/runs/${runId}` : undefined
}
