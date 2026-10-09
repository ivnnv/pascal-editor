import { expect, test } from 'bun:test'
import { WallNode } from '@pascal-app/core'
import { snapWallDraftPointDetailed } from './wall-drafting'

const wall = WallNode.parse({ id: 'wall_a', parentId: 'level_a', start: [0, 0], end: [4, 0] })
// 30 cm from the wall's end, off the line.
const point: [number, number] = [4.3, 0.1]

test('a wall end pulls from 30 cm when zoomed out, not when zoomed in', () => {
  // 20 px per metre: 24 px reach is 1.2 m, capped at the usual 0.7 m.
  expect(snapWallDraftPointDetailed({ point, walls: [wall], planScale: 1 / 20 }).snap).toBe(
    'endpoint',
  )
  // 200 px per metre: 24 px reach is 12 cm.
  expect(snapWallDraftPointDetailed({ point, walls: [wall], planScale: 1 / 200 }).snap).not.toBe(
    'endpoint',
  )
})

test('without a plan scale, walls keep their usual reach', () => {
  expect(snapWallDraftPointDetailed({ point, walls: [wall] }).snap).toBe('endpoint')
})
