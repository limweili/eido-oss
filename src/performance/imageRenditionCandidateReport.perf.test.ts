import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  DEFAULT_IMAGE_RENDITION_CANDIDATE_RAW_ARTIFACT_PATH,
  DEFAULT_IMAGE_RENDITION_CANDIDATE_REPORT_PATH,
  IMAGE_RENDITION_CANDIDATE_LIMITATIONS,
  generateImageRenditionCandidateReport,
  type ImageRenditionCandidateArtifact,
} from './imageRenditionCandidate'

const EXPLICIT_RAW_ARTIFACT = process.env.EIDO_IMAGE_RENDITION_REPORT_ARTIFACT
const EXPLICIT_REPORT = process.env.EIDO_IMAGE_RENDITION_REPORT_PATH
const RETAINED_RAW_ARTIFACT_SHA256 = '69f34f5800a698774398e064812a0dc7a9f69e54352fee783d721ce112272331'
const RETAINED_REPORT_SHA256 = '7fcd45f99a3e68721345e32a06f05069411faca6cc237932cfd2ea554ef5ab35'
const RETAINED_EVIDENCE_COMMIT = 'f38a2907f362ff6ed042ba90513b48ed8cb8d17e'
const RETAINED_EVIDENCE_RUN = 'https://github.com/limweili/eido/actions/runs/29364921426'

function sha256(bytes: Uint8Array | string) {
  return createHash('sha256').update(bytes).digest('hex')
}

function withTemporaryReportRoot(test: (root: string) => void) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'eido-image-rendition-report-'))
  try {
    test(root)
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
}

function writeSchemaV2TestArtifact(root: string) {
  const artifactPath = path.join(root, 'artifacts/imageRenditionCandidate.raw.json')
  const retained = JSON.parse(
    readFileSync(DEFAULT_IMAGE_RENDITION_CANDIDATE_RAW_ARTIFACT_PATH, 'utf8'),
  ) as Omit<ImageRenditionCandidateArtifact, 'schemaVersion' | 'limitations'>
  const artifact: ImageRenditionCandidateArtifact = {
    ...retained,
    schemaVersion: 2,
    limitations: {
      preAuthorizedSacrifice: false,
      search: {
        status: 'observed',
        target: 'synthetic-alpha-square.png',
        found: true,
        method: IMAGE_RENDITION_CANDIDATE_LIMITATIONS.search.method,
        unmeasured: [...IMAGE_RENDITION_CANDIDATE_LIMITATIONS.search.unmeasured],
      },
      copy: {
        status: 'observed',
        intendedText: 'synthetic-alpha-square.png',
        copiedText: 'synthetic-alpha-square.png',
        method: IMAGE_RENDITION_CANDIDATE_LIMITATIONS.copy.method,
        unmeasured: [...IMAGE_RENDITION_CANDIDATE_LIMITATIONS.copy.unmeasured],
      },
      accessibility: {
        status: 'observed',
        role: 'image',
        expectedName: 'synthetic-alpha-square.png',
        matchingNodes: 1,
        method: IMAGE_RENDITION_CANDIDATE_LIMITATIONS.accessibility.method,
        unmeasured: [...IMAGE_RENDITION_CANDIDATE_LIMITATIONS.accessibility.unmeasured],
      },
    },
  }
  mkdirSync(path.dirname(artifactPath), { recursive: true })
  writeFileSync(artifactPath, `${JSON.stringify(artifact)}\n`)
  return artifactPath
}

describe('image rendition retained candidate report (#413)', () => {
  it('generates only to a temporary root by default or to explicitly selected fresh-evidence paths', () => {
    if (Boolean(EXPLICIT_RAW_ARTIFACT) !== Boolean(EXPLICIT_REPORT)) {
      throw new Error('Current evidence regeneration requires both explicit raw-artifact and report paths.')
    }
    withTemporaryReportRoot((root) => {
      const artifactPath = EXPLICIT_RAW_ARTIFACT ?? writeSchemaV2TestArtifact(root)
      const reportPath = EXPLICIT_REPORT ?? path.join(root, 'artifacts/image-rendition-candidate.md')
      const rawArtifact = readFileSync(artifactPath, 'utf8')
      const rawArtifactHash = sha256(rawArtifact)
      const artifact = JSON.parse(rawArtifact) as ImageRenditionCandidateArtifact
      const retainedReportHash = EXPLICIT_REPORT
        ? sha256(readFileSync(DEFAULT_IMAGE_RENDITION_CANDIDATE_REPORT_PATH, 'utf8'))
        : undefined
      const { report } = generateImageRenditionCandidateReport({ artifactPath, reportPath })
      const materializedReport = readFileSync(reportPath, 'utf8')
      const sourceRunUrl = artifact.capture.sourceRunUrl

      expect(report).toContain(artifact.environment.commit)
      expect(sourceRunUrl).toBeDefined()
      if (!sourceRunUrl) throw new Error('Retained browser evidence must identify its source run.')
      expect(report).toContain(sourceRunUrl)
      expect(sha256(readFileSync(artifactPath, 'utf8'))).toBe(rawArtifactHash)
      expect(materializedReport).toBe(report)
      expect(sha256(materializedReport)).toBe(sha256(report))
      if (retainedReportHash !== undefined) {
        expect(sha256(readFileSync(DEFAULT_IMAGE_RENDITION_CANDIDATE_REPORT_PATH, 'utf8')))
          .toBe(retainedReportHash)
      }
      expect(report).toContain('Production default remains unchanged')
      expect(report).toContain('Blank replacements were zero during the measured traversals')
      expect(report).toContain('Save/export and AI compatibility guards')
      expect(reportPath).not.toBe(DEFAULT_IMAGE_RENDITION_CANDIDATE_REPORT_PATH)
    })
  })

  it('pins the promoted schema-v2 raw and slot-16 report to their provider provenance', () => {
    const retainedRaw = readFileSync(DEFAULT_IMAGE_RENDITION_CANDIDATE_RAW_ARTIFACT_PATH, 'utf8')
    const retainedReport = readFileSync(DEFAULT_IMAGE_RENDITION_CANDIDATE_REPORT_PATH, 'utf8')
    const retainedArtifact = JSON.parse(retainedRaw) as ImageRenditionCandidateArtifact

    expect(retainedArtifact.schemaVersion).toBe(2)
    expect(retainedArtifact.environment.commit).toBe(RETAINED_EVIDENCE_COMMIT)
    expect(retainedArtifact.capture.sourceRunUrl).toBe(RETAINED_EVIDENCE_RUN)
    expect(sha256(retainedRaw))
      .toBe(RETAINED_RAW_ARTIFACT_SHA256)
    expect(sha256(retainedReport))
      .toBe(RETAINED_REPORT_SHA256)
    withTemporaryReportRoot((root) => {
      const reportPath = path.join(root, 'image-rendition-candidate.md')
      const { report } = generateImageRenditionCandidateReport({
        artifactPath: DEFAULT_IMAGE_RENDITION_CANDIDATE_RAW_ARTIFACT_PATH,
        reportPath,
      })
      expect(report).toBe(retainedReport)
      expect(readFileSync(reportPath, 'utf8')).toBe(retainedReport)
    })
    expect(existsSync('research/03-performance-architecture/15-image-rendition-candidate.md')).toBe(false)
    expect(existsSync('research/03-performance-architecture/17-image-rendition-candidate.md')).toBe(false)
  })

  it('rejects invalid retained raw evidence before materializing a report', () => {
    withTemporaryReportRoot((root) => {
      const rawPath = path.join(root, DEFAULT_IMAGE_RENDITION_CANDIDATE_RAW_ARTIFACT_PATH)
      const reportPath = path.join(root, DEFAULT_IMAGE_RENDITION_CANDIDATE_REPORT_PATH)
      mkdirSync(path.dirname(rawPath), { recursive: true })
      writeFileSync(rawPath, '{"schemaVersion":0}\n')

      expect(() => generateImageRenditionCandidateReport({ root })).toThrow(/artifact must match/i)
      expect(existsSync(reportPath)).toBe(false)
      expect(existsSync(path.dirname(reportPath))).toBe(false)
    })
  })

  it.each(['write', 'rename'] as const)(
    'preserves the existing report and cleans its sibling temp when %s publication fails',
    (failureStage) => {
      withTemporaryReportRoot((root) => {
        const artifactPath = writeSchemaV2TestArtifact(root)
        const reportPath = `virtual/${DEFAULT_IMAGE_RENDITION_CANDIDATE_REPORT_PATH}`
        const temporaryPath = `${reportPath}.tmp`
        const originalReport = 'existing retained evidence bytes\n'
        const files = new Map([
          [reportPath, originalReport],
          [temporaryPath, 'stale temporary evidence'],
        ])
        const events: string[] = []
        const fileSystem = {
          mkdirSync: () => { events.push('mkdir') },
          writeFileSync: (file: string, contents: string) => {
            events.push('write-temp')
            if (failureStage === 'write') throw new Error('write failed')
            files.set(file, contents)
          },
          renameSync: (from: string, to: string) => {
            events.push('rename')
            if (failureStage === 'rename') throw new Error('rename failed')
            const contents = files.get(from)
            if (contents === undefined) throw new Error('temporary report missing')
            files.delete(from)
            files.set(to, contents)
          },
          rmSync: (file: string) => {
            events.push('remove-temp')
            files.delete(file)
          },
        }

        expect(() => generateImageRenditionCandidateReport({
          artifactPath,
          reportPath,
          fileSystem,
        })).toThrow(new RegExp(`${failureStage} failed`, 'i'))
        expect(files).toEqual(new Map([[reportPath, originalReport]]))
        expect(events).toEqual(
          failureStage === 'write'
            ? ['remove-temp', 'mkdir', 'write-temp', 'remove-temp']
            : ['remove-temp', 'mkdir', 'write-temp', 'rename', 'remove-temp'],
        )
      })
    },
  )
})
