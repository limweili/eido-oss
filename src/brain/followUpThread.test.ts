import { describe, expect, it } from 'vitest'
import type { FollowUpMessage } from '../graph/types'
import {
  FOLLOW_UP_DISCUSSION_LABEL,
  flattenFollowUpThread,
  followUpDiscussionSection,
  settleInterruptedFollowUps,
} from './followUpThread'

function message(
  role: FollowUpMessage['role'],
  text: string,
  status: FollowUpMessage['status'] = 'complete',
): FollowUpMessage {
  return {
    id: `fu-${role}-${text.slice(0, 8)}`,
    role,
    text,
    createdAt: '2026-06-16T00:00:00.000Z',
    status,
  }
}

describe('flattenFollowUpThread', () => {
  it('renders user and assistant turns as readable text', () => {
    const flattened = flattenFollowUpThread([
      message('user', 'Why Friday?'),
      message('assistant', 'The demo is ready and the team is fresh.'),
    ])

    expect(flattened).toBe('User: Why Friday?\n\nAssistant: The demo is ready and the team is fresh.')
  })

  it('skips empty and whitespace-only messages', () => {
    const flattened = flattenFollowUpThread([
      message('user', 'Why?'),
      message('assistant', ''),
      message('assistant', '   \n  '),
      message('assistant', 'Because.'),
    ])

    expect(flattened).toBe('User: Why?\n\nAssistant: Because.')
  })

  it('skips failed messages even when they carry partial text', () => {
    const flattened = flattenFollowUpThread([
      message('user', 'Why?'),
      message('assistant', 'Half an answ', 'failed'),
    ])

    expect(flattened).toBe('User: Why?')
  })

  it('skips streaming messages even when they carry partial text', () => {
    const flattened = flattenFollowUpThread([
      message('user', 'Why?'),
      message('assistant', 'Half an answ', 'streaming'),
    ])

    expect(flattened).toBe('User: Why?')
  })

  it('includes a reply once it settles from streaming to complete', () => {
    const thread = [message('user', 'Why?'), message('assistant', 'Because.', 'streaming')]
    expect(flattenFollowUpThread(thread)).toBe('User: Why?')

    const settled = thread.map((m) =>
      m.role === 'assistant' ? { ...m, status: 'complete' as const } : m,
    )
    expect(flattenFollowUpThread(settled)).toBe('User: Why?\n\nAssistant: Because.')
  })

  it('includes a reply once it settles from streaming to stopped, marked early', () => {
    const thread = [message('user', 'Why?'), message('assistant', 'Partly because', 'streaming')]
    expect(flattenFollowUpThread(thread)).toBe('User: Why?')

    const settled = thread.map((m) =>
      m.role === 'assistant' ? { ...m, status: 'stopped' as const } : m,
    )
    expect(flattenFollowUpThread(settled)).toBe(
      'User: Why?\n\nAssistant (stopped early): Partly because',
    )
  })

  it('keeps stopped messages and marks them as stopped early', () => {
    const flattened = flattenFollowUpThread([
      message('user', 'Why?'),
      message('assistant', 'Partly because', 'stopped'),
    ])

    expect(flattened).toBe('User: Why?\n\nAssistant (stopped early): Partly because')
  })

  it('returns an empty string for an empty thread', () => {
    expect(flattenFollowUpThread([])).toBe('')
  })
})

describe('followUpDiscussionSection', () => {
  it('labels a thread with content', () => {
    const section = followUpDiscussionSection([message('user', 'Why?'), message('assistant', 'Because.')])

    expect(section).toBe(`${FOLLOW_UP_DISCUSSION_LABEL}\nUser: Why?\n\nAssistant: Because.`)
  })

  it('returns an empty string when nothing in the thread is sayable', () => {
    expect(followUpDiscussionSection([])).toBe('')
    expect(followUpDiscussionSection([message('assistant', '  ', 'complete')])).toBe('')
    expect(followUpDiscussionSection([message('assistant', 'half', 'failed')])).toBe('')
    expect(followUpDiscussionSection([message('assistant', 'half', 'streaming')])).toBe('')
  })
})

describe('settleInterruptedFollowUps', () => {
  it('settles a streaming reply to stopped, keeping its partial text', () => {
    const settled = settleInterruptedFollowUps([
      message('user', 'Why?'),
      message('assistant', 'Half an answ', 'streaming'),
    ])

    expect(settled[1]).toMatchObject({ status: 'stopped', text: 'Half an answ' })
    expect(settled[0]).toMatchObject({ status: 'complete' })
  })

  it('leaves complete, stopped, and failed messages alone', () => {
    const thread = [
      message('user', 'Why?'),
      message('assistant', 'Because.', 'complete'),
      message('assistant', 'Partly', 'stopped'),
      message('assistant', 'half', 'failed'),
      message('assistant', 'still going', 'streaming'),
    ]

    const settled = settleInterruptedFollowUps(thread)

    expect(settled.map((m) => m.status)).toEqual([
      'complete',
      'complete',
      'stopped',
      'failed',
      'stopped',
    ])
  })

  it('returns the same array when nothing is streaming', () => {
    const thread = [message('user', 'Why?'), message('assistant', 'Because.')]

    expect(settleInterruptedFollowUps(thread)).toBe(thread)
  })

  it('makes the settled orphan flow downstream like any other stopped reply', () => {
    const settled = settleInterruptedFollowUps([
      message('user', 'Why?'),
      message('assistant', 'Partly because', 'streaming'),
    ])

    expect(flattenFollowUpThread(settled)).toBe(
      'User: Why?\n\nAssistant (stopped early): Partly because',
    )
  })
})
