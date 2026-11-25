import { describe, expect, it } from 'vitest'
import { classifyNavigationResult } from './browserPerformanceRuntime'

const healthyNavigation = {
  averageFps: 60,
  blankFrames: 0,
  displayCadenceMs: 16.7,
  displayHz: 60,
  maxRepresentedCardDeficit: 0,
  minRepresentedCardRatio: 1,
  minimumFps: 55,
  p95FrameGapMs: 16.8,
  sustainedFps: 58,
}

describe('browser navigation classification', () => {
  it('only reports target-met when cadence and visible-card representation are healthy', () => {
    expect(classifyNavigationResult(healthyNavigation)).toBe('target-met')
  })

  it('prioritizes full blanking over all other navigation signals', () => {
    expect(
      classifyNavigationResult({
        ...healthyNavigation,
        averageFps: 20,
        blankFrames: 1,
        displayHz: 30,
        minRepresentedCardRatio: 0.2,
      }),
    ).toBe('blanking-regression')
  })

  it('classifies partial visible-card loss separately from a fully blank viewport', () => {
    expect(
      classifyNavigationResult({
        ...healthyNavigation,
        minRepresentedCardRatio: 0.97,
      }),
    ).toBe('representation-regression')
    expect(
      classifyNavigationResult({
        ...healthyNavigation,
        maxRepresentedCardDeficit: 3,
      }),
    ).toBe('representation-regression')
  })

  it('reports display-limited only after representation is complete', () => {
    expect(
      classifyNavigationResult({
        ...healthyNavigation,
        displayHz: 50,
      }),
    ).toBe('display-limited')
  })

  it('tolerates small p95 jitter around the measured display cadence', () => {
    expect(
      classifyNavigationResult({
        ...healthyNavigation,
        p95FrameGapMs: 18.5,
        sustainedFps: 54.05,
      }),
    ).toBe('target-met')
  })

  it('reports app-bottleneck when the display can hit the target but Eido does not', () => {
    expect(
      classifyNavigationResult({
        ...healthyNavigation,
        averageFps: 54,
      }),
    ).toBe('app-bottleneck')
    expect(
      classifyNavigationResult({
        ...healthyNavigation,
        p95FrameGapMs: 40,
        sustainedFps: 54,
      }),
    ).toBe('app-bottleneck')
  })
})
