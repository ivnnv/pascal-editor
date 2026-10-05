import { expect, test } from 'bun:test'
import { type WallMoveBridgePlan, WallNode } from '@pascal-app/core'
import {
  buildBridgeWallCreates,
  getWallMoveAlignTargets,
  type LinkedWallSnapshot,
  snapWallMoveProjection,
} from './move-shared'

test('bridge duplicate detection ignores identical wall segments on other levels', () => {
  const source = WallNode.parse({
    id: 'wall_source',
    parentId: 'level_lower',
    start: [0, 0],
    end: [4, 0],
  })
  const stackedWall = WallNode.parse({
    id: 'wall_stacked',
    parentId: 'level_upper',
    start: [0, 0],
    end: [0, 1],
  })
  const bridgePlans: Array<WallMoveBridgePlan<LinkedWallSnapshot>> = [
    {
      wall: source,
      originalPoint: [0, 0],
      movedEndpoint: 'start',
    },
  ]

  const creates = buildBridgeWallCreates({
    bridgePlans,
    nextStart: [0, 1],
    nextEnd: [4, 1],
    existingWalls: [source, stackedWall],
    wallCount: 2,
  })

  expect(creates).toHaveLength(1)
  expect(creates[0]?.parentId).toBe(source.parentId)
  expect(creates[0]?.node).toMatchObject({ start: [0, 0], end: [0, 1] })
})

// A horizontal wall at z = 3.326 (off the 0.5 m grid) moves along z.
const MOVE_ALONG_Z: [number, number] = [0, 1]

test('a wall dragged away can be dropped back on its off-grid start', () => {
  const targets = getWallMoveAlignTargets(3.326, MOVE_ALONG_Z, [])
  expect(snapWallMoveProjection(3.36, targets, 0.5)).toBe(3.326)
})

test('a wall dragged near another wall end lines up with it', () => {
  const neighbour = {
    start: [1.214, 3.522] as [number, number],
    end: [1.214, 3.326] as [number, number],
  }
  const targets = getWallMoveAlignTargets(3.326, MOVE_ALONG_Z, [neighbour])
  expect(snapWallMoveProjection(3.49, targets, 0.5)).toBe(3.522)
})

test('away from every alignment line the drag still follows the grid', () => {
  const targets = getWallMoveAlignTargets(3.326, MOVE_ALONG_Z, [])
  expect(snapWallMoveProjection(3.9, targets, 0.5)).toBe(4)
  expect(snapWallMoveProjection(3.9, targets, 0)).toBe(3.9)
})
