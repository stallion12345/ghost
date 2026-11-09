import { describe, it, expect } from 'vitest'
import { createSession, ingest } from './session'
import { liveSnapshot, speakingStateAt } from './snapshot'
import { defaultConfig } from './config'

describe('liveSnapshot', () => {
  it('reports t, wpm, and state', () => {
    let s = createSession()
    s = ingest(s, { type: 'words', t: 1000, totalWords: 5 })
    const snap = liveSnapshot(s, 1000, defaultConfig)
    expect(snap.t).toBe(1000)
    expect(snap.wpm).toBeNull() // elapsed 0 at t === firstT
    expect(snap.state).toBe('steady')
  })
})

describe('speakingStateAt', () => {
  it('classifies state from wpm bands (slow / steady / rushing)', () => {
    const cfg = {
      ...defaultConfig,
      windowMs: 10000,
      minWindowWords: 5,
      steadyMinWpm: 100,
      steadyMaxWpm: 200,
    }
    // words at t=0 is a no-progress tie (no milestone); words at t=10000 sets the count.
    // wpm at t=10000 = finalCount * 60000 / 10000 = finalCount * 6.
    const build = (finalCount: number) => {
      let s = createSession()
      s = ingest(s, { type: 'words', t: 0, totalWords: 0 })
      s = ingest(s, { type: 'words', t: 10000, totalWords: finalCount })
      return s
    }
    expect(speakingStateAt(build(10), 10000, cfg)).toBe('slow') // 60 wpm
    expect(speakingStateAt(build(25), 10000, cfg)).toBe('steady') // 150 wpm
    expect(speakingStateAt(build(50), 10000, cfg)).toBe('rushing') // 300 wpm
  })

  it('paused overrides wpm classification (R7)', () => {
    const cfg = { ...defaultConfig, pauseThresholdMs: 2000 }
    let s = createSession()
    s = ingest(s, { type: 'words', t: 0, totalWords: 0 })
    s = ingest(s, { type: 'words', t: 5000, totalWords: 50 }) // rushing wpm
    s = ingest(s, { type: 'silenceStart', t: 5000 }) // open silence
    expect(speakingStateAt(s, 8000, cfg)).toBe('paused') // elapsed 3000 > 2000
  })

  it('pause rule is strictly longer than pauseThresholdMs — open silence', () => {
    const cfg = { ...defaultConfig, pauseThresholdMs: 2000 }
    let s = createSession()
    s = ingest(s, { type: 'silenceStart', t: 1000 }) // open silence
    expect(speakingStateAt(s, 3000, cfg)).toBe('steady') // 3000 - 1000 = 2000 (threshold) → not paused
    expect(speakingStateAt(s, 3001, cfg)).toBe('paused') // 2001 > 2000
  })

  it('pause rule is strictly longer than pauseThresholdMs — closed silence', () => {
    const cfg = { ...defaultConfig, pauseThresholdMs: 2000 }
    let s = createSession()
    s = ingest(s, { type: 'silenceStart', t: 1000 })
    s = ingest(s, { type: 'silenceEnd', t: 5000 }) // closed [1000, 5000)
    expect(speakingStateAt(s, 3000, cfg)).toBe('steady') // elapsed 2000 = threshold
    expect(speakingStateAt(s, 3001, cfg)).toBe('paused') // elapsed 2001 > threshold
  })

  it('uses closed silence intervals for past t', () => {
    let s = createSession()
    s = ingest(s, { type: 'silenceStart', t: 1000 })
    s = ingest(s, { type: 'silenceEnd', t: 4000 }) // closed [1000, 4000)
    s = ingest(s, { type: 'words', t: 5000, totalWords: 5 }) // lastT = 5000
    expect(speakingStateAt(s, 3500, defaultConfig)).toBe('paused') // past t inside the closed silence (elapsed 2500 > 2000)
    expect(speakingStateAt(s, 4500, defaultConfig)).toBe('steady') // past the silence; no milestone yet → wpm null
  })
})

describe('liveSnapshot (windowing)', () => {
  it('uses only events at or before t (past t values work)', () => {
    let s = createSession()
    s = ingest(s, { type: 'words', t: 500, totalWords: 5 })
    s = ingest(s, { type: 'silenceStart', t: 1000 })
    // recorded during the open silence (R25: words don't close a silence)
    s = ingest(s, { type: 'words', t: 2500, totalWords: 15 })
    s = ingest(s, { type: 'silenceEnd', t: 4000 })
    // t=2000 is before the t=2500 milestone → it must not be used
    const past = liveSnapshot(s, 2000, defaultConfig)
    expect(past.wpm).toBeNull() // milestone at 2500 excluded; wordsInWindow 0
    expect(past.state).toBe('steady') // inside closed silence but elapsed 1000 <= threshold; wpm null
    // t=2600 includes the t=2500 milestone
    const later = liveSnapshot(s, 2600, defaultConfig)
    expect(later.wpm).not.toBeNull()
  })

  it('wpm is null at t=0 and when elapsed time is zero (never Infinity/NaN)', () => {
    expect(liveSnapshot(createSession(), 0, defaultConfig).wpm).toBeNull() // no events
    let s2 = createSession()
    s2 = ingest(s2, { type: 'words', t: 0, totalWords: 10 }) // first event at t=0
    expect(liveSnapshot(s2, 0, defaultConfig).wpm).toBeNull() // elapsed 0
    let s3 = createSession()
    s3 = ingest(s3, { type: 'words', t: 500, totalWords: 10 })
    expect(liveSnapshot(s3, 500, defaultConfig).wpm).toBeNull() // t === firstT → elapsed 0
  })

  it('uses the last milestone at or before the window start (equal-timestamp milestones)', () => {
    const cfg = { ...defaultConfig, windowMs: 5000 }
    let s = createSession()
    s = ingest(s, { type: 'words', t: 500, totalWords: 5 })
    s = ingest(s, { type: 'words', t: 500, totalWords: 10 }) // equal t, higher count
    s = ingest(s, { type: 'words', t: 2000, totalWords: 20 })
    // t=5500: window [500, 5500]. base = last milestone at t<=500 = 10 (not 5).
    // wordsInWindow = 20 - 10 = 10 → wpm = 10 * 60000 / 5000 = 120
    expect(liveSnapshot(s, 5500, cfg).wpm).toBeCloseTo(120, 6)
  })
})
