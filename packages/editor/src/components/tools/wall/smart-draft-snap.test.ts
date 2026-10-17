import { expect, test } from 'bun:test'
import { snapSmartDraftPoint } from './wall-drafting'

// A 4.6 m wall from (1.214, 3.75); the dragged corner sits near (5.8, 3.75).
const FIXED: [number, number] = [1.214, 3.75]
const near = (a: [number, number], b: [number, number]) => {
  expect(a[0]).toBeCloseTo(b[0], 6)
  expect(a[1]).toBeCloseTo(b[1], 6)
}

test('a corner within a few degrees of horizontal locks onto 0°', () => {
  const [, z] = snapSmartDraftPoint([5.8, 3.9], FIXED, 0.5)
  expect(z).toBeCloseTo(3.75, 6)
})

test('a corner farther off the axis follows the cursor instead of jumping 15°', () => {
  near(snapSmartDraftPoint([5.8, 4.2], FIXED, 0.5), [5.8, 4.2])
})

test('off the rays, a coordinate only lands on a grid line when it is close', () => {
  near(snapSmartDraftPoint([5.97, 4.2], FIXED, 0.5), [6, 4.2])
})

test('without a fixed corner it is a soft grid', () => {
  near(snapSmartDraftPoint([2.04, 3.3], undefined, 0.5), [2, 3.3])
})
