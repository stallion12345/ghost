import { describe, it, expect } from 'vitest'
import { createSession, ingest } from './session'

describe('createSession', () => {
  it('returns a valid empty state', () => {
    const s = createSession()
    expect(s.firstT).toBeNull()
    expect(s.lastT).toBe(0)
    expect(s.maxTotalWords).toBe(0)
    expect(s.openSilenceStart).toBeNull()
    expect(s.silences).toEqual([])
    expect(s.wordsEvents).toEqual([])
  })
})

describe('ingest', () => {
  it('accepts words events and records milestones', () => {
    let s = createSession()
    s = ingest(s, { type: 'words', t: 100, totalWords: 3 })
    s = ingest(s, { type: 'words', t: 200, totalWords: 8 })
    expect(s.firstT).toBe(100)
    expect(s.lastT).toBe(200)
    expect(s.maxTotalWords).toBe(8)
    expect(s.wordsEvents).toEqual([
      { t: 100, totalWords: 3 },
      { t: 200, totalWords: 8 },
    ])
  })

  it('ignores out-of-order events (R2)', () => {
    let s = createSession()
    s = ingest(s, { type: 'words', t: 300, totalWords: 5 })
    s = ingest(s, { type: 'words', t: 100, totalWords: 9 }) // t < lastT
    expect(s.maxTotalWords).toBe(5)
    expect(s.lastT).toBe(300)
    expect(s.wordsEvents).toHaveLength(1)
  })

  it('ignores decreasing totalWords (R24)', () => {
    let s = createSession()
    s = ingest(s, { type: 'words', t: 100, totalWords: 10 })
    s = ingest(s, { type: 'words', t: 200, totalWords: 4 }) // decreasing
    expect(s.maxTotalWords).toBe(10)
    expect(s.lastT).toBe(100)
    expect(s.wordsEvents).toHaveLength(1)
  })

  it('accepts a tie totalWords as no-progress (updates lastT, no milestone)', () => {
    let s = createSession()
    s = ingest(s, { type: 'words', t: 100, totalWords: 7 })
    s = ingest(s, { type: 'words', t: 250, totalWords: 7 }) // tie
    expect(s.maxTotalWords).toBe(7)
    expect(s.wordsEvents).toHaveLength(1) // no new milestone
    expect(s.lastT).toBe(250) // lastT still updates
  })

  it('ignores a duplicate silenceStart while already silent (R26)', () => {
    let s = createSession()
    s = ingest(s, { type: 'silenceStart', t: 500 })
    s = ingest(s, { type: 'silenceStart', t: 700 }) // duplicate
    expect(s.openSilenceStart).toBe(500)
    expect(s.lastT).toBe(500)
    expect(s.silences).toEqual([])
  })

  it('ignores a silenceEnd with no open silence (R26)', () => {
    let s = createSession()
    s = ingest(s, { type: 'silenceEnd', t: 800 }) // no open silence
    expect(s.openSilenceStart).toBeNull()
    expect(s.silences).toEqual([])
    expect(s.lastT).toBe(0)
  })

  it('opens and closes a silence, recording the interval', () => {
    let s = createSession()
    s = ingest(s, { type: 'silenceStart', t: 1000 })
    s = ingest(s, { type: 'silenceEnd', t: 4000 })
    expect(s.openSilenceStart).toBeNull()
    expect(s.silences).toEqual([{ start: 1000, end: 4000 }])
    expect(s.lastT).toBe(4000)
  })

  it('records a 0-length silence for equal start/end timestamps', () => {
    let s = createSession()
    s = ingest(s, { type: 'silenceStart', t: 1000 })
    s = ingest(s, { type: 'silenceEnd', t: 1000 })
    expect(s.silences).toEqual([{ start: 1000, end: 1000 }])
  })

  it('accepts equal timestamps (not treated as out-of-order)', () => {
    let s = createSession()
    s = ingest(s, { type: 'words', t: 100, totalWords: 3 })
    s = ingest(s, { type: 'words', t: 100, totalWords: 6 }) // equal t, accepted
    expect(s.maxTotalWords).toBe(6)
    expect(s.wordsEvents).toHaveLength(2)
    expect(s.lastT).toBe(100)
  })

  it('accepts a silenceStart at the same timestamp as the last event', () => {
    let s = createSession()
    s = ingest(s, { type: 'words', t: 100, totalWords: 3 })
    s = ingest(s, { type: 'silenceStart', t: 100 }) // equal t accepted
    expect(s.openSilenceStart).toBe(100)
    expect(s.lastT).toBe(100)
  })

  it('does not mutate the input state', () => {
    const a = createSession()
    const b = ingest(a, { type: 'words', t: 100, totalWords: 3 })
    expect(b).not.toBe(a) // new object
    expect(a.wordsEvents).toEqual([]) // original untouched
    expect(a.maxTotalWords).toBe(0)

    const c = ingest(b, { type: 'silenceStart', t: 200 })
    expect(c).not.toBe(b)
    expect(b.openSilenceStart).toBeNull() // b untouched
    expect(b.silences).toEqual([])

    const d = ingest(c, { type: 'silenceEnd', t: 500 })
    expect(d.silences).toEqual([{ start: 200, end: 500 }])
    expect(c.silences).toEqual([]) // c untouched
  })
})
