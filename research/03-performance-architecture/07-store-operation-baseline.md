# Store Operation Baseline

> Date: 2026-06-22
> Related issues: [#88](https://github.com/limweili/eido/issues/88), [#92](https://github.com/limweili/eido/issues/92)
> Status: store benchmark implemented locally; group reconciliation optimized locally

## Command

```sh
npm run perf:store
```

The command measures high-risk Board mutations against deterministic Performance Fixtures. It is baseline-only for now: no hard store budgets are enforced until we collect enough runs and browser measurements.

## Covered Operations

- Card text update
- Output Version text append
- transcript chunk append
- single Card move
- group move
- add Connection
- delete Connection
- add Card
- delete Card
- begin Run / result placeholder
- Undo
- Redo

## Latest Output

Final `perf:report` verification run from 2026-06-22 after group reconciliation optimization:

| Fixture | Operation | Time |
| --- | --- | ---: |
| smoke | setCardText | 0.08ms |
| smoke | appendVersionText | 0.05ms |
| smoke | appendTranscriptChunk | 0.06ms |
| smoke | moveCard | 0.17ms |
| smoke | moveGroup | 0.07ms |
| smoke | addConnection | 0.62ms |
| smoke | deleteConnection | 0.11ms |
| smoke | addCard | 0.26ms |
| smoke | deleteCard | 0.27ms |
| smoke | beginRun | 0.27ms |
| smoke | undo | 0.22ms |
| smoke | redo | 0.27ms |
| medium | setCardText | 0.06ms |
| medium | appendVersionText | 0.04ms |
| medium | appendTranscriptChunk | 0.03ms |
| medium | moveCard | 0.32ms |
| medium | moveGroup | 0.25ms |
| medium | addConnection | 0.59ms |
| medium | deleteConnection | 0.17ms |
| medium | addCard | 0.43ms |
| medium | deleteCard | 0.40ms |
| medium | beginRun | 0.25ms |
| medium | undo | 0.26ms |
| medium | redo | 2.10ms |
| large | setCardText | 0.20ms |
| large | appendVersionText | 0.10ms |
| large | appendTranscriptChunk | 0.07ms |
| large | moveCard | 3.70ms |
| large | moveGroup | 2.42ms |
| large | addConnection | 2.87ms |
| large | deleteConnection | 0.77ms |
| large | addCard | 2.48ms |
| large | deleteCard | 1.53ms |
| large | beginRun | 0.85ms |
| large | undo | 0.95ms |
| large | redo | 9.31ms |

## Before / After Signal

The first store benchmark run identified group reconciliation as the dominant measured store bottleneck:

| Large Fixture Operation | Before | After |
| --- | ---: | ---: |
| moveGroup | 926.92ms | 2.42ms |
| moveCard | 444.73ms | 3.70ms |
| addCard | 216.60ms | 2.48ms |
| redo | 71.87ms | 9.31ms |

The optimization kept group membership behavior intact while precomputing group bounds once per reconciliation and avoiding Card object cloning when membership did not change.

## Remaining Store Risks

- Browser drag performance still needs measurement; store operation speed alone does not prove user-perceived smoothness.
- Redo remains the slowest large-fixture store operation after optimization and should be watched when Graph Index work begins.
- Add Connection timing is noisy and may be affected by duplicate-connection search behavior.
