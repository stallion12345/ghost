// All tunable numbers for the core engine, in one place (R21).
// Tests pass a custom CoreConfig; production uses defaultConfig (R23).

export type CoreConfig = {
  /** Rolling window length (ms) for live WPM. */
  windowMs: number
  /** A silence longer than this (ms) counts as a pause. */
  pauseThresholdMs: number
  /** Below this WPM, speaking is "slow". */
  steadyMinWpm: number
  /** Above this WPM, speaking is "rushing". */
  steadyMaxWpm: number
  /** Below this word count in the window, WPM is treated as unknown. */
  minWindowWords: number
  /** Minimum elapsed window (ms) before WPM is reported; below this WPM is null (R5/D8). */
  minElapsedMs: number
  /** Fixed step (ms) for percentByState sampling (design §7.4). */
  sampleStepMs: number
}

export const defaultConfig: CoreConfig = {
  windowMs: 10000,
  pauseThresholdMs: 2000,
  steadyMinWpm: 110,
  steadyMaxWpm: 170,
  minWindowWords: 5,
  minElapsedMs: 3000,
  sampleStepMs: 100,
}
