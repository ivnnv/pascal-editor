import { describe, expect, test } from 'bun:test'
import { planSnapReach, zoomSnapReachScale } from './snap-reach'

describe('zoomSnapReachScale', () => {
  test('full reach at the tuned zoom and further out', () => {
    expect(zoomSnapReachScale(0.01)).toBe(1)
    expect(zoomSnapReachScale(0.05)).toBe(1)
    expect(zoomSnapReachScale(null)).toBe(1)
  })

  test('shrinks zoomed in, down to 30%', () => {
    expect(zoomSnapReachScale(0.005)).toBeCloseTo(0.5)
    expect(zoomSnapReachScale(0.001)).toBe(0.3)
  })
})

describe('planSnapReach', () => {
  test('a pixel reach in metres at the zoom, capped at the usual metres', () => {
    expect(planSnapReach(10, 0.01, 1)).toBeCloseTo(0.1)
    expect(planSnapReach(10, 0.05, 0.08)).toBe(0.08)
  })

  test('zoomed far in it lets a 1 cm move through', () => {
    expect(planSnapReach(14, 0.0033, 1)).toBeLessThan(0.02)
  })
})
