#!/usr/bin/env node
// The keyed capture for the tool loop (#961), answering contract point 5 with
// wire evidence instead of documentation: does a reasoning-family model routed
// through OpenRouter need its own reasoning echoed back with the tool results,
// and does the merged `reasoning_details` shape Eido sends satisfy it?
//
//   OPENROUTER_API_KEY=sk-or-... node capture-loop.mjs
//   MODEL=anthropic/claude-sonnet-4.5 OPENROUTER_API_KEY=... node capture-loop.mjs
//
// Runs three requests against one toy function tool (no Linkup involved, no
// Eido Profile touched, spend is a fraction of a cent):
//
//   A         the model is nudged into one tool call; the raw SSE is saved and
//             its content, tool calls, and reasoning_details are parsed with
//             the same merge rule src/brain/openRouter.ts uses.
//   B-echo    the second request of the loop, assistant turn WITH its merged
//             reasoning_details, plus the tool result.
//   B-strip   identical, but with reasoning_details removed.
//
// If B-strip errors or visibly degrades where B-echo does not, the echo is
// load-bearing and the merge shape is proven. If both behave, the echo is
// harmless headroom. Either answer closes the question; guessing does not.
// Run it at least once against an Anthropic model, whose reasoning blocks are
// signed and are the likeliest to hard-require a faithful echo.
//
// The key is read from the environment only and is never printed or written.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const KEY = process.env.OPENROUTER_API_KEY
if (!KEY) {
  console.error('Set OPENROUTER_API_KEY. This script refuses to look for a key anywhere else.')
  process.exit(1)
}
const MODEL = process.env.MODEL || 'openai/gpt-5-mini'

const OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  'captures',
  `loop-${new Date().toISOString().replace(/[:.]/g, '-')}`,
)
mkdirSync(OUT, { recursive: true })
console.log(`Recording into ${OUT} with model ${MODEL}`)

const TOOL = {
  type: 'function',
  function: {
    name: 'get_fact',
    description: 'Returns one stored fact by name. The only way to learn it.',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Which fact to fetch.' } },
      required: ['name'],
    },
  },
}

const BASE_MESSAGES = [
  { role: 'system', content: 'You are a careful assistant. Facts are only available through the get_fact tool.' },
  { role: 'user', content: 'Use the get_fact tool to fetch the fact named "launch-window", then state it in one sentence.' },
]

// The same conservative merge src/brain/openRouter.ts applies: chunks sharing
// an index (or an id) are one entry whose text/summary/data grew.
function createReasoningCollector() {
  const GROWING = ['text', 'summary', 'data']
  const order = []
  const byKey = new Map()
  return {
    read(list) {
      if (!Array.isArray(list)) return
      for (const raw of list) {
        if (typeof raw !== 'object' || raw === null) continue
        const key =
          typeof raw.index === 'number' ? `index:${raw.index}` : typeof raw.id === 'string' && raw.id ? `id:${raw.id}` : 'lone'
        const entry = byKey.get(key)
        if (!entry) {
          const fresh = { ...raw }
          byKey.set(key, fresh)
          order.push(fresh)
          continue
        }
        for (const [field, value] of Object.entries(raw)) {
          if (GROWING.includes(field) && typeof value === 'string' && typeof entry[field] === 'string') {
            entry[field] += value
          } else if (value !== undefined && value !== null) {
            entry[field] = value
          }
        }
      }
    },
    entries: () => [...order],
  }
}

async function request(name, body) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const raw = await res.text()
  writeFileSync(join(OUT, `${name}.sse`), raw)
  writeFileSync(join(OUT, `${name}.request.json`), JSON.stringify({ ...body, note: 'sent verbatim' }, null, 2))

  const collector = createReasoningCollector()
  const calls = new Map()
  let content = ''
  let error = res.ok ? null : `http-${res.status}`
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) continue
    const data = trimmed.slice('data:'.length).trim()
    if (data === '[DONE]') continue
    try {
      const json = JSON.parse(data)
      if (json.error) error = JSON.stringify(json.error)
      const delta = json.choices?.[0]?.delta ?? {}
      const message = json.choices?.[0]?.message ?? {}
      for (const source of [delta, message]) {
        collector.read(source.reasoning_details)
        if (Array.isArray(source.tool_calls)) {
          for (const [position, call] of source.tool_calls.entries()) {
            const index = typeof call.index === 'number' ? call.index : position
            const entry = calls.get(index) ?? { name: '', args: '' }
            if (call.id) entry.id = call.id
            if (call.function?.name) entry.name = call.function.name
            if (typeof call.function?.arguments === 'string') {
              entry.args = source === message ? call.function.arguments : entry.args + call.function.arguments
            }
            calls.set(index, entry)
          }
        }
      }
      if (typeof delta.content === 'string') content += delta.content
    } catch {
      /* keepalive */
    }
  }
  const parsed = {
    status: res.status,
    error,
    content,
    toolCalls: [...calls.entries()].map(([index, call]) => ({ id: call.id ?? `call_${index}`, ...call })),
    reasoningDetails: collector.entries(),
  }
  writeFileSync(join(OUT, `${name}.parsed.json`), JSON.stringify(parsed, null, 2))
  return parsed
}

const a = await request('a-first-turn', {
  model: MODEL,
  stream: true,
  reasoning: { effort: 'high' },
  tools: [TOOL],
  messages: BASE_MESSAGES,
})
console.log(`A: status ${a.status}, ${a.toolCalls.length} tool call(s), ${a.reasoningDetails.length} reasoning entrie(s)`)
if (a.toolCalls.length === 0) {
  console.error('The model made no tool call; rerun, or try another MODEL. Nothing to echo yet.')
  process.exit(1)
}

const call = a.toolCalls[0]
const followOn = (withReasoning) => ({
  model: MODEL,
  stream: true,
  reasoning: { effort: 'high' },
  tools: [TOOL],
  messages: [
    ...BASE_MESSAGES,
    {
      role: 'assistant',
      content: a.content,
      tool_calls: [{ id: call.id, type: 'function', function: { name: call.name, arguments: call.args } }],
      ...(withReasoning && a.reasoningDetails.length ? { reasoning_details: a.reasoningDetails } : {}),
    },
    { role: 'tool', tool_call_id: call.id, content: 'The launch window opens 2026-09-01 at 14:00 UTC.' },
  ],
})

const echo = await request('b-echo', followOn(true))
console.log(`B-echo:  status ${echo.status}${echo.error ? `, error ${echo.error}` : ''}, answer: ${echo.content.slice(0, 120)}`)
const strip = await request('b-strip', followOn(false))
console.log(`B-strip: status ${strip.status}${strip.error ? `, error ${strip.error}` : ''}, answer: ${strip.content.slice(0, 120)}`)

console.log('')
console.log('Fold the verbatim files into 05-loop-capture.md. The question is answered by')
console.log('whether b-strip errored or degraded where b-echo did not.')
