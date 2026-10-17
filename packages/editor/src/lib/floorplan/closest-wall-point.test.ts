import { describe, expect, test } from 'bun:test'
import { WallNode } from '@pascal-app/core'
import { findClosestWallPoint } from './closest-wall-point'

const wall = WallNode.parse({ id: 'wall_a', start: [0, 0], end: [4, 0] })

describe('findClosestWallPoint', () => {
  test('reports the front face for a point on the +perpendicular side', () => {
    const hit = findClosestWallPoint([1, 0.2], [wall])

    expect(hit?.normal).toEqual([0, 0, 1])
    expect(hit?.t).toBeCloseTo(0.25)
    expect(hit?.point).toEqual([1, 0])
  })

  test('reports the back face for a point on the other side', () => {
    expect(findClosestWallPoint([1, -0.2], [wall])?.normal).toEqual([0, 0, -1])
  })

  test('the face follows the wall direction, not the plan axes', () => {
    const reversed = WallNode.parse({ id: 'wall_b', start: [4, 0], end: [0, 0] })

    expect(findClosestWallPoint([1, 0.2], [reversed])?.normal).toEqual([0, 0, -1])
  })

  test('ignores walls farther than the snap distance', () => {
    expect(findClosestWallPoint([1, 0.6], [wall])).toBeNull()
  })

  test('picks the nearest of several walls', () => {
    const other = WallNode.parse({ id: 'wall_c', start: [0, 1], end: [4, 1] })

    expect(findClosestWallPoint([2, 0.7], [wall, other])?.wall.id).toBe('wall_c')
  })
})
