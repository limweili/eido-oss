# Live Agent CLI socket latency evidence

Measured 2026-07-22 on macOS arm64 (Darwin 25.5.0, Node 24.12.0).
This is bounded transport evidence for epic #711, not a claim about a complete
mutation or model run.

## Question

Does the packaged Agent CLI's live route add enough local transport latency to
make ordinary Agent discovery feel remote or sluggish?

## Production-shaped route

The measurement executed the ad-hoc-signed packaged `eido` SEA through its
standalone router and packaged native client helper. Requests crossed the real
owner-only Unix socket to the packaged native server helper, then entered a
real Gateway session backed by a synthetic in-memory `profile.status` service.
Every CLI invocation used a disposable proof root:

```text
eido --eido-profile-proof-root=<disposable-root> status
```

The server harness reused `startProfileLiveGatewayServer` and the synthetic
installation pattern owned by `electron/profileLiveGatewayServer.test.ts`.
It did not open an installed Profile. The proof root and sockets were removed
afterward.

## Results

| Seam | Warmups | Samples | Median | p95 | Max | Mean |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Complete packaged CLI route | 20 | 200 | 30.433 ms | 33.468 ms | 79.326 ms | 31.219 ms |
| Native transport/client route, excluding SEA startup and CLI formatting | 25 | 300 | 6.342 ms | 15.714 ms | 29.629 ms | 7.775 ms |

All 220 complete-route calls reported `cli.servedBy: "live"`; all 325 direct
transport requests completed successfully. The complete-route result is the
operator-relevant number: its median includes creating a fresh packaged CLI
process, routing, native framing, and formatting a bounded status response.

## Evidence boundary

This measurement covers macOS local routing and the status read only. It does
not measure SQLite owner work, renderer mutation barriers, delegated model or
provider latency, Windows named pipes, cold machine startup, or a complete
founder workflow. Those boundaries retain their own certification and
walkthrough requirements.
