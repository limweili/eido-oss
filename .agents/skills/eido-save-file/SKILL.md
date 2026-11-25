---
name: eido-save-file
description: Inspect, summarize, compare, document, or extract intent from an explicitly selected legacy pre-SQLite Eido browser save in the eido-v3-ideas.json format. Use only when the user names that legacy JSON source or asks for prototype archaeology; do not treat it as the installed Profile authority or the source of current packaged Eido data.
---

# Eido Save File

## Purpose

Work read-only against an explicitly selected legacy browser-development save, commonly:

`~/.eido/eido-v3-ideas.json`

This format predates the installed SQLite Profile and is not current packaged authority. Use it as a historical source of user intent only when the user explicitly selects it. Prefer source-grounded summaries, preserve IDs and timestamps when useful, and separate explicit saved content from inference.

## Defaults

- Use `/` as `workdir` if the current repo or worktree may no longer exist.
- Treat the save file as private user data. Do not modify it unless the user explicitly asks.
- Prefer `jq` for structured inspection.
- Do not dump the whole file. It may be large.
- Resolve `~` through the current user's home directory and request access only to the exact selected legacy file when needed.
- If comparing against prior state, use only a baseline already present in the conversation or provided by the user. If no baseline exists, say so and provide the current snapshot.

## Core Workflow

Set shell variables once:

```bash
SAVE="${HOME}/.eido/eido-v3-ideas.json"
IDEA_NAME="Eido Main Idea"
```

Confirm the file exists and get size/mtime:

```bash
ls -lh "$SAVE"
```

Inspect top-level shape:

```bash
jq '{version, activeIdeaId, ideaCount:(.ideas|length), boardCount:(.boards|length), keys:keys}' "$SAVE"
```

Locate the target idea:

```bash
jq --arg name "$IDEA_NAME" '.ideas[] | select(.name == $name) | {id,name,createdAt,updatedAt,lastOpenedAt}' "$SAVE"
```

Resolve the board id from the idea instead of hardcoding it:

```bash
IDEA_ID=$(jq -r --arg name "$IDEA_NAME" '.ideas[] | select(.name == $name) | .id' "$SAVE" | head -n 1)
test -n "$IDEA_ID" && echo "$IDEA_ID"
```

Summarize board counts:

```bash
jq --arg id "$IDEA_ID" '.boards[$id] | {
  cardCount:((.cards // [])|length),
  connectionCount:((.connections // [])|length),
  outputCount:((.outputs // [])|length),
  runCount:((.runs // [])|length),
  intentLogCount:((.intentLog // [])|length),
  updatedAt:.updatedAt,
  version:.version
}' "$SAVE"
```

For a compact reusable snapshot:

```bash
jq --arg name "$IDEA_NAME" '
  . as $root
  | $root.ideas[] | select(.name == $name) as $idea
  | $root.boards[$idea.id] as $board
  | {
      idea:{id:$idea.id,name:$idea.name,createdAt:$idea.createdAt,updatedAt:$idea.updatedAt,lastOpenedAt:$idea.lastOpenedAt},
      board:{
        id:$idea.id,
        updatedAt:$board.updatedAt,
        version:$board.version,
        cardCount:(($board.cards // [])|length),
        connectionCount:(($board.connections // [])|length),
        outputCount:(($board.outputs // [])|length),
        runCount:(($board.runs // [])|length),
        intentLogCount:(($board.intentLog // [])|length)
      }
    }
' "$SAVE"
```

## Comparing With A Baseline

When a prior baseline exists, report changes in:

- file modified time and file size
- idea `updatedAt` and `lastOpenedAt`
- board `updatedAt`
- card count
- connection count
- output count
- run count
- intent log count

If no baseline exists, explicitly state that there is no previous scan in context and treat the snapshot as the baseline for future comparisons.

## Finding New Notes Or Items

Cards may not have per-card creation timestamps. Prefer exact comparisons by card id when a prior card inventory exists. Without a prior inventory, infer recency from timestamped surfaces only, and label that as inference.

Important data shape: result cards often have empty card body text. The substantive generated prose usually lives in `outputs[].versions[].text`, linked by `outputs[].resultCardId`. When inspecting Product Vision, Product Strategy, Product Description, Product Bets, PRDs, or other generated artifacts, resolve the result card to its output versions instead of trusting the card block text.

List card inventory:

```bash
jq -r --arg id "$IDEA_ID" '
  (.boards[$id].cards // [])[]
  | [
      .id,
      (.kind // ""),
      (.title // ""),
      (.groupId // ""),
      (.intentSignalSetAt // ""),
      ((.intentSignal // "") | tostring | gsub("\n"; " ") | .[0:120]),
      (([.blocks[]?.text] | join(" ")) | gsub("\n"; " ") | .[0:240])
    ]
  | @tsv
' "$SAVE"
```

List recent intent log events first if `intentLog` exists:

```bash
jq -r --arg id "$IDEA_ID" '
  [(.boards[$id].intentLog // [])[]]
  | sort_by(.at // "")
  | reverse
  | .[0:40][]
  | [
      .id,
      (.at // ""),
      (.type // ""),
      (.cardId // ""),
      ((.data // {}) | tostring | gsub("\n"; " ") | .[0:300])
    ]
  | @tsv
' "$SAVE"
```

List recent output versions:

```bash
jq -r --arg id "$IDEA_ID" '
  [(.boards[$id].outputs // [])[] as $o
    | ($o.versions // [])[]
    | {
        outputId:$o.id,
        versionId:.id,
        createdAt:(.createdAt // ""),
        fromRunId:(.fromRunId // ""),
        text:((.text // "") | gsub("\n"; " ") | .[0:300])
      }
  ]
  | sort_by(.createdAt)
  | reverse
  | .[0:20][]
  | [.outputId, .versionId, .createdAt, .fromRunId, .text]
  | @tsv
' "$SAVE"
```

List output versions with their result-card titles:

```bash
jq -r --arg id "$IDEA_ID" '
  (.boards[$id].cards // []) as $cards
  | (.boards[$id].outputs // [])[] as $o
  | ($cards[]? | select(.id == $o.resultCardId)) as $card
  | ($o.versions // [])[]
  | [
      (.createdAt // ""),
      ($card.title // ""),
      ($o.resultCardId // ""),
      $o.id,
      .id,
      (.fromRunId // ""),
      (((.text // "") | length) | tostring),
      ((.text // "") | split("\n") | map(select(length > 0)) | .[0:4] | join(" | "))
    ]
  | @tsv
' "$SAVE"
```

List recent runs:

```bash
jq -r --arg id "$IDEA_ID" '
  [(.boards[$id].runs // [])[]]
  | sort_by(.startedAt // "")
  | reverse
  | .[0:20][]
  | [
      .id,
      (.startedAt // ""),
      (.finishedAt // ""),
      (.status // ""),
      (.askAiCardId // ""),
      ((.usedCardIds // []) | join(",")),
      ((.usedConnectionIds // []) | join(","))
    ]
  | @tsv
' "$SAVE"
```

## Intent Inspection

Treat these as strongest sources of intent, in order:

- `intentLog` events, when present
- Ask AI card text
- conversation card text
- run `compiledInstruction`
- output versions
- mod cards and their controls
- card `intentSignal` and `intentSignalSetAt`
- connection `role`, `strength`, and `polarity`
- group cards and membership context through `groupId`

Inspect recent run instructions:

```bash
jq -r --arg id "$IDEA_ID" '
  [(.boards[$id].runs // [])[]]
  | sort_by(.startedAt // "")
  | reverse
  | .[0:10][]
  | "---RUN---\nID: \(.id)\nSTARTED: \(.startedAt // "")\nASK: \(.askAiCardId // "")\nTEXT:\n\(.compiledInstruction // "")\n"
' "$SAVE"
```

Inspect likely human-authored intent cards:

```bash
jq -r --arg id "$IDEA_ID" '
  (.boards[$id].cards // [])[]
  | select((.kind // "") as $kind | $kind == "askAi" or $kind == "conversation" or $kind == "note" or $kind == "mod" or $kind == "title")
  | "---CARD---\nID: \(.id)\nKIND: \(.kind // "")\nTITLE: \(.title // "")\nGROUP: \(.groupId // "")\nINTENT_SIGNAL_SET_AT: \(.intentSignalSetAt // "")\nTEXT:\n\(([.blocks[]?.text] | join("\n")))\n"
' "$SAVE"
```

Inspect graph connections:

```bash
jq -r --arg id "$IDEA_ID" '
  (.boards[$id].connections // [])[]
  | [
      .id,
      ((.from.cardId // .from.id // .from // "") | tostring),
      ((.to.cardId // .to.id // .to // "") | tostring),
      (.role // ""),
      (.strength // ""),
      (.polarity // "")
    ]
  | @tsv
' "$SAVE"
```

Inspect group membership:

```bash
jq -r --arg id "$IDEA_ID" '
  (.boards[$id].cards // []) as $cards
  | $cards[]
  | select(.kind == "group")
  | . as $group
  | [
      $group.id,
      ($group.title // ""),
      ([$cards[] | select(.groupId == $group.id) | .id] | join(","))
    ]
  | @tsv
' "$SAVE"
```

## Product Intent Extraction

When the user asks for the latest Eido intent, product vision, product strategy, product description, product bets, or coding-agent context, inspect both timestamped board activity and generated output versions.

Use this query to find likely product-intent artifacts:

```bash
jq -r --arg id "$IDEA_ID" '
  (.boards[$id].cards // []) as $cards
  | [
      (.boards[$id].outputs // [])[] as $o
      | ($cards[]? | select(.id == $o.resultCardId)) as $card
      | ($o.versions // [])[]
      | select(
          (($card.title // "") + " " + (.text // ""))
          | test("Product Description|Product Vision|Pivoted Product Description|Product Strategy|Product bets|Next Product Bets|To Build|Development PRDs|Agentic Coding"; "i")
        )
      | {
          createdAt:(.createdAt // ""),
          title:($card.title // ""),
          resultCardId:($o.resultCardId // ""),
          outputId:$o.id,
          versionId:.id,
          fromRunId:(.fromRunId // ""),
          chars:((.text // "") | length),
          preview:((.text // "") | split("\n") | map(select(length > 0)) | .[0:4] | join(" | "))
        }
    ]
  | sort_by(.createdAt)
  | reverse
  | .[0:20][]
  | [.createdAt, .title, .resultCardId, .outputId, .versionId, .fromRunId, (.chars|tostring), .preview]
  | @tsv
' "$SAVE"
```

Then read only the relevant version text by id:

```bash
jq -r --arg id "$IDEA_ID" --arg version_id "ver_ID_HERE" '
  (.boards[$id].outputs // [])[]
  | (.versions // [])[]
  | select(.id == $version_id)
  | .text
' "$SAVE"
```

Useful recurring Eido board areas include:

- Product Vision
- Product Strategy
- Features planned
- Founder Review Needed
- Product Description result cards
- Product bets / Next Product Bets outputs
- To Build / Development PRDs outputs

Do not assume the newest board edit is the latest build intent. The newest board edit may be a layout, design-reference, or intent-signal change. Compare:

- newest `intentLog` events
- newest card `intentSignalSetAt`
- newest output-version `createdAt`
- newest run `startedAt`

Report these separately when they diverge.

## Writing Repo Intent Docs

When asked to add Eido intent into the repo, prefer the existing `intent/` folder if present.

Use this pattern:

- Keep raw seed material, such as `intent/original idea`, intact.
- Add or update a curated document such as `intent/README.md`.
- Include a scan date and the `Eido Main Idea` board `updatedAt`.
- Separate explicit saved content from inference.
- Preserve source IDs and timestamps in a source-notes section.
- Use latest generated output versions for long Product Vision, Product Strategy, Product Description, Product Bets, and PRD text.
- Check repo docs/source before describing implementation reality. Saved PRDs can be stale relative to current code.

Recommended repo sources to cross-check when documenting current implementation:

- `README.md`
- `TERMINOLOGY.md`
- `docs/codebase/ARCHITECTURE.md`
- `src/graph/types.ts`
- `src/graph/commitFunnel.ts`
- `src/graph/store.ts`
- `src/brain/compiler.ts`

## Reporting

Structure answers as:

1. Current snapshot or changes since baseline.
2. Explicit saved content, with card/run/output/event IDs and timestamps.
3. Inferred product intent, labeled as inference and tied to evidence.
4. Uncertainties, especially when card-level timestamps or prior inventories are missing.

Keep excerpts short. Summarize rather than copying long card text, output text, or run instructions.
