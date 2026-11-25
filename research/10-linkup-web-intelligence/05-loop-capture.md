# 05: The Tool Loop On The Wire

Status: outstanding. No OpenRouter key was available to the session that built
the loop (#961), and the founder's stored key is deliberately out of an
agent's reach, so nothing here is observed yet. What follows is the exact
question, why it is load-bearing, and the runnable script that answers it the
moment a key exists. Nothing in the loop's code assumes the benign answer;
the shape it sends is the documented one, and this capture is what confirms
or corrects it.

## The question (#961, contract point 5)

Eido requests reasoning effort on every call. Reasoning-family models routed
through OpenRouter emit `reasoning_details` in the stream, and OpenRouter's
guidance is that the assistant turn's reasoning must be passed back verbatim
when its tool calls are answered; stripped, the re-request is malformed or
the model silently degrades. Anthropic models are the sharpest case, because
their reasoning blocks are cryptographically signed.

Two sub-questions, both answered by wire evidence only:

1. **Is the echo required?** Does the second request of the loop fail or
   degrade when `reasoning_details` is omitted from the assistant turn?
2. **Is Eido's merge shape accepted?** `reasoning_details` arrives as stream
   deltas. `src/brain/openRouter.ts` merges chunks that share an `index` (or
   an `id`) into one entry whose `text`/`summary`/`data` strings grew across
   the stream, and keeps every other field's freshest value. Does a provider
   accept that reconstruction, signatures included?

The last epic lost a rewrite to exactly this class of unverified provider
assumption (the `web_fetch` capture in
[02-what-this-changes-for-eido.md](02-what-this-changes-for-eido.md)), which
is why this is a named capture and not a code comment.

## What the loop does in the meantime

`streamCompletion` collects `reasoning_details` deltas with the merge above
and echoes the merged entries on the assistant turn whenever any arrived.
This is the documented-correct behaviour, so if the capture confirms it,
nothing changes; if a provider wants a different shape, the collector in
`openRouter.ts` is the one place to fix, and its unit test
(`echoes the assistant turn reasoning back with the tool results`) pins the
current shape so the fix is visible.

## The command

```
OPENROUTER_API_KEY=sk-or-... node capture-loop.mjs
MODEL=anthropic/claude-sonnet-4.5 OPENROUTER_API_KEY=sk-or-... node capture-loop.mjs
```

[capture-loop.mjs](capture-loop.mjs) makes three requests against one toy
function tool (no Linkup involved, no Profile touched, spend well under a
cent): the first turn that produces a tool call, the loop's second request
with the merged reasoning echoed, and the same request with the reasoning
stripped. Every raw SSE body and every parsed reading is written verbatim
into `captures/loop-<timestamp>/`. The comparison line at the end states the
answer: if `b-strip` errors or visibly degrades where `b-echo` does not, the
echo is load-bearing and the merge shape is proven by the `b-echo` success.
Run it at least once against an Anthropic model.

The acceptance criterion on #961 that asks for a live capture of the real
loop over two or more iterations is also satisfied here once a key exists:
run the same script with `MODEL` set to the Idea's model and read the
`a-first-turn` / `b-echo` pair, or run the app with both keys and watch the
trail. Until then that criterion is open, and this file is its owner.
