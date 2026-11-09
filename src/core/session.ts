import type { SpeechEvent } from './types'

// Accumulated session state, built purely from events via `ingest`.
// Construct it with `createSession()` and update it with `ingest()`; the shape
// is an implementation detail, not a stable construction contract.
export type SessionState = {
  // Timestamp of the first accepted event; null until the first event arrives.
  firstT: number | null
  // Timestamp of the last accepted event (0 until the first event arrives).
  // Used to clamp `endT` in the summary (R27) and to detect out-of-order events (R2).
  lastT: number
  // Running maximum of `totalWords` seen (drives the R24 decreasing-words ignore rule).
  maxTotalWords: number
  // Start time of the current in-progress silence, or null when not silent.
  openSilenceStart: number | null
  // Closed silence intervals, sorted by start, non-overlapping (R20).
  // Kept so the snapshot/summary can evaluate silence state at past times t.
  silences: Array<{ start: number; end: number }>
  // Accepted word-count milestones (strictly increasing in totalWords), sorted by t.
  // Used to compute WPM over a trailing window (R5).
  wordsEvents: Array<{ t: number; totalWords: number }>
}

export function createSession(): SessionState {
  return {
    firstT: null,
    lastT: 0,
    maxTotalWords: 0,
    openSilenceStart: null,
    silences: [],
    wordsEvents: [],
  }
}

// Fold one event into the state. Pure: never mutates `state`; returns a new
// state, or the same reference when the event is ignored.
export function ingest(state: SessionState, event: SpeechEvent): SessionState {
  // Invalid timestamps (NaN, Infinity, negative) are ignored without throwing.
  if (!Number.isFinite(event.t) || event.t < 0) {
    return state
  }
  // Out-of-order (strictly earlier than the last accepted event) is ignored (R2).
  // Equal timestamps are allowed: t === lastT is NOT out-of-order.
  if (event.t < state.lastT) {
    return state
  }

  if (event.type === 'words') {
    // Invalid word counts (NaN, non-integer) are ignored without throwing.
    if (!Number.isFinite(event.totalWords) || !Number.isInteger(event.totalWords)) {
      return state
    }
    // Decreasing word count is ignored (R24).
    if (event.totalWords < state.maxTotalWords) {
      return state
    }
    const firstT = state.firstT ?? event.t
    // Tie (equal to the running max) is accepted as no-progress:
    // lastT updates, but no new milestone is recorded.
    if (event.totalWords === state.maxTotalWords) {
      return { ...state, firstT, lastT: event.t }
    }
    // Strictly greater: record a new milestone.
    return {
      ...state,
      firstT,
      lastT: event.t,
      maxTotalWords: event.totalWords,
      wordsEvents: [
        ...state.wordsEvents,
        { t: event.t, totalWords: event.totalWords },
      ],
    }
  }

  if (event.type === 'silenceStart') {
    // Already silent: ignored (R26). Only silence events drive silence state
    // (R25); a `words` event never opens or closes a silence (the words branch
    // above does not touch openSilenceStart or silences).
    if (state.openSilenceStart !== null) {
      return state
    }
    return {
      ...state,
      firstT: state.firstT ?? event.t,
      lastT: event.t,
      openSilenceStart: event.t,
    }
  }

  // event.type === 'silenceEnd'
  const start = state.openSilenceStart
  // No open silence: ignored (R26).
  if (start === null) {
    return state
  }
  return {
    ...state,
    lastT: event.t,
    openSilenceStart: null,
    silences: [...state.silences, { start, end: event.t }],
  }
}
