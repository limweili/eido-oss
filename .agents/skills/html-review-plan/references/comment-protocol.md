# Founder comment protocol

## Owner workflow

1. Highlight exact wording and press **Comment here**, or press **Comment on this section**.
2. Choose Question, Change request, Concern, or Approval.
3. Add the comment. It renders beside the passage and in the comment index.
4. Edit, resolve/reopen, or delete as needed.
5. Press **Save commented HTML**.
6. Return the downloaded HTML. The JSON export is only a backup.

The commented HTML is standalone. Comments are embedded in `<script id="founder-comments-data" type="application/json">` and rehydrate when reopened. Browser local storage is convenience state, not the return contract.

## Machine contract

Each comment record uses:

```json
{
  "id": "founder-comment-...",
  "authorRole": "FOUNDER_REVIEW_COMMENT",
  "requiresAgentResponse": true,
  "reportId": "stable-report-id",
  "anchorId": "stable-section-id",
  "anchorLabel": "Human-readable section",
  "inlineTargetId": "optional-highlight-block-id",
  "quote": "optional selected wording",
  "body": "owner comment",
  "type": "Question | Change request | Concern | Approval",
  "status": "open | resolved",
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601"
}
```

Rendered cards also carry:

- `data-founder-comment="true"`
- `data-comment-id`
- `data-author-role="FOUNDER_REVIEW_COMMENT"`
- `data-requires-agent-response="true"`
- `data-status`
- `data-anchor-id`

Deleted IDs remain in `deletedIds` tombstones so stale local state cannot resurrect comments.

## Agent return handling

Extract comments with `scripts/extract_comments.py`. Process open required-response comments in document order. Preserve IDs and quotes in the response ledger. A revised report may mark addressed comments resolved, but never silently delete owner feedback.
