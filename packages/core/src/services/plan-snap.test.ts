import { expect, test } from 'bun:test'
import { WallNode } from '../schema/nodes/wall'
import {
  type PlanSnapTarget,
  resolvePlanPointSnap,
  resolvePlanTranslateSnap,
  wallPlanSnapLines,
  wallPlanSnapTargets,
} from './plan-snap'

// A wall along z at x = 3, moved sideways along x.
const moving = WallNode.parse({ id: 'wall_moving', start: [3, 1], end: [3, 3], thickness: 0.2 })
const ALONG_X: [number, number] = [1, 0]

const snapMoving = (offset: number, targets: PlanSnapTarget[], reach = 0.1) =>
  resolvePlanTranslateSnap({
    axis: ALONG_X,
    lines: wallPlanSnapLines(moving),
    offset,
    targets,
    reach,
  })

test('a face lines up with the end corners of another wall', () => {
  const end = WallNode.parse({ id: 'wall_end', start: [0, 0], end: [2, 0], thickness: 0.2 })
  // The face at x - 0.1 lands on the corners at x = 2.
  const snap = snapMoving(-0.88, wallPlanSnapTargets(end))
  expect(snap?.offset).toBeCloseTo(-0.9, 9)
  expect(snap?.line.feature).not.toBe('reference')
})

test('the reference line lines up with another wall end, never a face with it', () => {
  const end: PlanSnapTarget = {
    kind: 'point',
    point: [2, 0],
    nodeId: 'n',
    feature: 'end',
    lines: ['reference'],
  }
  expect(snapMoving(-0.97, [end])?.offset).toBeCloseTo(-1, 9)
  // 0.1 away from where a face would meet it, the reference line is out of reach.
  expect(snapMoving(-0.9 + 0.02, [end])).toBeNull()
})

test('faces line up with a parallel face, and a face across the move is ignored', () => {
  const parallel = WallNode.parse({
    id: 'wall_parallel',
    start: [5, 0],
    end: [5, 4],
    thickness: 0.2,
  })
  const across = WallNode.parse({ id: 'wall_across', start: [4, 5], end: [6, 5], thickness: 0.2 })
  const snap = snapMoving(1.83, [
    ...wallPlanSnapTargets(parallel).filter((t) => t.kind === 'segment'),
    ...wallPlanSnapTargets(across).filter((t) => t.kind === 'segment'),
  ])
  // Moving face x + 0.1 onto the parallel wall's face x = 4.9.
  expect(snap?.offset).toBeCloseTo(1.8, 9)
  expect(snap?.target.nodeId).toBe('wall_parallel')
})

test('faces of a wall justified to one side are its real faces', () => {
  const justified = WallNode.parse({ id: 'wall_j', start: [0, 0], end: [2, 0], justification: 'a' })
  // Running +x, face a sits 0.1 to the +z side and face b on the reference line.
  const corners = wallPlanSnapTargets(justified).filter(
    (t): t is Extract<PlanSnapTarget, { kind: 'point' }> => t.kind === 'point',
  )
  expect(corners.find((t) => t.feature === 'face-a-end')?.point).toEqual([2, 0.1])
  expect(corners.find((t) => t.feature === 'face-b-end')?.point).toEqual([2, 0])
})

test('the nearest match wins, and nothing past reach snaps', () => {
  const near: PlanSnapTarget = {
    kind: 'point',
    point: [2.95, 9],
    nodeId: 'a',
    feature: 'end',
    lines: ['reference'],
  }
  const far: PlanSnapTarget = {
    kind: 'point',
    point: [2.9, 9],
    nodeId: 'b',
    feature: 'end',
    lines: ['reference'],
  }
  expect(snapMoving(-0.06, [far, near])?.target.nodeId).toBe('a')
  expect(snapMoving(-0.5, [far, near])).toBeNull()
})

test('a curved wall offers only its reference ends', () => {
  const arc = WallNode.parse({ id: 'wall_arc', start: [0, 0], end: [2, 0], curveOffset: 1 })
  expect(wallPlanSnapTargets(arc).map((t) => t.feature)).toEqual(['start', 'end'])
})

test('a point held on a line lands where that line crosses a continuation', () => {
  const north = WallNode.parse({ id: 'wall_north', start: [2, 0], end: [6, 0] })
  const snap = resolvePlanPointSnap({
    raw: [0.03, 0.06],
    placed: [0, 0.06],
    along: { point: [0, 3], direction: [0, 1] },
    targets: wallPlanSnapTargets(north),
    reach: 0.1,
    maxShift: 0.3,
  })
  expect(snap?.point[0]).toBeCloseTo(0, 9)
  expect(snap?.point[1]).toBeCloseTo(0, 9)
})
