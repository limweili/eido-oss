# 03: Live Capture Against The Real API

Status: partial. Unauthenticated captures taken 2026-08-18 from this machine
with `curl`, verbatim below. Everything that needs a real key is listed under
"Outstanding", with a runnable script ([capture-keyed.sh](capture-keyed.sh))
that takes the captures the moment a key exists. Nothing in this document is
inferred; if it is not printed here, it was not observed.

## What was observed without a key

### A missing key is 402 X402_PAYMENT_REQUIRED, not the documented 401

`POST /v1/search` with no `Authorization` header at all:

```
HTTP/2 402
x-ratelimit-limit: 10
x-ratelimit-remaining: 9
x-ratelimit-reset: 1
payment-required: eyJhY2NlcHRzIjpb...   (a base64 x402 challenge: pay per
                                         request in USDC on Base)
content-type: application/json; charset=utf-8

{"error":{"code":"X402_PAYMENT_REQUIRED","details":[],"message":"Payment required"},"statusCode":402}
```

`POST /v1/fetch` with no key answers identically. This contradicts the
published error reference, which says 401 covers a missing key. The mapping in
`src/brain/linkup.ts` therefore keys on the body's `code`, never the status:
a status-keyed mapping would tell a user who has not pasted a key that payment
failed.

### A wrong key is 401 UNAUTHORIZED, distinct from a missing one

`POST /v1/search` with `Authorization: Bearer not-a-real-key`:

```
HTTP/2 401
x-ratelimit-limit: 10
x-ratelimit-remaining: 9
x-ratelimit-reset: 1

{"error":{"code":"UNAUTHORIZED","details":[],"message":"Unauthorized action"},"statusCode":401}
```

So the two auth failures the docs blur into one status are separable on the
wire: no key at all is 402 `X402_PAYMENT_REQUIRED`, a key that is present but
wrong is 401 `UNAUTHORIZED`. Eido maps them to `no-key` and `bad-key` and they
reach the user as different sentences.

### The undocumented rate-limit headers are real, and jittery

Every response above carries `x-ratelimit-limit: 10`,
`x-ratelimit-remaining`, and `x-ratelimit-reset: 1`. Limit 10 with reset 1
matches the published 10 queries per second, so `reset` reads as seconds until
the window turns over.

Under a 24-request parallel burst, `x-ratelimit-remaining` did not count down
monotonically (observed 7, 6, 5, 3, 5, 4, 3, 2, 4 ... across concurrent
responses), which looks like per-node counters rather than one shared one. The
headers are a useful backoff hint and nothing stronger. `linkup.ts` surfaces
them on rate-limit errors when present and never depends on them.

### An unauthenticated burst answers 500, not 429

The same 24-request burst returned a mix of 402 and:

```
HTTP/2 500
{"error":{"code":"INTERNAL_SERVER_ERROR","details":[],"message":"Internal Server Error"},"statusCode":500}
```

No 429 was observed on the unauthenticated path. Whatever rate limiting does,
it happens after authentication, so the real 429 bodies can only be captured
with a key.

### CORS: the renderer can call it directly (re-confirmed)

`OPTIONS /v1/search` from origin `http://localhost:5311`:

```
HTTP/2 204
access-control-allow-origin: http://localhost:5311
vary: Origin, Access-Control-Request-Headers
access-control-allow-methods: GET,HEAD,PUT,PATCH,POST,DELETE
access-control-allow-headers: authorization,content-type
```

Same result as the 2026-08-18 probe in document 02. No main-process bridge is
needed; the packaged CSP widening landed in #957.

## Where observation contradicts the published docs

| Docs say | The wire says |
| --- | --- |
| 401 covers a missing or invalid key | Missing key is 402 `X402_PAYMENT_REQUIRED` with an x402 challenge header; only an invalid key is 401 `UNAUTHORIZED` |
| Rate limiting answers 429 | Unauthenticated bursts answer 500 `INTERNAL_SERVER_ERROR`; the authenticated 429 remains uncaptured |
| No rate-limit headers are documented | `x-ratelimit-limit` / `-remaining` / `-reset` arrive on every response, with non-monotonic `remaining` under load |

## Outstanding: the keyed captures

These need a real key, none was available to this session, and none of them is
guessed at here. Run [capture-keyed.sh](capture-keyed.sh) with
`LINKUP_API_KEY` set; it records every response verbatim into a timestamped
folder and spends well under one dollar. It must answer:

1. **Is a call the caller aborts still billed?** The one question the docs do
   not touch, and cancel copy elsewhere in the epic depends on it. The script
   reads `GET /v1/credits/balance`, starts a `deep` search, kills the
   connection after two seconds, waits, and reads the balance again. A `deep`
   search bills $0.05, so a billed abort is visible in the delta.
2. The verbatim 429 bodies: the rate-limited body code, captured by an
   authenticated burst past 10 requests per second, and the out-of-credit body
   code if the account ever reaches zero (not forceable on demand; capture it
   when it happens). `classifyRefusal` in `linkup.ts` currently matches these
   on tokens (`CREDIT`, `BALANCE`, `INSUFFICIENT`) rather than exact strings;
   the capture should pin the real strings.
3. The verbatim no-result 400 body, from a gibberish query filtered to one
   domain. The suite assumes `SEARCH_QUERY_NO_RESULT` from the SDK's exception
   names; confirm the wire string.
4. A successful search at `standard` and `deep`, and a successful fetch of an
   HTML page and a PDF, confirming the response shapes document 01 records
   from the docs.
