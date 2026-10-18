import { afterAll, afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import { LevelNode, useLiveNodeOverrides, useScene, WallNode } from '@pascal-app/core'
import * as editor from '@pascal-app/editor'
import { wallFloorplanMoveTarget } from './floorplan-move'

let snappingMode: 'grid' | 'off' = 'grid'
const snapping = spyOn(editor, 'getActiveSnappingMode').mockImplementation(() => snappingMode)
afterAll(() => snapping.mockRestore())

const modifiers = { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false }
const originalRaf = globalThis.requestAnimationFrame
beforeEach(() => {
  snappingMode = 'grid'
  globalThis.requestAnimationFrame = () => 0
})
afterEach(() => {
  useLiveNodeOverrides.getState().clearAll()
  globalThis.requestAnimationFrame = originalRaf
})

type Spec = [string, [number, number], [number, number], Partial<WallNode>?]

function loadWalls(specs: Spec[]) {
  const level = LevelNode.parse({ id: 'level_snap', level: 0, height: 3, children: [] })
  const walls = specs.map(([id, start, end, extra]) =>
    WallNode.parse({ id, parentId: level.id, start, end, thickness: 0.1, ...extra }),
  )
  const nodes: Record<string, unknown> = Object.fromEntries(walls.map((wall) => [wall.id, wall]))
  nodes[level.id] = { ...level, children: walls.map((wall) => wall.id) }
  useScene.setState({ nodes } as never)
}

function dragWall(id: string, from: [number, number], to: [number, number]) {
  const node = useScene.getState().nodes[id as never] as WallNode
  const session = wallFloorplanMoveTarget({
    node,
    nodes: useScene.getState().nodes,
    sceneApi: {} as never,
  })
  session.apply({ planPoint: from, modifiers })
  session.apply({ planPoint: to, modifiers })
  session.commit?.()
  return useScene.getState().nodes[id as never] as WallNode
}

// The plan from the issue: a 1.044 m wall at x = 2 between two horizontal runs,
// with the walls above and below it left 1.45 cm apart at x = 1.4507 and x = 1.4652.
const ISSUE_PLAN: Spec[] = [
  ['wall_left_top', [0.414, 0.881], [1.4651813507080078, 0.881]],
  ['wall_long', [1.4507073163986206, -0.163], [4.098, -0.163]],
  ['wall_below', [1.4651813507080078, 0.881], [1.465181350708008, 3.25]],
  ['wall_above', [1.4507073163986206, -1.35], [1.4507073163986206, -0.163]],
  ['wall_moved', [2, -0.163], [2, 0.881]],
  ['wall_dot', [2, 0.881], [2, 0.881]],
  ['wall_over', [2, -0.163], [1.4507073163986206, -0.163]],
  ['wall_short', [1.4651813507080078, 0.881], [2, 0.881]],
]

test('a wall dragged near the wall above lands in line with it, straight', () => {
  loadWalls(ISSUE_PLAN)
  const moved = dragWall('wall_moved', [2, 0.3], [1.4547, 0.3])
  expect(moved.start[0]).toBeCloseTo(1.4507073163986206, 6)
  expect(moved.end[0]).toBeCloseTo(1.4507073163986206, 6)
})

test('a wall dragged near the wall below lands in line with it, straight', () => {
  loadWalls(ISSUE_PLAN)
  const moved = dragWall('wall_moved', [2, 0.3], [1.4692, 0.3])
  expect(moved.start[0]).toBeCloseTo(1.4651813507080078, 6)
  expect(moved.end[0]).toBeCloseTo(1.4651813507080078, 6)
})

test('dropped near a corner with snapping off, the wall stays straight where it was put', () => {
  snappingMode = 'off'
  loadWalls(ISSUE_PLAN)
  const moved = dragWall('wall_moved', [2, 0.3], [1.4692, 0.3])
  expect(moved.start[0]).toBeCloseTo(1.4692, 6)
  expect(moved.end[0]).toBeCloseTo(1.4692, 6)
})

// A free-standing wall x = 3 (z 1..3) next to a wall that ends at x = 2 (z = 0).
const FLUSH_PLAN = (justification?: 'a' | 'b'): Spec[] => [
  ['wall_end', [0, 0], [2, 0]],
  ['wall_moved', [3, 1], [3, 3], justification ? { justification } : {}],
]

test('a centred wall lands with a face flush on the end of the wall next to it', () => {
  loadWalls(FLUSH_PLAN())
  // Its left face is at x - 0.05, so x = 2.05 puts that face on the end at x = 2.
  const moved = dragWall('wall_moved', [3, 2], [2.07, 2])
  expect(moved.start[0]).toBeCloseTo(2.05, 6)
  expect(moved.end[0]).toBeCloseTo(2.05, 6)
})

test('a wall justified to one side lands with its real face on the end', () => {
  loadWalls(FLUSH_PLAN('b'))
  // Running +z, face b sits on the +x side of the reference line, 0.1 out.
  const moved = dragWall('wall_moved', [3, 2], [1.92, 2])
  expect(moved.start[0]).toBeCloseTo(1.9, 6)
  expect(moved.end[0]).toBeCloseTo(1.9, 6)
})
