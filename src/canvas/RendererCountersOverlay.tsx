import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import {
  readRendererCounterSnapshot,
  type RendererCounterSnapshot,
} from '../performance/rendererCounterRuntime'
import {
  rendererCounterByteLabel,
  rendererCounterNumberLabel,
  words,
} from '../shared/words'
import { RENDERER_COUNTERS_OVERLAY_METRICS } from '../ui/tokens'

export const RENDERER_COUNTER_POLL_INTERVAL_MS = 1_000

type RendererCountersOverlayStyle = CSSProperties & {
  '--e-renderer-counters-width': string
}

const OVERLAY_STYLE: RendererCountersOverlayStyle = {
  '--e-renderer-counters-width': `${RENDERER_COUNTERS_OVERLAY_METRICS.width}px`,
}

type CounterRow = Readonly<{
  label: string
  value: ReactNode
  role?: 'ui' | 'value'
}>

function count(value: number): string {
  return rendererCounterNumberLabel(value)
}

function countOf(value: number, limit: number): ReactNode {
  return <>{count(value)} {words.rendererCountersOf} {count(limit)}</>
}

function bytesOf(value: number, limit: number): ReactNode {
  return <>
    {rendererCounterByteLabel(value)} {words.rendererCountersOf} {rendererCounterByteLabel(limit)}
  </>
}

function weightBudgetState(snapshot: RendererCounterSnapshot): string {
  if (snapshot.weightDemotedCardCount > 0) {
    return words.rendererCountersWeightOverBudget
  }
  if (
    snapshot.detailTextWeightBudget > 0 &&
    snapshot.admittedDetailTextWeight >= snapshot.detailTextWeightBudget
  ) {
    return words.rendererCountersWeightAtLimit
  }
  return words.rendererCountersWeightWithinLimit
}

function CounterGroup({ title, rows }: { title: string; rows: readonly CounterRow[] }) {
  return (
    <section className="renderer-counters__group" aria-label={title}>
      <h3 className="renderer-counters__group-title t-micro">{title}</h3>
      <dl className="renderer-counters__list">
        {rows.map((row) => (
          <div className="renderer-counters__row" key={row.label}>
            <dt className="t-ui">{row.label}</dt>
            <dd className={row.role === 'ui' ? 't-ui' : 't-value'}>{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

export function RendererCountersOverlay({
  readSnapshot = readRendererCounterSnapshot,
}: {
  readSnapshot?: () => RendererCounterSnapshot
}) {
  const [snapshot, setSnapshot] = useState<RendererCounterSnapshot>(() => readSnapshot())

  useEffect(() => {
    const interval = window.setInterval(
      () => setSnapshot(readSnapshot()),
      RENDERER_COUNTER_POLL_INTERVAL_MS,
    )
    return () => window.clearInterval(interval)
  }, [readSnapshot])

  return (
    <aside
      className="renderer-counters"
      role="region"
      aria-label={words.rendererCountersTitle}
      style={OVERLAY_STYLE}
    >
      <header className="renderer-counters__header">
        <h2 className="t-title">{words.rendererCountersTitle}</h2>
        <p className="t-hint">{words.rendererCountersSamplingHint}</p>
      </header>

      <CounterGroup
        title={words.rendererCountersCards}
        rows={[
          {
            label: words.rendererCountersResidentRichCards,
            value: count(snapshot.residentRichCards),
          },
          { label: words.rendererCountersLiveCards, value: count(snapshot.liveCards) },
          {
            label: words.rendererCountersPassiveCards,
            value: countOf(snapshot.passiveCards, snapshot.passiveCardLimit),
          },
          {
            label: words.rendererCountersOversizePassiveCards,
            value: countOf(snapshot.oversizePassiveCards, snapshot.oversizePassiveCardLimit),
          },
        ]}
      />
      <CounterGroup
        title={words.rendererCountersTextWeight}
        rows={[
          {
            label: words.rendererCountersBoardTextWeight,
            value: count(snapshot.boardDetailTextWeight),
          },
          {
            label: words.rendererCountersPassiveTextWeight,
            value: countOf(
              snapshot.admittedDetailTextWeight,
              snapshot.detailTextWeightBudget,
            ),
          },
          {
            label: words.rendererCountersOversizePassiveTextWeight,
            value: count(snapshot.oversizePassiveTextWeight),
          },
          {
            label: words.rendererCountersWeightDemotedCards,
            value: count(snapshot.weightDemotedCardCount),
          },
          {
            label: words.rendererCountersWeightBudgetState,
            value: weightBudgetState(snapshot),
            role: 'ui',
          },
        ]}
      />
      <CounterGroup
        title={words.rendererCountersScene}
        rows={[
          {
            label: words.rendererCountersSceneDerivations,
            value: count(snapshot.sceneDerivations),
          },
        ]}
      />
      <CounterGroup
        title={words.rendererCountersMetrics}
        rows={[
          {
            label: words.rendererCountersMetricDerivations,
            value: count(snapshot.metricDerivations),
          },
          { label: words.rendererCountersMetricVisits, value: count(snapshot.metricVisits) },
          {
            label: words.rendererCountersMetricFullRebuilds,
            value: count(snapshot.metricFullRebuilds),
          },
        ]}
      />
      <CounterGroup
        title={words.rendererCountersRenditions}
        rows={[
          {
            label: words.rendererCountersRenditionEntries,
            value: count(snapshot.renditionEntries),
          },
          {
            label: words.rendererCountersRenditionDecodedBytes,
            value: bytesOf(snapshot.renditionDecodedBytes, snapshot.renditionDecodedByteBudget),
          },
          {
            label: words.rendererCountersRenditionBytes,
            value: bytesOf(snapshot.renditionBytes, snapshot.renditionByteBudget),
          },
        ]}
      />
    </aside>
  )
}
