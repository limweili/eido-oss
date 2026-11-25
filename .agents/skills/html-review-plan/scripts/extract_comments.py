#!/usr/bin/env python3
"""Extract founder comments from a returned standalone review."""

from __future__ import annotations

import argparse
import json
from html.parser import HTMLParser
from pathlib import Path


class CommentDataParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.capture = False
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "script" and dict(attrs).get("id") == "founder-comments-data":
            self.capture = True

    def handle_endtag(self, tag: str) -> None:
        if tag == "script" and self.capture:
            self.capture = False

    def handle_data(self, data: str) -> None:
        if self.capture:
            self.parts.append(data)


def markdown(comments: list[dict]) -> str:
    if not comments:
        return "No matching founder comments.\n"
    lines = [f"# Founder review comments ({len(comments)})", ""]
    for index, comment in enumerate(comments, 1):
        lines.extend([
            f"## {index}. {comment.get('type', 'Comment')} — {comment.get('anchorLabel') or comment.get('anchorId', 'Review')}",
            "",
            f"- ID: `{comment.get('id', '')}`",
            f"- Status: `{comment.get('status', 'open')}`",
            f"- Requires response: `{str(bool(comment.get('requiresAgentResponse'))).lower()}`",
        ])
        if comment.get("quote"):
            lines.extend(["", f"> {comment['quote']}"])
        lines.extend(["", comment.get("body", ""), ""])
    return "\n".join(lines).rstrip() + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path)
    parser.add_argument("--format", choices=["json", "markdown"], default="json")
    parser.add_argument("--status", choices=["open", "resolved", "all"], default="open")
    args = parser.parse_args()

    parsed = CommentDataParser()
    parsed.feed(args.report.read_text(encoding="utf-8"))
    if not parsed.parts:
        raise SystemExit("No founder-comments-data payload found")
    payload = json.loads("".join(parsed.parts))
    comments = [
        comment for comment in payload.get("comments", [])
        if comment.get("authorRole") == "FOUNDER_REVIEW_COMMENT"
        and comment.get("requiresAgentResponse") is True
        and (args.status == "all" or comment.get("status", "open") == args.status)
    ]
    if args.format == "markdown":
        print(markdown(comments), end="")
    else:
        print(json.dumps({"schemaVersion": payload.get("schemaVersion"), "reportId": payload.get("reportId"), "comments": comments}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
