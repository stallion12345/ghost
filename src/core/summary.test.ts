import { describe, it, expect } from 'vitest'
import { createSession, ingest } from './session'
import { sessionSummary } from './summary'
import { defaultConfig } from './config'

describe('sessionSummary', () => {
  it('empty session returns a zeroed summary with all-zero percentByState and all keys', () => {
    const s = createSession()
    const sum = sessionSummary(s)
    expect(sum.durationMs).toBe(0)
    expect(sum.totalWords).toBe(0)
    expect(sum.averageWpm).toBe(0)
    expect(sum.pauseCount).toBe(0)
    expect(sum.longestPauseMs).toBe(0)
    expect(sum.percentByState).toEqual({ steady: 0, rushing: 0, slow: 0, paused: 0 })
    expect(Object.keys(sum.percentByState).sort()).toEqual(['paused', 'rushing', 'slow', 'steady'])
  })

  it('percentByState has all four keys, each in [0,100], summing to ~100 for a non-empty session', () => {
    let s = createSession()
    s = ingest(s, { type: 'words', t: 0, totalWords: 5 })
    s = ingest(s, { type: 'words', t: 5000, totalWords: 50 })
    const sum = sessionSummary(s, 10000)
    expect(sum.durationMs).toBeGreaterThan(0)
    expect(Object.keys(sum.percentByState).sort()).toEqual(['paused', 'rushing', 'slow', 'steady'])
    for (const v of Object.values(sum.percentByState)) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(100)
    }
    const total =
      sum.percentByState.steady +
      sum.percentByState.rushing +
      sum.percentByState.slow +
      sum.percentByState.paused
    expect(total).toBeCloseTo(100, 5)
  })

  it('percentByState is all zeros when durationMs is 0 even if events exist', () => {
    let s = createSession()
    s = ingest(s, { type: 'words', t: 5000, totalWords: 5 })
    const sum = sessionSummary(s, 5000) // endT === firstT → durationMs 0
    expect(sum.durationMs).toBe(0)
    expect(sum.percentByState).toEqual({ steady: 0, rushing: 0, slow: 0, paused: 0 })
  })

  it('averageWpm is totalWords over total duration (pauses included); 0 for zero duration; never NaN', () => {
    let s = createSession()
    s = ingest(s, { type: 'words', t: 0, totalWords: 0 }) // firstT = 0, no milestone
    s = ingest(s, { type: 'words', t: 3000, totalWords: 10 }) // 10 words by 3000ms
    s = ingest(s, { type: 'silenceStart', t: 3000 })
    s = ingest(s, { type: 'silenceEnd', t: 60000 }) // 57s pause included in duration
    const sum = sessionSummary(s, 60000)
    // durationMs = 60000 - 0 = 60000ms = 1 min; averageWpm = 10 / 1 = 10
    expect(sum.durationMs).toBe(60000)
    expect(sum.averageWpm).toBeCloseTo(10, 6)
    expect(Number.isFinite(sum.averageWpm)).toBe(true)
    // zero duration → 0, never NaN
    expect(sessionSummary(createSession()).averageWpm).toBe(0)
    expect(Number.isFinite(sessionSummary(createSession()).averageWpm)).toBe(true)
  })

  it('a silence still open at endT counts as a pause only if longer than the threshold (R14)', () => {
    const cfg = { ...defaultConfig, pauseThresholdMs: 2000 }
    // open silence shorter than threshold at endT → not counted
    let s = createSession()
    s = ingest(s, { type: 'silenceStart', t: 8000 }) // at endT 9000 → elapsed 1000 < 2000
    let sum = sessionSummary(s, 9000, cfg)
    expect(sum.pauseCount).toBe(0)
    expect(sum.longestPauseMs).toBe(0)
    // open silence longer than threshold at endT → counted
    let s2 = createSession()
    s2 = ingest(s2, { type: 'silenceStart', t: 5000 }) // at endT 8000 → elapsed 3000 > 2000
    sum = sessionSummary(s2, 8000, cfg)
    expect(sum.pauseCount).toBe(1)
    expect(sum.longestPauseMs).toBe(3000)
  })

  it('endT defaults to the last event time and is clamped to be no earlier than it (R27)', () => {
    let s = createSession()
    s = ingest(s, { type: 'words', t: 1000, totalWords: 5 })
    s = ingest(s, { type: 'words', t: 5000, totalWords: 10 })
    expect(sessionSummary(s).durationMs).toBe(4000) // endT omitted → lastT 5000; 5000 - 1000
    expect(sessionSummary(s, 100).durationMs).toBe(4000) // 100 < lastT 5000 → clamped to 5000
    expect(sessionSummary(s, 9000).durationMs).toBe(8000) // 9000 > lastT → respected; 9000 - 1000
  })

  it('pauseCount counts only pauses longer than the threshold; longestPauseMs is the max', () => {
    const cfg = { ...defaultConfig, pauseThresholdMs: 2000 }
    let s = createSession()
    s = ingest(s, { type: 'silenceStart', t: 0 })
    s = ingest(s, { type: 'silenceEnd', t: 1000 }) // 1000ms < 2000 → not a pause
    s = ingest(s, { type: 'silenceStart', t: 2000 })
    s = ingest(s, { type: 'silenceEnd', t: 5000 }) // 3000ms > 2000 → pause
    s = ingest(s, { type: 'silenceStart', t: 6000 })
    s = ingest(s, { type: 'silenceEnd', t: 12000 }) // 6000ms > 2000 → pause
    const sum = sessionSummary(s, 12000, cfg)
    expect(sum.pauseCount).toBe(2)
    expect(sum.longestPauseMs).toBe(6000)
  })
})
