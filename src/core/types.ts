// Public data types for the core engine. No runtime values here.
// Haunted names (Rushing Wraith, etc.) belong in src/stage, never here (C5).

/** Events fed to the engine. `t` is milliseconds since the session started. */
export type SpeechEvent =
  // cumulative words spoken so far
  | { type: 'words'; t: number; totalWords: number }
  | { type: 'silenceStart'; t: number }
  | { type: 'silenceEnd'; t: number }

export type SpeakingState = 'steady' | 'rushing' | 'slow' | 'paused'

export type LiveSnapshot = {
  t: number
  // null when there is not enough data yet (R5)
  wpm: number | null
  state: SpeakingState
}

export type SessionSummary = {
  durationMs: number
  totalWords: number
  averageWpm: number
  pauseCount: number
  longestPauseMs: number
  // Sums to 100 when durationMs > 0; all zeros when durationMs === 0 (R16/D1)
  percentByState: Record<SpeakingState, number>
}
