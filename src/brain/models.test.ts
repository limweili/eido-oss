import { expect, test } from 'vitest'
import {
  DEFAULT_MODEL,
  DEFAULT_MODEL_SLUGS,
  cleanModelSlug,
  isOpenRouterSlug,
  modelLabel,
} from './models'


test('starts new Ideas with the two shipped OpenRouter models', () => {
  expect(DEFAULT_MODEL).toBe('openai/gpt-5.6-luna')
  expect(DEFAULT_MODEL_SLUGS).toEqual(['openai/gpt-5.6-luna', 'google/gemini-3.7-flash'])
})

test('reads a plain name out of any vendor slug, not only the shipped ones', () => {
  expect(modelLabel('openai/gpt-5.6-luna')).toBe('GPT 5.6 Luna')
  expect(modelLabel('google/gemini-3.7-flash')).toBe('Gemini 3.7 Flash')
  expect(modelLabel('anthropic/claude-opus-5')).toBe('Claude Opus 5')
  expect(modelLabel(undefined)).toBe('GPT 5.6 Luna')
})

test('capitalises a CLI name that is a word and leaves a version-style id alone', () => {
  // A local CLI alias that reads as a word is a name, so it is written as one.
  expect(modelLabel('sonnet')).toBe('Sonnet')
  expect(modelLabel('auto')).toBe('Auto')
  expect(modelLabel('default')).toBe('Default')
  // An id is not prose. Capitalising part of it would invent a model name that
  // does not exist, which is worse than leaving it lowercase.
  expect(modelLabel('gpt-5.6-sol')).toBe('gpt-5.6-sol')
  expect(modelLabel('claude-fable-5')).toBe('claude-fable-5')
  // Nothing after the vendor is nothing to name.
  expect(modelLabel('openai/')).toBe('openai/')
})

test('strips the quotes and spaces a pasted slug arrives wrapped in', () => {
  expect(cleanModelSlug('  "openai/gpt-5.6-luna"  ')).toBe('openai/gpt-5.6-luna')
  expect(cleanModelSlug("'openai/gpt-5.6-luna'")).toBe('openai/gpt-5.6-luna')
  expect(cleanModelSlug('“openai/gpt-5.6-luna”')).toBe('openai/gpt-5.6-luna')
})

test('holds only OpenRouter to the vendor/model shape', () => {
  expect(isOpenRouterSlug('openai/gpt-5.6-luna')).toBe(true)
  expect(isOpenRouterSlug('vendor/arbitrary-valid-model')).toBe(true)
  expect(isOpenRouterSlug('~anthropic/claude-sonnet-latest')).toBe(true)
  expect(isOpenRouterSlug(`~v/${'x'.repeat(157)}`)).toBe(true)
  expect(isOpenRouterSlug('sonnet')).toBe(false)
  expect(isOpenRouterSlug('openai/')).toBe(false)
  expect(isOpenRouterSlug('openai gpt/luna')).toBe(false)
  expect(isOpenRouterSlug('vendor/model/with-extra-slash')).toBe(false)
  expect(isOpenRouterSlug('vendor/model with-space')).toBe(false)
  expect(isOpenRouterSlug(`~v/${'x'.repeat(158)}`)).toBe(false)
  expect(isOpenRouterSlug('véndor/model')).toBe(false)
})
