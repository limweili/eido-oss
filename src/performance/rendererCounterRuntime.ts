import {
  boardSceneNumericCountersSnapshot,
} from '../canvas/boardScene'
import { OVERSIZE_PASSIVE_CARD_LIMIT, PASSIVE_CARD_LIMIT } from '../canvas/cardResidency'
import {
  IMAGE_RENDITION_BUDGETS,
  readImageRenditionNumericSnapshot,
} from '../shared/imageRenditions'

export type RendererCounterSnapshot = Readonly<{
  residentRichCards: number
  passiveCards: number
  oversizePassiveCards: number
  oversizePassiveCardLimit: number
  passiveCardLimit: number
  liveCards: number
  boardDetailTextWeight: number
  admittedDetailTextWeight: number
  oversizePassiveTextWeight: number
  detailTextWeightBudget: number
  weightDemotedCardCount: number
  sceneDerivations: number
  metricDerivations: number
  metricVisits: number
  metricFullRebuilds: number
  renditionEntries: number
  renditionDecodedBytes: number
  renditionDecodedByteBudget: number
  renditionBytes: number
  renditionByteBudget: number
}>

export type RendererCounterRuntime = Readonly<{
  snapshot: () => RendererCounterSnapshot
}>

declare global {
  interface Window {
    /** Packaged-safe, read-only renderer diagnostics. Numeric counters only. */
    __EIDO_RENDERER_COUNTERS__?: RendererCounterRuntime
  }
}

function liveBoardElement(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  return document.querySelector<HTMLElement>(
    '.board-flow[data-residency-mode="bounded-reading"]',
  )
}

function nonNegativeInteger(value: string | undefined): number {
  const number = Number(value)
  return Number.isSafeInteger(number) && number >= 0 ? number : 0
}

export function readRendererCounterSnapshot(): RendererCounterSnapshot {
  const board = liveBoardElement()
  const scene = boardSceneNumericCountersSnapshot()
  const renditions = readImageRenditionNumericSnapshot()

  return {
    residentRichCards:
      board?.querySelectorAll(
        '.react-flow__node.eido-visual-card-node:not(.react-flow__node-gestureProxy)',
      ).length ?? 0,
    passiveCards: nonNegativeInteger(board?.dataset.passiveCardCount),
    oversizePassiveCards: nonNegativeInteger(board?.dataset.oversizePassiveCardCount),
    oversizePassiveCardLimit: OVERSIZE_PASSIVE_CARD_LIMIT,
    passiveCardLimit: PASSIVE_CARD_LIMIT,
    liveCards: nonNegativeInteger(board?.dataset.liveCardCount),
    boardDetailTextWeight: nonNegativeInteger(board?.dataset.boardDetailTextWeight),
    admittedDetailTextWeight: nonNegativeInteger(board?.dataset.admittedDetailTextWeight),
    oversizePassiveTextWeight: nonNegativeInteger(board?.dataset.oversizePassiveTextWeight),
    detailTextWeightBudget: nonNegativeInteger(board?.dataset.detailTextWeightBudget),
    weightDemotedCardCount: nonNegativeInteger(board?.dataset.weightDemotedCardCount),
    sceneDerivations: scene.sceneDerivations,
    metricDerivations: scene.cardMetricDerivations,
    metricVisits: scene.cardMetricVisits,
    metricFullRebuilds: scene.cardMetricFullRebuilds,
    renditionEntries: renditions?.entries ?? 0,
    renditionDecodedBytes: renditions?.decodedBytes ?? 0,
    renditionDecodedByteBudget: IMAGE_RENDITION_BUDGETS.maxDecodedBytes,
    renditionBytes: renditions?.renditionBytes ?? 0,
    renditionByteBudget: IMAGE_RENDITION_BUDGETS.maxRenditionBytes,
  }
}

const rendererCounterRuntime: RendererCounterRuntime = {
  snapshot: readRendererCounterSnapshot,
}

export function installRendererCounterRuntime(): void {
  window.__EIDO_RENDERER_COUNTERS__ = rendererCounterRuntime
}
