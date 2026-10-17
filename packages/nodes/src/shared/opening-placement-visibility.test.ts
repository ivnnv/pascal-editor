import { describe, expect, test } from 'bun:test'
import {
  DoorNode,
  type FloorplanGeometry,
  type GeometryContext,
  WallNode,
  WindowNode,
} from '@pascal-app/core'
import { buildDoorFloorplan } from '../door/floorplan'
import { buildWindowFloorplan } from '../window/floorplan'

const palette = {
  selectedStroke: '#f97316',
  hoveredStroke: '#fb923c',
  wallHoverStroke: '#fb923c',
  handleFill: '#ffffff',
  handleStroke: '#f97316',
}

function dimensionCount(geometry: FloorplanGeometry | null): number {
  if (!geometry) return 0
  if (geometry.kind === 'dimension') return 1
  if (geometry.kind === 'group') return geometry.children.reduce((n, c) => n + dimensionCount(c), 0)
  return 0
}

function plan(opening: DoorNode | WindowNode, moving = false): GeometryContext {
  const wall = WallNode.parse({
    id: 'wall_main',
    parentId: 'level_main',
    children: [opening.id],
    start: [0, 0],
    end: [4, 0],
    thickness: 0.2,
  })
  return {
    resolve: (id) => (id === opening.id ? opening : undefined) as never,
    children: [],
    siblings: [],
    parent: wall,
    viewState: {
      selected: false,
      unit: 'metric',
      highlighted: false,
      hovered: false,
      moving,
      palette,
    },
  }
}

const draft = { isTransient: true }

describe('opening distances while placing', () => {
  test('a door being placed shows its distances to the wall ends', () => {
    const door = DoorNode.parse({
      parentId: 'wall_main',
      position: [1.5, 1.05, 0],
      metadata: draft,
    })

    expect(dimensionCount(buildDoorFloorplan(door, plan(door)))).toBeGreaterThan(0)
  })

  test('a window being placed shows its distances to the wall ends', () => {
    const window = WindowNode.parse({
      parentId: 'wall_main',
      position: [1.5, 1.5, 0],
      metadata: draft,
    })

    expect(dimensionCount(buildWindowFloorplan(window, plan(window)))).toBeGreaterThan(0)
  })

  test('a placed door shows none until it is moved', () => {
    const door = DoorNode.parse({ parentId: 'wall_main', position: [1.5, 1.05, 0] })

    expect(dimensionCount(buildDoorFloorplan(door, plan(door)))).toBe(0)
    expect(dimensionCount(buildDoorFloorplan(door, plan(door, true)))).toBeGreaterThan(0)
  })
})
