import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  BuildingNode,
  clearSceneHistory,
  createZone,
  generateId,
  initSpaceDetectionSync,
  LevelNode,
  structureChangeBatch,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { installImmediateAnimationFrames } from '../../../editor/src/test-utils/immediate-animation-frames'
import { closeWallSplit, splitWallAt } from './split-session'

// The double-click split: one cut at a point, as one undo step.

const LEVEL = 'level_split_at'
let zoneId: string
let stop = () => {}
let restoreFrames = () => {}

beforeEach(() => {
  restoreFrames = installImmediateAnimationFrames()
  closeWallSplit()
  const building = BuildingNode.parse({ id: 'building_split_at', children: [LEVEL] })
  const level = LevelNode.parse({ id: LEVEL, parentId: building.id })
  useScene.setState({
    nodes: { [building.id]: building, [level.id]: level },
    rootNodeIds: [building.id],
    dirtyNodes: new Set(),
    materials: {},
    collections: {},
    readOnly: false,
  })
  useScene.temporal.getState().resume()
  stop = initSpaceDetectionSync(useScene, { getState: () => ({ spaces: {}, setSpaces: () => {} }) })
  const plan = createZone(useScene.getState().nodes, {
    levelId: LEVEL,
    polygon: [
      [0, 0],
      [8, 0],
      [8, 4],
      [0, 4],
    ],
    enclose: true,
    mintId: generateId,
  })
  useScene.getState().applyNodeChanges(structureChangeBatch(plan.changes))
  zoneId = plan.zoneId
  useViewer.getState().setSelection({ buildingId: building.id, levelId: LEVEL, selectedIds: [] })
  useEditor.setState({ phase: 'structure', mode: 'select', room: { levelId: LEVEL, zoneId } })
  clearSceneHistory()
})
afterEach(() => {
  closeWallSplit()
  stop()
  restoreFrames()
})

const levelWalls = () =>
  Object.values(useScene.getState().nodes).filter(
    (node): node is WallNode => node.type === 'wall' && node.parentId === LEVEL,
  )
const longestWall = () => levelWalls().sort((a, b) => length(b) - length(a))[0] as WallNode
const length = (wall: WallNode) =>
  Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])

test('splitting a wall at a point leaves two walls, undone in one step', () => {
  const before = levelWalls().length
  const wall = longestWall()
  expect(splitWallAt(wall, length(wall) / 2)).toBe(true)
  expect(levelWalls()).toHaveLength(before + 1)
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
})

test('a cut too close to the end of the wall is refused', () => {
  const before = levelWalls().length
  expect(splitWallAt(longestWall(), 0.001)).toBe(false)
  expect(levelWalls()).toHaveLength(before)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
})
