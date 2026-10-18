import { expect, test } from 'bun:test'
import { sidewaysMoveSnapTargets, type WallMoveBridgePlan, WallNode } from '@pascal-app/core'
import {
  buildBridgeWallCreates,
  type LinkedWallSnapshot,
  snapWallEndpointToOrigin,
  snapWallMove,
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
const OFF_GRID = WallNode.parse({ id: 'wall_off_grid', start: [0, 3.326], end: [3, 3.326] })

const moveOffGrid = (rawOffset: number, others: WallNode[] = [], gridStep = 0.5) =>
  3.326 +
  snapWallMove({
    wall: OFF_GRID,
    axis: MOVE_ALONG_Z,
    rawOffset,
    targets: sidewaysMoveSnapTargets(OFF_GRID, others),
    gridStep,
  }).offset

test('a wall dragged away can be dropped back on its off-grid start', () => {
  expect(moveOffGrid(0.034)).toBeCloseTo(3.326, 9)
})

test('a wall dragged near another wall end lines up with it', () => {
  const neighbour = WallNode.parse({ id: 'wall_neighbour', start: [5, 3.522], end: [6, 3.522] })
  expect(moveOffGrid(3.49 - 3.326, [neighbour])).toBeCloseTo(3.522, 9)
})

test('a wall dragged near another wall end lines its face up with the end corner', () => {
  // The neighbour runs along z from z = 3.6, so its end corners sit on z = 3.6; the
  // moving wall's face at z + 0.05 lands on them.
  const neighbour = WallNode.parse({ id: 'wall_cap', start: [5, 3.6], end: [5, 6] })
  expect(moveOffGrid(3.53 - 3.326, [neighbour])).toBeCloseTo(3.55, 9)
})

test('a wall joined at a corner offers only its far end', () => {
  const joined = WallNode.parse({ id: 'wall_joined', start: [3, 3.326], end: [3, 5] })
  const targets = sidewaysMoveSnapTargets(OFF_GRID, [joined])
  expect(targets.every((target) => target.kind === 'point')).toBe(true)
  expect(targets.some((target) => target.kind === 'point' && target.point[1] === 3.326)).toBe(false)
})

test('away from every alignment line the drag still follows the grid', () => {
  expect(moveOffGrid(3.9 - 3.326)).toBeCloseTo(4, 9)
  expect(moveOffGrid(3.9 - 3.326, [], 0)).toBeCloseTo(3.9, 9)
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

test('in Smart mode the grid only pulls a moved wall when it is close', () => {
  expect(snapWallMoveProjection(3.62, 0.5, true)).toBe(3.62)
  expect(snapWallMoveProjection(3.96, 0.5, true)).toBe(4)
})
