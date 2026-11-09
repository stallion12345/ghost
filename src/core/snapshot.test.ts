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
    const cfg = { ...defaultConfig, steadyMinWpm: 100, steadyMaxWpm: 200 }
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
    s = ingest(s, { type: 'words', t: 1000, totalWords: 3 }) // firstT = 1000
    s = ingest(s, { type: 'words', t: 2000, totalWords: 8 })
    s = ingest(s, { type: 'words', t: 5000, totalWords: 20 }) // milestone to exclude/include
    // t=4500 is before the t=5000 milestone (excluded); windowDuration = 3500ms (>= minElapsedMs 3000)
    // wordsInWindow = 8 - 3 = 5 over 3500 ms → ~85.7 wpm
    const past = liveSnapshot(s, 4500, defaultConfig)
    expect(past.wpm).not.toBeNull()
    expect(Number(past.wpm)).toBeCloseTo(85.714, 1)
    // t=5500 includes the t=5000 milestone; wordsInWindow = 20 - 3 = 17 over 4500 ms → ~226.7 wpm
    const later = liveSnapshot(s, 5500, defaultConfig)
    expect(later.wpm).not.toBeNull()
    expect(Number(later.wpm)).toBeCloseTo(226.667, 1)
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
    // wordsInWindow = 20 - 10 = 10 over 5000 ms → 120 wpm
    expect(Number(liveSnapshot(s, 5500, cfg).wpm)).toBeCloseTo(120, 6)
  })
})

describe('firstT and early-session WPM', () => {
  it('firstT is the first event time; single early milestone at t=2000, snapshot at t=2500 → steady/null', () => {
    let s = createSession()
    s = ingest(s, { type: 'words', t: 2000, totalWords: 6 })
    const snap = liveSnapshot(s, 2500, defaultConfig)
    // windowDuration = 500 ms < minElapsedMs (3000) → wpm null (not inflated)
    expect(snap.wpm).toBeNull()
    expect(snap.state).toBe('steady')
  })

  it('two early milestones in a short window are reported as unknown (null/steady) due to minElapsedMs', () => {
    let s = createSession()
    s = ingest(s, { type: 'words', t: 2000, totalWords: 6 })
    s = ingest(s, { type: 'words', t: 2400, totalWords: 12 })
    const snap = liveSnapshot(s, 2500, defaultConfig)
    // windowDuration = 500 ms < minElapsedMs (3000) → null, even though wordsInWindow would be 6
    expect(snap.wpm).toBeNull()
    expect(snap.state).toBe('steady')
  })
})

describe('minElapsedMs boundary', () => {
  it('2999 ms elapsed → null (below minElapsedMs)', () => {
    let s = createSession()
    s = ingest(s, { type: 'words', t: 1000, totalWords: 3 }) // firstT = 1000
    s = ingest(s, { type: 'words', t: 2000, totalWords: 9 })
    // t = 3999 → windowDuration = 2999 ms < minElapsedMs (3000) → null
    expect(liveSnapshot(s, 3999, defaultConfig).wpm).toBeNull()
  })

  it('3000 ms elapsed → computes (exactly equal to minElapsedMs)', () => {
    let s = createSession()
    s = ingest(s, { type: 'words', t: 1000, totalWords: 3 })
    s = ingest(s, { type: 'words', t: 2000, totalWords: 9 })
    // t = 4000 → windowDuration = 3000 ms (== minElapsedMs) → computes.
    // wordsInWindow = 9 - 3 = 6 over 3000 ms → 120 wpm
    expect(Number(liveSnapshot(s, 4000, defaultConfig).wpm)).toBeCloseTo(120, 6)
  })
})

describe('closed silence state across the threshold', () => {
  it('closed silence [1000, 4000) is steady at t=2900 (1900 ms in) and paused at t=3500', () => {
    let s = createSession()
    s = ingest(s, { type: 'silenceStart', t: 1000 })
    s = ingest(s, { type: 'silenceEnd', t: 4000 }) // closed [1000, 4000)
    expect(speakingStateAt(s, 2900, defaultConfig)).toBe('steady') // elapsed 1900 <= 2000
    expect(speakingStateAt(s, 3500, defaultConfig)).toBe('paused') // elapsed 2500 > 2000
  })
})

describe('liveSnapshot performance', () => {
  it('runs 10,000 liveSnapshots on a 20,000-event / 30-min session in under 3 seconds', () => {
    const durationMs = 30 * 60 * 1000 // 1,800,000 ms
    const eventCount = 20000
    let s = createSession()
    for (let i = 0; i < eventCount; i++) {
      const t = Math.round((i / eventCount) * durationMs)
      const phase = i % 10
      if (phase < 8) {
        s = ingest(s, { type: 'words', t, totalWords: i + 1 })
      } else if (phase === 8) {
        s = ingest(s, { type: 'silenceStart', t })
      } else {
        s = ingest(s, { type: 'silenceEnd', t })
      }
    }
    expect(s.wordsEvents.length).toBeGreaterThan(1000)
    expect(s.silences.length).toBeGreaterThan(100)

    const samples = 10000
    const start = performance.now()
    for (let i = 0; i < samples; i++) {
      const t = Math.round((i / samples) * durationMs)
      liveSnapshot(s, t, defaultConfig)
    }
    const elapsedMs = performance.now() - start
    expect(elapsedMs).toBeLessThan(3000)
  })
})
