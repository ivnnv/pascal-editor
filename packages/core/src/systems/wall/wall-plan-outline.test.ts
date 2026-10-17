import { expect, test } from 'bun:test'
import { WallNode } from '../../schema'
import { getWallPlanFootprint, getWallPlanOutline } from './wall-footprint'
import { calculateLevelMiters } from './wall-mitering'

const wall = (id: string, start: [number, number], end: [number, number], thickness = 0.1) =>
  WallNode.parse({ id, parentId: 'level', start, end, thickness })

const outlineOf = (walls: WallNode[], target: WallNode) => {
  const miters = calculateLevelMiters(walls)
  const neighbours = walls.filter((w) => w !== target).map((w) => getWallPlanFootprint(w, miters))
  return getWallPlanOutline(target, miters, neighbours) ?? []
}

test('a plain corner keeps only both faces of each wall', () => {
  const a = wall('wall_a', [0, 0], [4, 0])
  const b = wall('wall_b', [4, 0], [4, 3])
  // Two faces plus the free far end; the mitred corner end is left out.
  expect(outlineOf([a, b], a)).toHaveLength(3)
})

test('a thicker wall keeps the exposed shoulder of its end at a T', () => {
  const thick = wall('wall_thick', [-3, 0], [0, 0], 0.4)
  const thin = wall('wall_thin', [0, 0], [3, 0])
  const branch = wall('wall_branch', [0, 0], [0, 3])
  const edges = outlineOf([thick, thin, branch], thick)
  // Some stroke must remain on the thick wall's joined end, below the thin walls.
  const onEnd = edges.filter(([a, b]) => Math.abs(a!.x) < 0.25 && Math.abs(b!.x) < 0.25)
  expect(onEnd.some(([a, b]) => Math.min(a!.y, b!.y) < -0.1)).toBe(true)
})
