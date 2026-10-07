import { expect, test } from 'bun:test'
import { cornerAngle, snapCornerToAngle } from './wall-drafting'

const a: [number, number] = [0, 0]
const b: [number, number] = [4, 0]

test('a corner near 90° lands on exactly 90°', () => {
  const snap = snapCornerToAngle([2.1, 2.05], a, b)
  expect(snap).not.toBeNull()
  expect(cornerAngle(snap!.point, a, b)?.deg).toBe(90)
})

test('a corner near 60° lands on exactly 60°, on its own side', () => {
  // An equilateral apex sees the base at 60°; nudge it.
  const snap = snapCornerToAngle([2.05, -3.5], a, b)
  expect(snap?.point[1]).toBeLessThan(0)
  expect(cornerAngle(snap!.point, a, b)?.deg).toBe(60)
})

test('far from any step, or a straight run, nothing snaps', () => {
  // About 82°: off 90° by more than the 45° pull and off 75° by more than the light one.
  expect(snapCornerToAngle([2, 2.3], a, b)).toBeNull()
  expect(snapCornerToAngle([2, 0.01], a, b)).toBeNull()
})

test('the badge reads the live angle', () => {
  expect(cornerAngle([0, 0], [1, 0], [0, 1])?.deg).toBe(90)
  expect(cornerAngle([0, 0], [1, 0], [1, 1])?.deg).toBe(45)
})
