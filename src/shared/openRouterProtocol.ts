import type { ReasoningEffort } from '../graph/types'

export type OpenRouterCompletionAsset = Readonly<{
  kind: 'image' | 'file'
  name: string
  mimeType: string
  dataUrl: string
}>

export type OpenRouterCompletionOptions = Readonly<{
  model: string
  reasoningEffort: ReasoningEffort
  systemPrompt: string
  variationNote?: string
  assets?: readonly OpenRouterCompletionAsset[]
  temperature?: number
}>

type TextContentPart = { type: 'text'; text: string }
type ImageContentPart = { type: 'image_url'; image_url: { url: string } }
type FileContentPart = { type: 'file'; file: { filename: string; file_data: string } }
type ContentPart = TextContentPart | ImageContentPart | FileContentPart

/** Builds an OpenRouter request using the user's selected model and options. */
export function buildOpenRouterCompletionBody(
  instruction: string,
  options: OpenRouterCompletionOptions,
): string {
  const system = eidoSystemInstruction(options.variationNote)

  const content: string | ContentPart[] = options.assets?.length
    ? [
        { type: 'text', text: instruction },
        ...options.assets.map((asset): ImageContentPart | FileContentPart => (
          asset.kind === 'image'
            ? { type: 'image_url', image_url: { url: asset.dataUrl } }
            : { type: 'file', file: { filename: asset.name, file_data: asset.dataUrl } }
        )),
      ]
    : instruction

  const plugins = options.assets?.some((asset) => asset.kind === 'file')
    ? [{ id: 'file-parser', pdf: { engine: 'cloudflare-ai' } }]
    : undefined

  return JSON.stringify({
    model: options.model,
    stream: true,
    temperature: options.temperature,
    reasoning: { effort: options.reasoningEffort },
    ...(plugins ? { plugins } : {}),
    messages: [
      ...(options.systemPrompt.trim()
        ? [{ role: 'system' as const, content: options.systemPrompt.trim() }]
        : []),
      { role: 'system', content: system },
      { role: 'user', content },
    ],
  })
}

function eidoSystemInstruction(variationNote?: string): string {
  return 'You are Eido, a thinking partner. The user has shaped their own thinking into the ' +
    'structured instruction below — task, connected material, and output requirements. ' +
    'Extend their thinking without overriding their framing.' +
    (variationNote ? `\n\n${variationNote}` : '')
}
