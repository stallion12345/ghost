// Explicit imports: Vitest globals are intentionally off (no tsconfig change).
import { describe, it, expect } from 'vitest'
import { defaultConfig } from './config'

describe('defaultConfig', () => {
  const numericKeys = [
    'windowMs',
    'pauseThresholdMs',
    'steadyMinWpm',
    'steadyMaxWpm',
    'minWindowWords',
    'minElapsedMs',
    'sampleStepMs',
  ] as const

  it('has all numeric values positive and finite', () => {
    for (const key of numericKeys) {
      const value = defaultConfig[key]
      expect(Number.isFinite(value)).toBe(true)
      expect(value).toBeGreaterThan(0)
    }
  })

  it('keeps steadyMinWpm below steadyMaxWpm', () => {
    expect(defaultConfig.steadyMinWpm).toBeLessThan(defaultConfig.steadyMaxWpm)
  })
})
