import { describe, expect, it } from 'vitest'
import {
  cardLabel,
  cardTextFromBlocks,
  cardTextProjectionBuildCountForTests,
  chosenVersion,
  resetCardTextProjectionBuildCountForTests,
} from './graphHelpers'
import type { Card, Output } from './types'

const versions: Output['versions'] = [
  { id: 'version-one', number: 1, text: 'First', createdAt: '2026-07-19T00:00:00.000Z', fromRunId: 'run-one' },
  { id: 'version-two', number: 2, text: 'Second', createdAt: '2026-07-19T00:01:00.000Z', fromRunId: 'run-two' },
]
const output: Output = { id: 'output', resultCardId: 'result', versions }

describe('chosenVersion', () => {
  it.each([
    { case: 'explicit choice', output: { ...output, chosenVersionId: 'version-one' }, expected: 'version-one' },
    { case: 'latest fallback', output, expected: 'version-two' },
    { case: 'invalid explicit choice', output: { ...output, chosenVersionId: 'missing-version' }, expected: undefined },
    { case: 'empty versions', output: { ...output, versions: [] }, expected: undefined },
    { case: 'missing output', output: undefined, expected: undefined },
  ])('handles $case', ({ output, expected }) => {
    expect(chosenVersion(output)?.id).toBe(expected)
  })
})

describe('cardLabel', () => {
  it.each([
    {
      name: 'trims terminal whitespace after a newline in one block',
      blocks: [{ id: 'terminal-newline', text: 'Hello   \n' }],
      expected: 'Hello',
    },
    {
      name: 'trims terminal whitespace in later blocks',
      blocks: [
        { id: 'terminal-block-one', text: 'Hello   ' },
        { id: 'terminal-block-two', text: '   ' },
      ],
      expected: 'Hello',
    },
    {
      name: 'preserves whitespace before later non-whitespace content',
      blocks: [{ id: 'internal-newline', text: 'Hello   \nworld' }],
      expected: 'Hello   ',
    },
    {
      name: 'preserves whitespace before later content in another block',
      blocks: [
        { id: 'internal-block-one', text: 'Hello   ' },
        { id: 'internal-block-two', text: '   world' },
      ],
      expected: 'Hello   ',
    },
  ])('$name', ({ blocks, expected }) => {
    const card: Card = {
      id: `label-${expected}`,
      kind: 'note',
      blocks,
      position: { x: 0, y: 0 },
    }
    expect(cardLabel(card)).toBe(expected)
  })
})

describe('cardTextFromBlocks', () => {
  it('reuses a complete high-block-count projection until immutable blocks change', () => {
    const blocks: Card['blocks'] = Array.from({ length: 30_000 }, (_, index) => ({
      id: `large-text-${index}`,
      text: `${String(index).padStart(5, '0')}:${'x'.repeat(27)}`,
    }))
    resetCardTextProjectionBuildCountForTests()

    const first = cardTextFromBlocks(blocks)
    const second = cardTextFromBlocks(blocks)

    expect(first).toBe(second)
    expect(first.length).toBe(1_019_999)
    expect(first.startsWith('00000:')).toBe(true)
    expect(first.endsWith('29999:' + 'x'.repeat(27))).toBe(true)
    expect(cardTextProjectionBuildCountForTests()).toBe(1)

    const replaced = blocks.map((block, index) => index === 29_999
      ? { ...block, text: 'semantic replacement' }
      : block)
    expect(cardTextFromBlocks(replaced)).toContain('semantic replacement')
    expect(cardTextProjectionBuildCountForTests()).toBe(2)
  })
})
