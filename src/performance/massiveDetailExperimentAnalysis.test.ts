import { describe, expect, it } from 'vitest'
import {
  analyzePositiveControl,
  boardClassCapDecision,
  boardClassCapVerdict,
  boardClassCapsRationale,
  comparePairedMetrics,
  experimentArmOrderForPair,
  replaceExactOccurrences,
} from './massiveDetailExperimentAnalysis'

describe('massive detail experiment analysis', () => {
  it.each([
    ['caps-on', Number.NaN, 'NaN'],
    ['caps-on', Number.POSITIVE_INFINITY, 'Infinity'],
    ['caps-on', Number.NEGATIVE_INFINITY, '-Infinity'],
    ['caps-off', Number.NaN, 'NaN'],
    ['caps-off', Number.POSITIVE_INFINITY, 'Infinity'],
    ['caps-off', Number.NEGATIVE_INFINITY, '-Infinity'],
  ] as const)('rejects non-finite %s input before analysis', (arm, value, displayValue) => {
    const capsOn = arm === 'caps-on' ? [value] : [1]
    const capsOff = arm === 'caps-off' ? [value] : [1]

    expect(() => comparePairedMetrics(capsOn, capsOff)).toThrow(
      new RegExp(`${arm} sample at index 0.*${displayValue}`),
    )
  })

  it('returns no verdict when the positive control fails, regardless of the paired deltas', () => {
    const capsOn = [116.7, 116.7, 116.7, 116.7, 116.7]
    const capsOff = [116.7, 116.7, 116.7, 133.4, 116.7]
    const primary = comparePairedMetrics(capsOn, capsOff)
    const positiveControl = analyzePositiveControl({
      capsOff,
      positiveControl: [...capsOff],
      injectedMsPerFrame: 8,
      observedNoiseFloor: primary.observedNoiseFloor,
    })

    expect(positiveControl.movedBeyondObservedNoise).toBe(false)
    expect(positiveControl.validatedSensitivityMsPerFrame).toBeNull()
    const decision = boardClassCapDecision({ capsOffGateGreen: true, primary, positiveControl })
    expect(decision).toEqual({
      verdict: 'instrument unfit - no verdict',
      grounds: ['positive-control-failed'],
    })
    expect(boardClassCapsRationale({ primary, positiveControl, decision })).toContain(
      'Positive-control failure',
    )
    expect(boardClassCapVerdict({ capsOffGateGreen: true, primary, positiveControl })).toBe(
      'instrument unfit - no verdict',
    )
  })

  it('approves deltas that straddle zero when the median stays within the noise floor', () => {
    const capsOn = [410, 405, 412, 408, 409]
    const capsOff = [411, 407, 410, 409, 408]
    const primary = comparePairedMetrics(capsOn, capsOff)
    const positiveControl = analyzePositiveControl({
      capsOff,
      positiveControl: [482, 476, 481, 479, 480],
      injectedMsPerFrame: 8,
      observedNoiseFloor: primary.observedNoiseFloor,
    })

    expect(primary.pairedDeltaCrossesZero).toBe(true)
    expect(Math.abs(primary.pairedDelta.median)).toBeLessThanOrEqual(primary.observedNoiseFloor)
    expect(primary.differenceExceedsObservedNoise).toBe(false)
    expect(positiveControl.movedBeyondObservedNoise).toBe(true)
    expect(positiveControl.validatedSensitivityMsPerFrame).toBe(8)
    expect(boardClassCapVerdict({ capsOffGateGreen: true, primary, positiveControl })).toBe('can come off')
  })

  it('keeps the caps when the continuous metric finds a measurable regression', () => {
    const capsOn = [400, 402, 401, 399, 400]
    const capsOff = [440, 442, 441, 439, 440]
    const primary = comparePairedMetrics(capsOn, capsOff)
    const positiveControl = analyzePositiveControl({
      capsOff,
      positiveControl: [510, 512, 511, 509, 510],
      injectedMsPerFrame: 8,
      observedNoiseFloor: primary.observedNoiseFloor,
    })

    expect(primary.differenceExceedsObservedNoise).toBe(true)
    expect(boardClassCapVerdict({ capsOffGateGreen: true, primary, positiveControl })).toBe(
      'must stay pending further work',
    )
  })

  it('does not let one negative sample launder a magnitude regression', () => {
    const capsOn = [500, 500, 500, 500, 500]
    const capsOff = [499, 600, 601, 602, 603]
    const primary = comparePairedMetrics(capsOn, capsOff)
    const positiveControl = analyzePositiveControl({
      capsOff,
      positiveControl: capsOff.map((value) => value + 200),
      injectedMsPerFrame: 8,
      observedNoiseFloor: primary.observedNoiseFloor,
    })

    expect(primary.pairedDelta).toMatchObject({ median: 101, min: -1, max: 103, iqr: 2 })
    expect(primary.pairedDeltaCrossesZero).toBe(true)
    expect(primary.differenceExceedsObservedNoise).toBe(true)
    const decision = boardClassCapDecision({ capsOffGateGreen: true, primary, positiveControl })
    expect(decision).toEqual({
      verdict: 'must stay pending further work',
      grounds: ['magnitude-regression'],
    })
    expect(boardClassCapsRationale({ primary, positiveControl, decision })).toContain(
      'Magnitude regression',
    )
    expect(boardClassCapVerdict({ capsOffGateGreen: true, primary, positiveControl })).toBe(
      'must stay pending further work',
    )
  })

  it('does not approve five same-sign deltas even when they are below the noise floor', () => {
    const capsOn = [100, 110, 90, 105, 95]
    const capsOff = capsOn.map((value) => value + 1)
    const primary = comparePairedMetrics(capsOn, capsOff)
    const positiveControl = analyzePositiveControl({
      capsOff,
      positiveControl: capsOff.map((value) => value + 30),
      injectedMsPerFrame: 8,
      observedNoiseFloor: primary.observedNoiseFloor,
    })

    expect(primary.differenceExceedsObservedNoise).toBe(false)
    expect(primary.pairedDeltaCrossesZero).toBe(false)
    expect(positiveControl.movedBeyondObservedNoise).toBe(true)
    const decision = boardClassCapDecision({ capsOffGateGreen: true, primary, positiveControl })
    expect(decision).toEqual({
      verdict: 'must stay pending further work',
      grounds: ['sign-consistent-regression'],
    })
    expect(boardClassCapsRationale({ primary, positiveControl, decision })).toContain(
      'Sign-consistent regression',
    )
    expect(boardClassCapVerdict({ capsOffGateGreen: true, primary, positiveControl })).toBe(
      'must stay pending further work',
    )
  })

  it('approves a uniform improvement', () => {
    const capsOn = [100, 110, 90, 105, 95]
    const capsOff = capsOn.map((value) => value - 1)
    const primary = comparePairedMetrics(capsOn, capsOff)
    const positiveControl = analyzePositiveControl({
      capsOff,
      positiveControl: capsOff.map((value) => value + 30),
      injectedMsPerFrame: 8,
      observedNoiseFloor: primary.observedNoiseFloor,
    })

    expect(primary.pairedDelta).toMatchObject({ median: -1, min: -1, max: -1 })
    expect(primary.differenceExceedsObservedNoise).toBe(false)
    const decision = boardClassCapDecision({ capsOffGateGreen: true, primary, positiveControl })
    expect(decision).toEqual({ verdict: 'can come off', grounds: ['uniform-improvement'] })
    expect(boardClassCapsRationale({ primary, positiveControl, decision })).toContain('Uniform improvement')
    expect(boardClassCapVerdict({ capsOffGateGreen: true, primary, positiveControl })).toBe('can come off')
  })

  it('approves a uniform improvement larger than the noise floor', () => {
    const capsOn = [100, 110, 90, 105, 95]
    const capsOff = capsOn.map((value) => value - 30)
    const primary = comparePairedMetrics(capsOn, capsOff)
    const positiveControl = analyzePositiveControl({
      capsOff,
      positiveControl: capsOff.map((value) => value + 100),
      injectedMsPerFrame: 8,
      observedNoiseFloor: primary.observedNoiseFloor,
    })

    expect(primary.pairedDelta).toMatchObject({ median: -30, min: -30, max: -30 })
    expect(primary.differenceExceedsObservedNoise).toBe(true)
    expect(boardClassCapVerdict({ capsOffGateGreen: true, primary, positiveControl })).toBe('can come off')
  })

  it('counterbalances base arms AB/BA across adjacent pairs', () => {
    expect(experimentArmOrderForPair(1)).toEqual(['caps-on', 'caps-off'])
    expect(experimentArmOrderForPair(2)).toEqual(['caps-off', 'caps-on'])
    expect(experimentArmOrderForPair(3)).toEqual(['caps-on', 'caps-off'])
    expect(experimentArmOrderForPair(4)).toEqual(['caps-off', 'caps-on'])
  })

  it('replaces every expected cap marker and rejects zero or duplicate markers', () => {
    expect(replaceExactOccurrences('before CAP after', 'CAP', 'PATCHED', 1)).toBe('before PATCHED after')
    expect(() => replaceExactOccurrences('no marker', 'CAP', 'PATCHED', 1)).toThrow(/found 0/)
    expect(() => replaceExactOccurrences('CAP then CAP', 'CAP', 'PATCHED', 1)).toThrow(/found 2/)
  })
})
