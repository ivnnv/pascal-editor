import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  type AnyNodeId,
  nodeRegistry,
  registerNode,
  useLiveNodeOverrides,
  useScene,
  WallNode,
} from '@pascal-app/core'
import { useEditor, useInteractionScope } from '@pascal-app/editor'
import { wallDefinition } from './definition'
import { wallMoveEndpointAffordance } from './floorplan-affordances'

globalThis.requestAnimationFrame ??= (callback) => {
  callback(0)
  return 0
}
globalThis.cancelAnimationFrame ??= () => {}

const modifiers = { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false }
const level = 'level_limassol'
const wall = (id: string, start: [number, number], end: [number, number]) =>
  WallNode.parse({ id, parentId: level, start, end, thickness: 0.1 })

// The Limassol walls around the corner that would not go vertical: the dragged
// wall runs from its fixed bottom corner up to a top corner 4 cm right of
// vertical, joined there by the two walls along z = -3.614.
const fixed: [number, number] = [1.2029394996735818, -1.1708486257447501]
const dragged = wall('wall_plan026', [1.243, -3.614], fixed)
const below = wall('wall_below', fixed, [1.2058545351028442, -0.14876365661621094])
const left = wall('wall_left', [1.243, -3.614], [-0.75, -3.614])
const right = wall('wall_right', [1.243, -3.614], [5.692649475069399, -3.61442296878409])

beforeEach(() => {
  if (!nodeRegistry.get('wall')) registerNode(wallDefinition)
  useScene.setState({
    nodes: Object.fromEntries([dragged, below, left, right].map((w) => [w.id, w])) as never,
    readOnly: false,
  })
  useEditor.setState((s) => ({
    mode: 'select',
    snappingModeByContext: Object.fromEntries(
      Object.keys(s.snappingModeByContext).map((key) => [key, 'smart']),
    ) as typeof s.snappingModeByContext,
  }))
  useInteractionScope
    .getState()
    .begin({ kind: 'reshaping', nodeId: dragged.id, reshape: 'endpoint', driver: 'tool' } as never)
})
afterEach(() => {
  useInteractionScope.getState().end()
  useLiveNodeOverrides.getState().clearAll()
})

test('dragging the top corner near vertical lands it exactly vertical, on the top walls line', () => {
  // Grabbed 3 cm off the handle centre, then moved about 4 cm left.
  const grab: [number, number] = [1.27, -3.6]
  const session = wallMoveEndpointAffordance.start({
    node: dragged,
    payload: { wallId: dragged.id, endpoint: 'start' },
    nodes: useScene.getState().nodes,
    initialPlanPoint: grab,
    gridSnapStep: 0.5,
  } as never)
  session.apply({ planPoint: [1.225, -3.59], modifiers })
  session.commit?.()
  const moved = useScene.getState().nodes[dragged.id as AnyNodeId] as WallNode
  expect(moved.start[0]).toBeCloseTo(fixed[0], 6)
  expect(moved.start[1]).toBeCloseTo(-3.614, 6)
})

test('from 4° off vertical, squaring to the near-vertical wall below still lands true vertical', () => {
  const session = wallMoveEndpointAffordance.start({
    node: dragged,
    payload: { wallId: dragged.id, endpoint: 'start' },
    nodes: useScene.getState().nodes,
    initialPlanPoint: [1.243, -3.614],
    gridSnapStep: 0.5,
  } as never)
  // The cursor from the session's logs.
  session.apply({ planPoint: [1.0320309896469118, -3.605904020309448], modifiers })
  session.commit?.()
  const moved = useScene.getState().nodes[dragged.id as AnyNodeId] as WallNode
  expect(moved.start[0]).toBeCloseTo(fixed[0], 6)
})
