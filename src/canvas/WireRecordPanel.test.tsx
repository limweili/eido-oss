// @vitest-environment jsdom

// The Settings face of the wire record (#968): the same entries the console
// reads, legible without one.

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import {
  readWireRecord,
  setWireRecording,
  wireRecordFailure,
  wireRecordProviderRequest,
  wireRecordToolCall,
} from '../shared/wireRecord'
import { words } from '../shared/words'
import { WireRecordPanel } from './WireRecordPanel'

afterEach(() => {
  cleanup()
  setWireRecording(false)
})

describe('WireRecordPanel', () => {
  it('says plainly when nothing has been recorded', () => {
    setWireRecording(true)
    render(<WireRecordPanel />)
    expect(screen.getByText(words.wireRecordEmptyHint)).toBeInTheDocument()
  })

  it('shows a provider request with its declared tools, a call with its arguments, and a failure', () => {
    setWireRecording(true)
    wireRecordProviderRequest('https://openrouter.ai/api/v1/chat/completions', [
      { type: 'function', function: { name: 'search_web' } },
    ], true)
    wireRecordToolCall('search_web', '{"query":"electron 40"}')
    wireRecordFailure('https://api.linkup.so/v1/search', 429, 'rate-limited')

    render(<WireRecordPanel />)

    expect(
      screen.getByText(
        `openrouter.ai/api/v1/chat/completions · ${words.wireRecordToolsLead} search_web · ${words.wireRecordBriefSent}`,
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('search_web {"query":"electron 40"}')).toBeInTheDocument()
    expect(screen.getByText('api.linkup.so/v1/search · http 429 · rate-limited')).toBeInTheDocument()
  })

  it('clears the buffer from the panel', async () => {
    setWireRecording(true)
    wireRecordToolCall('search_web', '{}')
    render(<WireRecordPanel />)

    await userEvent.click(screen.getByRole('button', { name: words.wireRecordClear }))

    expect(readWireRecord()).toEqual([])
    expect(screen.getByText(words.wireRecordEmptyHint)).toBeInTheDocument()
  })
})
