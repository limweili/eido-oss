import { useGraph } from '../graph/store'
import { words } from '../shared/words'
import { useDialogs } from '../ui/overlays'

export function useDeleteHighlightTag() {
  const deleteTag = useGraph((state) => state.deleteHighlightTag)
  const { confirm } = useDialogs()

  return async (tagId: string, taggedCount: number) => {
    if (
      taggedCount > 0 &&
      !(await confirm({
        title: words.deleteHighlightTagTitle,
        message: words.deleteHighlightTagMessage,
        confirmLabel: words.deleteHighlightTag,
        tone: 'danger',
      }))
    ) return false
    deleteTag(tagId)
    return true
  }
}
