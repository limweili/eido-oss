import type { ModContext } from '../mods/prompt'

export const MODS_PREAMBLE =
  'Mods are hand-set controls the user tuned for this request. Each one\n' +
  'states how to read its values, then speaks them. Follow them exactly.'

export function renderModBlockEntry(context: ModContext): string {
  return [
    `### ${context.title}`,
    `How to read it: ${context.treatment}`,
    ...context.sentences.map(({ text }) => `- ${text}`),
  ].join('\n')
}

export function renderModsBlock(contexts: readonly ModContext[]): string | undefined {
  if (contexts.length === 0) return undefined
  return [
    `## MODS\n${MODS_PREAMBLE}`,
    ...contexts.map(renderModBlockEntry),
  ].join('\n\n')
}
