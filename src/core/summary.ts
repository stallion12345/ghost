import { defaultConfig, type CoreConfig } from './config'
import type { SessionState } from './session'
import type { SessionSummary, SpeakingState } from './types'
import { speakingStateAt } from './snapshot'

const ZERO_PERCENT: Record<SpeakingState, number> = {
  steady: 0,
  rushing: 0,
  slow: 0,
  paused: 0,
}

// End-of-session summary. `endT` is optional: the app always passes it; if
// omitted (tests), it defaults to the last event's t and is clamped to be no
// earlier than that (R27). Pure: never mutates `state`.
export function sessionSummary(
  state: SessionState,
  endT?: number,
  config: CoreConfig = defaultConfig,
): SessionSummary {
  const firstT = state.firstT
  const end = Math.max(endT ?? state.lastT, state.lastT) // clamp endT >= lastT (R27)
  // durationMs is measured from firstT (the first accepted event's time) to
  // the clamped end — the same lower bound WPM uses for its elapsed window
  // (wpmAt clamps windowStart to firstT). So durationMs matches the WPM
  // elapsed-time rule. Zero when there are no events.
  const durationMs = firstT === null ? 0 : end - firstT

  const totalWords = state.maxTotalWords
  // Pauses are included in duration (never subtracted); zero duration → 0, never NaN.
  const averageWpm = durationMs > 0 ? totalWords / (durationMs / 60000) : 0

  // Counted pauses: closed silences longer than the threshold, plus the open
  // silence if it exceeds the threshold at endT (R14, strictly longer).
  const pauseLengths: number[] = []
  for (const interval of state.silences) {
    const len = interval.end - interval.start
    if (len > config.pauseThresholdMs) pauseLengths.push(len)
  }
  const openStart = state.openSilenceStart
  if (openStart !== null) {
    const len = end - openStart
    if (len > config.pauseThresholdMs) pauseLengths.push(len)
  }
  const pauseCount = pauseLengths.length
  const longestPauseMs = pauseLengths.length > 0 ? Math.max(...pauseLengths) : 0

  // percentByState: integer sample counts at 0, every sampleStepMs, and endT,
  // divided once at the end. All zeros when durationMs === 0 (R16/D1).
  let percentByState: Record<SpeakingState, number>
  if (durationMs <= 0) {
    percentByState = { ...ZERO_PERCENT }
  } else {
    const counts: Record<SpeakingState, number> = { steady: 0, rushing: 0, slow: 0, paused: 0 }
    const step = config.sampleStepMs
    const k = Math.floor(end / step)
    let n = 0
    for (let i = 0; i <= k; i++) {
      counts[speakingStateAt(state, i * step, config)]++
      n++
    }
    // always sample endT (design §7.4): if end is not on the step grid, add it
    if (k * step !== end) {
      counts[speakingStateAt(state, end, config)]++
      n++
    }
    percentByState = {
      steady: (counts.steady * 100) / n,
      rushing: (counts.rushing * 100) / n,
      slow: (counts.slow * 100) / n,
      paused: (counts.paused * 100) / n,
    }
  }

  return {
    durationMs,
    totalWords,
    averageWpm,
    pauseCount,
    longestPauseMs,
    percentByState,
  }
}
