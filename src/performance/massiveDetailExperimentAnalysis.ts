export type MetricStats = {
  median: number
  min: number
  max: number
  q1: number
  q3: number
  iqr: number
}

export type MetricComparison = {
  capsOn: MetricStats
  capsOff: MetricStats
  pairedDelta: MetricStats
  observedNoiseFloor: number
  /** Diagnostic only; sign crossing is not a verdict safety property or gate. */
  pairedDeltaCrossesZero: boolean
  differenceExceedsObservedNoise: boolean
}

export type PositiveControlAnalysis = {
  injectedMsPerFrame: number
  capsOff: MetricStats
  positiveControl: MetricStats
  pairedDelta: MetricStats
  movedBeyondObservedNoise: boolean
  validatedSensitivityMsPerFrame: number | null
}

export type ExperimentArm = 'caps-on' | 'caps-off'

export type BoardClassCapVerdict =
  | 'can come off'
  | 'must stay pending further work'
  | 'instrument unfit - no verdict'

export type BoardClassCapGround =
  | 'positive-control-failed'
  | 'caps-off-gate-failed'
  | 'sign-consistent-regression'
  | 'magnitude-regression'
  | 'uniform-improvement'
  | 'no-regression'

export type BoardClassCapDecision = {
  verdict: BoardClassCapVerdict
  grounds: BoardClassCapGround[]
}

export function experimentArmOrderForPair(pair: number): ExperimentArm[] {
  return pair % 2 === 1 ? ['caps-on', 'caps-off'] : ['caps-off', 'caps-on']
}

export function replaceExactOccurrences(
  source: string,
  marker: string,
  replacement: string,
  expectedCount: number,
): string {
  const occurrenceCount = source.split(marker).length - 1
  if (occurrenceCount !== expectedCount) {
    throw new Error(`Expected ${expectedCount} occurrences of marker; found ${occurrenceCount}`)
  }
  const replaceAll = (source as unknown as {
    replaceAll: (searchValue: string, replaceValue: string) => string
  }).replaceAll
  return replaceAll.call(source, marker, replacement)
}

export function comparePairedMetrics(capsOn: number[], capsOff: number[]): MetricComparison {
  assertPaired(capsOn, capsOff, 'caps-on', 'caps-off')
  const on = metricStats(capsOn)
  const off = metricStats(capsOff)
  const pairedDelta = metricStats(capsOff.map((value, index) => value - (capsOn[index] ?? 0)))
  const observedNoiseFloor = Math.max(on.iqr, off.iqr, pairedDelta.iqr)
  const pairedDeltaCrossesZero = pairedDelta.min <= 0 && pairedDelta.max >= 0
  return {
    capsOn: on,
    capsOff: off,
    pairedDelta,
    observedNoiseFloor,
    pairedDeltaCrossesZero,
    differenceExceedsObservedNoise: Math.abs(pairedDelta.median) > observedNoiseFloor,
  }
}

export function analyzePositiveControl({
  capsOff,
  positiveControl,
  injectedMsPerFrame,
  observedNoiseFloor,
}: {
  capsOff: number[]
  positiveControl: number[]
  injectedMsPerFrame: number
  observedNoiseFloor: number
}): PositiveControlAnalysis {
  assertPaired(capsOff, positiveControl, 'caps-off', 'positive-control')
  const pairedDelta = metricStats(positiveControl.map((value, index) => value - (capsOff[index] ?? 0)))
  const movedBeyondObservedNoise = pairedDelta.q1 > 0 && pairedDelta.median > observedNoiseFloor
  return {
    injectedMsPerFrame,
    capsOff: metricStats(capsOff),
    positiveControl: metricStats(positiveControl),
    pairedDelta,
    movedBeyondObservedNoise,
    validatedSensitivityMsPerFrame: movedBeyondObservedNoise ? injectedMsPerFrame : null,
  }
}

export function boardClassCapVerdict({
  capsOffGateGreen,
  primary,
  positiveControl,
}: {
  capsOffGateGreen: boolean
  primary: MetricComparison
  positiveControl: PositiveControlAnalysis
}): BoardClassCapVerdict {
  return boardClassCapDecision({ capsOffGateGreen, primary, positiveControl }).verdict
}

export function boardClassCapDecision({
  capsOffGateGreen,
  primary,
  positiveControl,
}: {
  capsOffGateGreen: boolean
  primary: MetricComparison
  positiveControl: PositiveControlAnalysis
}): BoardClassCapDecision {
  if (!positiveControl.movedBeyondObservedNoise) {
    return { verdict: 'instrument unfit - no verdict', grounds: ['positive-control-failed'] }
  }
  if (!capsOffGateGreen) {
    return { verdict: 'must stay pending further work', grounds: ['caps-off-gate-failed'] }
  }
  const signConsistentRegression = primary.pairedDelta.min >= 0 && primary.pairedDelta.max > 0
  const magnitudeRegression = primary.pairedDelta.median > 0 && primary.differenceExceedsObservedNoise
  const regressionGrounds: BoardClassCapGround[] = []
  if (signConsistentRegression) regressionGrounds.push('sign-consistent-regression')
  if (magnitudeRegression) regressionGrounds.push('magnitude-regression')
  if (regressionGrounds.length) {
    return { verdict: 'must stay pending further work', grounds: regressionGrounds }
  }
  if (primary.pairedDelta.max <= 0 && primary.pairedDelta.min < 0) {
    return { verdict: 'can come off', grounds: ['uniform-improvement'] }
  }
  return { verdict: 'can come off', grounds: ['no-regression'] }
}

export function boardClassCapsRationale({
  primary,
  positiveControl,
  decision,
}: {
  primary: MetricComparison
  positiveControl: PositiveControlAnalysis
  decision: BoardClassCapDecision
}): string {
  const injectedMsPerFrame = positiveControl.injectedMsPerFrame
  if (decision.grounds.includes('positive-control-failed')) {
    return `Positive-control failure: the ${injectedMsPerFrame}ms/frame control did not move the continuous primary metric beyond observed noise; the instrument is unfit and no cap verdict is issued.`
  }
  if (decision.grounds.includes('caps-off-gate-failed')) {
    return 'Caps-off gate failure: a representation or full-board scene-derivation gate failed; cap removal is not approved.'
  }

  const signConsistentRegression = decision.grounds.includes('sign-consistent-regression')
  const magnitudeRegression = decision.grounds.includes('magnitude-regression')
  if (signConsistentRegression && magnitudeRegression) {
    return `Positive control passed at ${injectedMsPerFrame}ms/frame. Sign-consistent regression: every paired delta was non-negative and at least one was positive. Magnitude regression: the paired median increase of ${primary.pairedDelta.median.toFixed(2)}ms/s exceeded the ${primary.observedNoiseFloor.toFixed(2)}ms/s noise floor. Cap removal is not approved.`
  }
  if (signConsistentRegression) {
    return `Positive control passed at ${injectedMsPerFrame}ms/frame. Sign-consistent regression: every paired delta was non-negative and at least one was positive. The effect is not treated as zero even though its ${primary.pairedDelta.median.toFixed(2)}ms/s median is within the ${primary.observedNoiseFloor.toFixed(2)}ms/s noise floor; cap removal is not approved.`
  }
  if (magnitudeRegression) {
    return `Positive control passed at ${injectedMsPerFrame}ms/frame. Magnitude regression: caps-off increased continuous main-thread task time by a paired median ${primary.pairedDelta.median.toFixed(2)}ms/s, exceeding the ${primary.observedNoiseFloor.toFixed(2)}ms/s noise floor. Cap removal is not approved.`
  }
  if (decision.grounds.includes('uniform-improvement')) {
    return `Positive control passed at ${injectedMsPerFrame}ms/frame. Uniform improvement: every paired delta was non-positive and at least one was negative, so the measured caps-off improvement does not block cap removal.`
  }
  return `Positive control passed at ${injectedMsPerFrame}ms/frame. No sign-consistent or above-noise caps-off regression was measured.`
}

export function metricStats(values: number[]): MetricStats {
  const sorted = [...values].sort((left, right) => left - right)
  const q1 = quantile(sorted, 0.25)
  const q3 = quantile(sorted, 0.75)
  return {
    median: quantile(sorted, 0.5),
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    q1,
    q3,
    iqr: q3 - q1,
  }
}

function quantile(sorted: number[], probability: number): number {
  if (!sorted.length) return 0
  const index = (sorted.length - 1) * probability
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  if (lower === upper) return sorted[lower] ?? 0
  const weight = index - lower
  return (sorted[lower] ?? 0) * (1 - weight) + (sorted[upper] ?? 0) * weight
}

function assertPaired(left: number[], right: number[], leftArm: string, rightArm: string): void {
  if (!left.length || left.length !== right.length) {
    throw new Error(`Expected equally sized non-empty paired samples, received ${left.length} and ${right.length}`)
  }
  for (const [arm, values] of [
    [leftArm, left],
    [rightArm, right],
  ] as const) {
    const nonFiniteIndex = values.findIndex((value) => !Number.isFinite(value))
    if (nonFiniteIndex >= 0) {
      throw new Error(
        `Expected finite ${arm} sample at index ${nonFiniteIndex}; received ${String(values[nonFiniteIndex])}`,
      )
    }
  }
}
