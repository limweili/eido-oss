import { describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { assertRichCardRawArtifact, renderRichCardBaselineReport, type RichCardRawArtifact } from './richCardBenchmark'

const RAW_ARTIFACT = 'src/performance/baselines/richCardBaseline.raw.json'
const REPORT = 'research/03-performance-architecture/14-rich-card-reading-baseline.md'

describe('rich Card retained baseline report (#402)', () => {
  it('regenerates the checked-in report from retained raw browser evidence', () => {
    const artifact = JSON.parse(readFileSync(RAW_ARTIFACT, 'utf8')) as RichCardRawArtifact
    assertRichCardRawArtifact(artifact)

    const report = renderRichCardBaselineReport(artifact)
    writeFileSync(REPORT, report)

    expect(report).toContain(artifact.environment.commit)
    expect(report).toContain('Observed browser metrics')
    expect(report).toContain('No renderer winner')
    expect(report).toContain('React work: **unavailable**')
  })
})
