import { expect, test } from 'bun:test'
import { snapWallEndpointToExtension } from './move-shared'

// A wall along z = 0 from x = 2 to x = 6; its continuation runs on past x = 2.
const north = { id: 'wall_north', start: [2, 0], end: [6, 0] } as never

test('a corner near a wall continuation lands on it, where its own x line crosses', () => {
  const snap = snapWallEndpointToExtension([0, 0.06], [0, 0.06], [0, 3], [north])
  expect(snap?.point).toEqual([0, 0])
  expect(snap?.guide.from).toEqual({ x: 2, z: 0 })
})

test('a corner kept on its start x line slides to the crossing', () => {
  const snap = snapWallEndpointToExtension([0.04, 0.07], [0, 0.07], [0, 3], [north])
  expect(snap?.point[0]).toBe(0)
  expect(snap?.point[1]).toBeCloseTo(0)
})

test('nothing happens away from the line or on the wall itself', () => {
  expect(snapWallEndpointToExtension([0, 0.5], [0, 0.5], [0, 3], [north])).toBeNull()
  expect(snapWallEndpointToExtension([4, 0.05], [4, 0.05], [4, 3], [north])).toBeNull()
})

test('a vertical wall continuation works the same, crossing the corner z line', () => {
  const east = { id: 'wall_east', start: [4, 2], end: [4, 6] } as never
  const snap = snapWallEndpointToExtension([3.95, 0], [3.95, 0], [1, 0], [east])
  expect(snap?.point).toEqual([4, 0])
})
