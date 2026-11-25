import { Pause, Play } from 'lucide-react'
import type { TimelineProjection, TimelineRange } from '../graph/timeline'
import { playbackEventCountLabel, words } from '../shared/words'
import { IconButton, Picker, type PickerOption } from '../ui/primitives'

type PlaybackSpeed = '2' | '5' | '10'

const SPEED_OPTIONS: readonly PickerOption<PlaybackSpeed>[] = [
  { value: '2', label: words.playbackSpeedDouble },
  { value: '5', label: words.playbackSpeedFive },
  { value: '10', label: words.playbackSpeedTen },
]

export function TimelinePlayback({
  range,
  projection,
  progress,
  playing,
  speed,
  onProgressChange,
  onPlayingChange,
  onSpeedChange,
}: {
  range: TimelineRange | null
  projection: TimelineProjection
  progress: number
  playing: boolean
  speed: number
  onProgressChange: (progress: number) => void
  onPlayingChange: (playing: boolean) => void
  onSpeedChange: (speed: number) => void
}) {
  const scrubFromClientX = (element: HTMLElement, clientX: number) => {
    const rect = element.getBoundingClientRect()
    if (rect.width <= 0) return
    const next = (clientX - rect.left) / rect.width
    onProgressChange(Math.max(0, Math.min(1, next)))
  }

  if (!range) {
    return (
      <div className="timeline-panel empty" role="group" aria-label={words.playback}>
        <div className="timeline-empty-copy">
          <strong>{words.playbackEmptyTitle}</strong>
          <span>{words.playbackEmptyHint}</span>
        </div>
      </div>
    )
  }

  const toggle = () => {
    onPlayingChange(!playing)
  }
  const speedValue = SPEED_OPTIONS.some(option => option.value === String(speed))
    ? String(speed) as PlaybackSpeed
    : '2'

  return (
    <div className="timeline-panel" role="group" aria-label={words.playback}>
      <IconButton
        className="timeline-play"
        variant="primary"
        keyStyle
        label={playing ? words.playbackPause : words.playbackPlay}
        tooltip={playing ? words.playbackPauseHint : words.playbackPlayHint}
        icon={playing
          ? <Pause aria-hidden="true" />
          : <Play aria-hidden="true" fill="currentColor" />}
        disabled={!range}
        onClick={toggle}
      />

      <div
        className="timeline-scrub"
        title={words.playbackScrubHint}
        onPointerDown={(event) => {
          scrubFromClientX(event.currentTarget, event.clientX)
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
          scrubFromClientX(event.currentTarget, event.clientX)
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
          }
        }}
      >
        <div className="timeline-track" aria-hidden="true" />
        <input
          className="e-borderless-focus"
          type="range"
          min={0}
          max={1000}
          value={Math.round(progress * 1000)}
          aria-label={words.playback}
          disabled={!range}
          onChange={(event) => onProgressChange(Number(event.target.value) / 1000)}
        />
      </div>

      <span
        className="timeline-count t-value"
        role="progressbar"
        aria-label={playbackEventCountLabel(projection.eventIndex, projection.eventCount)}
        aria-valuemin={0}
        aria-valuenow={projection.eventIndex}
        aria-valuemax={projection.eventCount}
      >
        {projection.eventIndex}/{projection.eventCount}
      </span>

      <Picker
        className="timeline-speed"
        variant="compact"
        ariaLabel={words.playbackSpeed}
        emptyLabel={words.playbackSpeed}
        value={speedValue}
        options={SPEED_OPTIONS}
        disabled={!range}
        onValueChange={(value) => onSpeedChange(Number(value))}
      />
    </div>
  )
}
