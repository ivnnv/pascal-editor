import { expect, test } from 'bun:test'
import { type WallMoveBridgePlan, WallNode } from '@pascal-app/core'
import {
  buildBridgeWallCreates,
  getWallMoveAlignTargets,
  type LinkedWallSnapshot,
  snapWallEndpointToOrigin,
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

// The Limassol corner at (5.485, 3.326): the pipeline would put it on 0.5 m steps.
const CORNER: [number, number] = [5.485, 3.326]

test('a dragged corner lands back exactly where it started', () => {
  expect(snapWallEndpointToOrigin([5.52, 3.36], [5.714, 3.326], CORNER)).toEqual(CORNER)
})

test('a corner dragged straight down keeps its x', () => {
  expect(snapWallEndpointToOrigin([5.47, 3.9], [5.5, 4], CORNER)).toEqual([5.485, 4])
})

test('a corner dragged sideways keeps its z', () => {
  expect(snapWallEndpointToOrigin([6.2, 3.35], [6.214, 3.5], CORNER)).toEqual([6.214, 3.326])
})

test('a corner dragged away from both lines follows the snap pipeline', () => {
  expect(snapWallEndpointToOrigin([6.2, 3.9], [6.0, 4.0], CORNER)).toEqual([6.0, 4.0])
})
