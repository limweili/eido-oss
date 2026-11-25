# 01: The Linkup API Surface

Status: current as of 2026-08-18. Captured from `https://docs.linkup.so` (full
index at `https://docs.linkup.so/llms.txt`, machine spec at
`https://api.linkup.so/v1/openapi.json`).

This document records what Linkup *is*, in Linkup's own terms. What it means for
Eido is [02-what-this-changes-for-eido.md](02-what-this-changes-for-eido.md).

## What Linkup sells

A web search API built for AI callers rather than for humans. The pitch is
accuracy plus a proprietary index: first on Verified SimpleQA (92% F-score) for
Search, first on SealQA-0 (61%) for Research. Compliance posture is SOC 2 Type
II, ISO 27001, HIPAA, GDPR. Used by Cohere, McKinsey, Polymarket, Legora, SNCF.

The important structural difference from OpenRouter's server tools: Linkup is a
**direct API the caller invokes**. The caller sees every request it makes and
every byte that comes back. Nothing is hidden inside somebody else's completion.

## The five endpoints

| Endpoint | Sync? | Latency | Returns |
| --- | --- | --- | --- |
| `POST /v1/search` | sync | <1s to ~30s by depth | ranked sources, a sourced answer, or a schema-shaped object |
| `POST /v1/fetch` | sync | ~1s | clean markdown for one URL |
| `POST /v1/research` | async | 2 to 20 min | a cited report, polled by id |
| `POST /v1/tasks` | async | 1s to 20 min | batched calls, up to 100 |
| `POST /v1/extract` | async, closed beta | variable | repeated records as rows |

Base URL `https://api.linkup.so/v1`. Auth is `Authorization: Bearer <key>` on
every call. Keys come from `https://app.linkup.so`.

Research is in beta. Extract is in closed beta and needs a $10 minimum balance.

## `/search`

The workhorse. One POST, one answer, no polling.

**Request**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `q` | string | yes | natural-language question, not keywords (except in `fast`) |
| `depth` | `fast` \| `standard` \| `deep` | yes | see the depth table below |
| `outputType` | `searchResults` \| `sourcedAnswer` \| `structured` | yes | |
| `structuredOutputSchema` | JSON string | when `structured` | root must be an object; keep it shallow |
| `includeDomains` | string[] | no | up to 100 |
| `excludeDomains` | string[] | no | |
| `fromDate` / `toDate` | ISO 8601 date | no | preferred over writing dates into `q` |
| `maxResults` | number | no | minimum 1 |
| `includeImages` | boolean | no | default false |
| `includeInlineCitations` | boolean | no | `sourcedAnswer` only |
| `includeSources` | boolean | no | `structured` only; changes the response shape to `{data, sources}` |

**Depth**

| Depth | Mechanism | Latency | Use when |
| --- | --- | --- | --- |
| `fast` | keyword only, no LLM, no scraping | sub-second | high volume, latency critical |
| `standard` | one agentic iteration; can scrape one URL named in the query | 1 to 3s | one well-targeted search answers it |
| `deep` | up to 10 iterations; multi-URL, search-then-scrape chains | 5 to 30s | the next step depends on the previous step's output |

Anti-patterns Linkup names explicitly: putting instructions in a `fast` query
(it reads them as keywords), embedding dates in `q` instead of using the date
filters, and routing LinkedIn URLs to Fetch instead of Search (Fetch cannot
authenticate).

**Response, `searchResults`**

```json
{
  "results": [
    { "type": "text", "name": "Page Title", "url": "https://example.com",
      "content": "Extracted text...", "favicon": "https://example.com/favicon.ico" },
    { "type": "image", "name": "Image Title", "url": "https://example.com/image.jpg" }
  ]
}
```

**Response, `sourcedAnswer`**

```json
{
  "answer": "The answer...",
  "sources": [
    { "name": "Source Title", "url": "https://example.com",
      "favicon": "https://example.com/favicon.ico", "snippet": "Relevant excerpt..." }
  ]
}
```

**Response, `structured`** is the caller's schema, or `{data, sources}` when
`includeSources` is set.

Linkup's own guidance on `outputType`: `searchResults` when an LLM will reason
over the sources, `sourcedAnswer` when a human reads it directly, `structured`
for pipelines.

## `/fetch`

One URL in, clean markdown out. Handles HTML and PDF. Binary formats (zip,
image, video) return 400.

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `url` | URI | required | |
| `mode` | `standard` \| `pro` | `standard` | `pro` is for pages that resist retrieval; markedly higher success rate |
| `renderJs` | boolean | `false` | Linkup advises `true` by default in agentic pipelines, because most modern sites are client-rendered |
| `includeRawContent` | boolean | `false` | returns the raw body plus its content type |
| `includeRawHtml` | boolean | `false` | deprecated, use `includeRawContent` |
| `extractImages` | boolean | `false` | |

**Response**

```json
{
  "favicon": "https://favicons.linkup.so?domain=example.com",
  "markdown": "Clean markdown...",
  "contentType": "html",
  "rawContent": "<!DOCTYPE html>...",
  "images": [{ "alt": "Description", "url": "https://example.com/image.jpg" }]
}
```

`favicon` and `markdown` are the only guaranteed fields.

Limits: HTML 20 MB, PDF 100 MB. No authentication, so a login-walled page
returns only what an anonymous visitor sees.

## `/research`

An autonomous investigator. Submit, poll, collect. This is the endpoint with no
equivalent anywhere in Eido today.

**POST /v1/research**

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `q` | string | required | |
| `outputType` | `sourcedAnswer` \| `structured` | required | no `searchResults` here |
| `mode` | `answer` \| `auto` \| `investigate` \| `research` | `auto` | |
| `reasoningDepth` | `S` \| `M` \| `L` \| `XL` | `L` | drives both time and price |
| `structuredOutputSchema` | JSON object | when `structured` | |
| `includeDomains` / `excludeDomains` | string[] | | 100 max on include |
| `fromDate` / `toDate` | ISO 8601 | | |

Returns immediately:

```json
{
  "id": "01234-abcd-56789", "type": "research", "status": "pending",
  "createdAt": "...", "updatedAt": "...",
  "input": { "...": "echoes the request" }, "output": null, "error": null
}
```

**GET /v1/research/:id** returns the same envelope with `status` in `pending`,
`processing`, `completed`, or `failed`. On `completed`, `output` holds
`{answer, sources[]}` with the same source shape as `/search`.

**Depth, time, and price**

| `reasoningDepth` | Time | Price |
| --- | --- | --- |
| S | 2 to 5 min | $0.25 |
| M | 3 to 7 min | $0.50 |
| L (default) | 5 to 10 min | $1.50 |
| XL | 10 to 20 min | $2.50 |

Poll every 5 to 10 seconds. Faster than once per second is rate-limited.

**Load-bearing limitation:** the polling envelope exposes status and nothing
else. There is no progress fraction, no intermediate step list, no live tool
trail while a Research job runs. Whatever a Research card shows during those
minutes, Eido invents from the request it made and the clock, not from Linkup.

## `/tasks` and `/extract`

`/tasks` batches up to 100 calls under one async job, for bulk and scheduled
work. `/extract` harvests repeated records (products, jobs) into downloadable
rows, is closed beta, costs $2 to $10 per task, and requires a $10 balance.

Neither is on Eido's path today. Recorded so a later reader knows they exist.

## Pricing, whole table

| Call | Price |
| --- | --- |
| search, `fast` or `standard`, `searchResults` | $0.005 |
| search, `fast` or `standard`, `sourcedAnswer` or `structured` | $0.006 |
| search, `deep`, `searchResults` | $0.05 |
| search, `deep`, `sourcedAnswer` or `structured` | $0.055 |
| fetch, standard mode, no JS | $0.001 |
| fetch, standard mode, `renderJs` | $0.005 |
| fetch, pro mode, no JS | $0.005 |
| fetch, pro mode, `renderJs` | $0.01 |
| research S / M / L / XL | $0.25 / $0.50 / $1.50 / $2.50 |
| extract | $2 to $10 |

Credits: a professional-email signup gets $20, topped back up to $20 monthly
for eligible accounts. **No credit is charged when a call errors.** Balance is
readable at `GET /v1/credits/balance`.

There is also an x402 path: pay per request in USDC on Base with no account,
$0.01 minimum, rate-limited per IP rather than per organization. Not relevant
to Eido, recorded for completeness.

## Errors

Every error shares one envelope:

```json
{
  "statusCode": 400,
  "error": {
    "code": "...", "message": "...",
    "details": [{ "field": "...", "message": "..." }]
  }
}
```

| Status | Means |
| --- | --- |
| 400 | bad parameters, no results, oversized file, unsupported content type, unreachable URL |
| 401 | key missing or invalid |
| 402 | x402 payment signature or settlement failure |
| 403 | key lacks permission for the resource |
| 409 | duplicate or conflicting request |
| 429 | rate limit exceeded **or credit balance exhausted** |
| 500 | Linkup's side |

Note that 429 is overloaded: it is both "slow down" and "you are out of money".
Those need different words to a user, and the body's `code` is the only thing
that separates them.

The SDKs map these to named exceptions: `LinkupInvalidRequestError`,
`LinkupNoResultError`, `LinkupAuthenticationError`,
`LinkupInsufficientCreditError`, `LinkupTooManyRequestsError`,
`LinkupFetchError`, `LinkupFetchResponseTooLargeError`,
`LinkupFetchTargetUnreachableError`,
`LinkupFetchUnsupportedContentTypeError`, `LinkupUnknownError`.

## Rate limits

10 queries per second per organization, covering Search and Fetch. Research
polling must stay under 1 per second. Higher limits by arrangement
(contact@linkup.so). The docs do not publish per-minute caps, concurrency
caps, or `Retry-After` semantics.

## The TypeScript SDK

`npm i linkup-sdk`, repo `LinkupPlatform/linkup-js-sdk`.

```typescript
import { LinkupClient } from "linkup-sdk";
const client = new LinkupClient({ apiKey: "<YOUR API KEY>" });

await client.search({
  query: "Which women have been awarded the Physics Nobel Prize",
  depth: "standard",
  outputType: "sourcedAnswer",
});
```

The SDK is a thin wrapper over the same JSON. It documents no streaming, and
no partial results. Every call is request then whole response.

## Tool definitions Linkup publishes

Linkup ships copy-pasteable tool schemas per endpoint, in Anthropic's
`input_schema` shape. The search one, verbatim:

```json
{
  "name": "linkup_search",
  "description": "Searches the live web with an agentic search engine. Returns ranked sources, a sourced natural-language answer, or structured JSON. Use whenever the model needs current facts, specific named entities, recent events, or information that likely isn't in training data.",
  "input_schema": {
    "type": "object",
    "properties": {
      "query": { "type": "string", "description": "Natural-language question or instruction. Be specific. Include the key entity, date range, or domain when known. For chained work (search then scrape), specify the order: 'First find X. Then scrape X. Then extract Y.'" },
      "depth": { "type": "string", "enum": ["fast", "standard", "deep"] },
      "outputType": { "type": "string", "enum": ["searchResults", "sourcedAnswer", "structured"] },
      "structuredOutputSchema": { "type": "string" },
      "includeDomains": { "type": "array", "items": { "type": "string" } },
      "excludeDomains": { "type": "array", "items": { "type": "string" } },
      "fromDate": { "type": "string" },
      "toDate": { "type": "string" }
    },
    "required": ["query", "depth", "outputType"]
  }
}
```

Also published: an agent knowledge pack at
`github.com/LinkupPlatform/linkup-for-agents`, and skills via
`npx skills add LinkupPlatform/skills`.

## The MCP server

`https://mcp.linkup.so/mcp` over HTTP, or `npx -y linkup-mcp-server
apiKey=...` over stdio, or an MCPB bundle for Claude Desktop.

Tools exposed: `linkup-search`, `linkup-fetch`, `linkup-research`,
`linkup-get-research`. Parameters mirror the REST surface.

Claude Code installs it in one line:

```bash
claude mcp add --transport http linkup https://mcp.linkup.so/mcp --header "Authorization: Bearer YOUR_API_KEY"
```

This matters to Eido because four of its five providers are local CLI
harnesses that own their own tool loops.

## Security and privacy

SOC 2 Type II, ISO 27001, HIPAA, GDPR. Zero Data Retention exists but is
**opt-in on an enterprise agreement**, not the default. Queries are processed
across US, EU, Canada, and APAC regions by load, with no locality guarantee on
standard terms. The docs do not state a default retention period; the privacy
contact is privacy@linkup.so.

For a local-first desktop app this is the honest reading: the text of a
Linkup query leaves the user's machine and is processed under standard
commercial terms in an unspecified region. That is the same category of
exposure as the OpenRouter prompt already carries, but it is a second vendor
and a second disclosure.
