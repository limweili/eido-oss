import type { IdeaExport, IdeaSummary, SavedBoard } from './types'

export const serializeIdeaExport = (
  idea: IdeaSummary,
  board: SavedBoard,
): string =>
  JSON.stringify(
    { version: 1, exportedAt: new Date().toJSON(), idea, board } satisfies IdeaExport,
    null,
    2,
  )
