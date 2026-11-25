import type { Ref } from 'react'
import { renderMarkdown } from '../shared/markdown'

export function MarkdownPreview({
  text,
  emptyText,
  className,
  contentRef,
}: {
  text: string
  emptyText: string
  className?: string
  contentRef?: Ref<HTMLDivElement>
}) {
  if (!text.trim()) {
    return <div className={`${className ?? ''} result-empty t-prose-s`}>{emptyText}</div>
  }
  return (
    <div
      ref={contentRef}
      className={`${className ?? ''} markdown e-prose t-prose-s`}
      dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }}
    />
  )
}
