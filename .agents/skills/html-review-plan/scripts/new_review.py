#!/usr/bin/env python3
"""Create a standalone founder review from bundled assets."""

from __future__ import annotations

import argparse
import html
import re
from datetime import datetime, timezone
from pathlib import Path


SKILL_DIR = Path(__file__).resolve().parents[1]
ASSETS = SKILL_DIR / "assets"


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug[:80] or "founder-review"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--title", required=True)
    parser.add_argument("--epic", required=True, help="Epic, program, migration, or review label")
    parser.add_argument("--source-state", required=True, help="Date plus branch/commit/release provenance")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--report-id", help="Stable lowercase identifier; generated from epic/title when omitted")
    args = parser.parse_args()

    template = (ASSETS / "report-template.html").read_text(encoding="utf-8")
    content = (ASSETS / "content-scaffold.html").read_text(encoding="utf-8")
    css = (ASSETS / "report.css").read_text(encoding="utf-8")
    javascript = (ASSETS / "comment-system.js").read_text(encoding="utf-8")

    values = {
        "TITLE": html.escape(args.title),
        "EPIC_LABEL": html.escape(args.epic),
        "SOURCE_STATE": html.escape(args.source_state),
        "GENERATED_AT": datetime.now(timezone.utc).date().isoformat(),
        "REPORT_ID": slugify(args.report_id or f"{args.epic}-{args.title}"),
    }
    for key, value in values.items():
        content = content.replace(f"{{{{{key}}}}}", value)

    output = template.replace("{{TITLE}}", values["TITLE"])
    output = output.replace("{{REPORT_CSS}}", css.rstrip())
    output = output.replace("{{REPORT_CONTENT}}", content.rstrip())
    output = output.replace("{{COMMENT_JS}}", javascript.rstrip())

    unresolved = sorted(set(re.findall(r"\{\{[A-Z0-9_]+\}\}", output)))
    if unresolved:
        raise SystemExit(f"Unresolved template tokens: {', '.join(unresolved)}")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(output + "\n", encoding="utf-8")
    print(args.output.resolve())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
