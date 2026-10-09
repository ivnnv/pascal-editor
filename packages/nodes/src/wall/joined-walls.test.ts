import { expect, test } from 'bun:test'
import type { WallNode } from '@pascal-app/core'
import { findJoinedWalls } from './joined-walls'

const wall = (id: string, start: [number, number], end: [number, number], extra = {}) =>
  ({
    id,
    type: 'wall',
    parentId: 'level',
    start,
    end,
    thickness: 0.2,
    ...extra,
  }) as unknown as WallNode

const selected = wall('wall_a', [0, 0], [4, 0])

test('walls sharing a corner, ending on the side, or under the corner are joined', () => {
  const corner = wall('wall_corner', [4, 0], [4, 3])
  const tee = wall('wall_tee', [2, 3], [2, 0.05])
  const under = wall('wall_under', [-2, -2], [2, 2])
  const apart = wall('wall_apart', [6, 0], [8, 0])
  const joins = findJoinedWalls(selected, [selected, corner, tee, apart])
  expect(joins.map((join) => [join.wall.id, join.at])).toEqual([
    ['wall_corner', 0],
    ['wall_tee', 1],
  ])
  expect(findJoinedWalls(selected, [under])).toHaveLength(1)
})

test('a justified wall only reaches the side its body is on', () => {
  const justified = wall('wall_j', [0, 0], [4, 0], { justification: 'a' })
  // One tee ends 10 cm off each side of the reference line; only one is in the body.
  const up = wall('wall_up', [2, 3], [2, 0.1])
  const down = wall('wall_down', [2, -3], [2, -0.1])
  expect(findJoinedWalls(justified, [up, down])).toHaveLength(1)
})
