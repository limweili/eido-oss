# Performance Budget Report Baseline

> Date: 2026-06-22
> Related issue: [#87](https://github.com/limweili/eido/issues/87)
> Status: implemented locally in v3 app

## Command

```sh
npm run perf:report
```

The command runs the unified performance budget report. It is intentionally excluded from normal `npm test` so day-to-day correctness tests stay fast.

## Current Coverage

The report currently covers Timeline Projector performance across deterministic Performance Fixtures:

- fixture sizes,
- Timeline range calculation,
- Timeline Projector construction,
- maximum individual projection after construction,
- legacy middle projection,
- 100-frame scrub,
- pass/fail budget status.

Future slices will add store operation and browser interaction sections to this same report surface.

## Latest Output

Final `perf:report` verification run from 2026-06-22:

| Fixture | Cards | Connections | Events | Range | Build Projector | Max Projection | Legacy Middle | Scrub 100 Frames |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| smoke | 100 | 200 | 500 | 0.21ms | 0.69ms | 0.07ms | 0.27ms | 2.82ms |
| medium | 1,000 | 2,000 | 5,000 | 0.82ms | 5.48ms | 1.01ms | 1.76ms | 11.52ms |
| large | 5,000 | 10,000 | 50,000 | 7.08ms | 112.17ms | 0.75ms | 22.50ms | 69.43ms |

## Budget Status

| Budget | Target | Actual | Status |
| --- | ---: | ---: | --- |
| large max projector projection | < 5ms | 0.75ms | pass |
| large scrub 100 frames | < 100ms | 69.43ms | pass |

## Notes

Parallel command runs can distort local timing because the benchmark is CPU-sensitive. Use sequential runs when recording baseline numbers.
