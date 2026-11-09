import { defaultConfig, type CoreConfig } from './config'
import type { LiveSnapshot, SpeakingState } from './types'
import type { SessionState } from './session'

// totalWords of the last accepted milestone at or before `tau`, else 0.
// Models the cumulative word count as a step function held constant between
// milestones (design §6.1: "last event at or before", not interpolation).
function wordsAt(state: SessionState, tau: number): number {
  const events = state.wordsEvents
  let lo = 0
  let hi = events.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (events[mid].t <= tau) {
      lo = mid + 1
    } else {
      hi = mid
    }
  }
  const idx = lo - 1
  return idx >= 0 ? events[idx].totalWords : 0
}

// The silence interval containing `t`, or null. Intervals are half-open
// [start, end), so a 0-length silence contains no time. Works at past t because
// closed intervals are stored in the session state (design §6.3).
function findSilenceAt(state: SessionState, t: number): { start: number } | null {
  // Open (in-progress) silence: [openSilenceStart, ∞).
  const openStart = state.openSilenceStart
  if (openStart !== null && openStart <= t) {
    return { start: openStart }
  }
  // Closed silences are sorted by start and non-overlapping (R20), so the
  // rightmost interval with start <= t is the only one that can contain t.
  const silences = state.silences
  let lo = 0
  let hi = silences.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (silences[mid].start <= t) {
      lo = mid + 1
    } else {
      hi = mid
    }
  }
  const idx = lo - 1
  if (idx >= 0 && t < silences[idx].end) {
    return { start: silences[idx].start }
  }
  return null
}

// Live WPM at `t`, or null when there is not enough data (R5/R6).
function wpmAt(state: SessionState, t: number, config: CoreConfig): number | null {
  const firstT = state.firstT
  if (firstT === null) {
    return null
  }
  // Early in the session, clamp the window to the session start (D6/R5).
  const windowStart = Math.max(firstT, t - config.windowMs)
  const windowDuration = t - windowStart
  if (windowDuration < config.minElapsedMs) {
    return null // not enough elapsed time yet (R5/D8); also guards NaN/Infinity (R6)
  }
  // Window is half-open (windowStart, t]: words at windowStart are excluded,
  // words at t are included (last milestone at or before each bound) — design §6.
  const wordsInWindow = wordsAt(state, t) - wordsAt(state, windowStart)
  if (wordsInWindow < config.minWindowWords) {
    return null
  }
  return (wordsInWindow * 60000) / windowDuration
}

// Classify state given a precomputed `wpm`. `paused` has the highest priority (R7).
function classifyState(
  state: SessionState,
  t: number,
  wpm: number | null,
  config: CoreConfig,
): SpeakingState {
  const silence = findSilenceAt(state, t)
  if (silence !== null && t - silence.start > config.pauseThresholdMs) {
    return 'paused' // strictly longer than the threshold (R8)
  }
  if (wpm === null) {
    return 'steady' // R9
  }
  if (wpm > config.steadyMaxWpm) {
    return 'rushing' // R10
  }
  if (wpm < config.steadyMinWpm) {
    return 'slow' // R10
  }
  return 'steady'
}

// Speaking state at time `t`. `t` is a parameter (not only event-arrival time),
// so this works for the live UI ("now") and for summary sampling at past t (design C2).
export function speakingStateAt(
  state: SessionState,
  t: number,
  config: CoreConfig = defaultConfig,
): SpeakingState {
  return classifyState(state, t, wpmAt(state, t, config), config)
}

// Live snapshot at time `t`.
export function liveSnapshot(
  state: SessionState,
  t: number,
  config: CoreConfig = defaultConfig,
): LiveSnapshot {
  const wpm = wpmAt(state, t, config)
  return { t, wpm, state: classifyState(state, t, wpm, config) }
}
