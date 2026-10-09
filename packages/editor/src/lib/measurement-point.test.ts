import { describe, expect, test } from 'bun:test'
import type { MeasurementPoint } from '../store/use-measurement-draft'
import { type FaceLine, finalizeMeasurePoint, squareOnFace } from './measurement-point'

// A binding that pulls any point onto the face x = 1.253 within 20 cm.
const faceBinding = (point: MeasurementPoint, _target: string | null, maxDistance = 0.2) =>
  Math.abs(point[0] - 1.253) <= maxDistance
    ? {
        point: [1.253, 0, point[2]] as MeasurementPoint,
        semantic: { label: 'Wall face', length: null, snapKind: 'edge' as never },
      }
    : { point }

describe('one resolved measure point', () => {
  test('the marker sits on the point the binding settles, not the pre-binding one', () => {
    const resolved = finalizeMeasurePoint(
      {
        point: [1.3, 0, -2],
        guide: null,
        targetNodeId: 'wall_a',
        markerKind: 'wall',
        markerWallId: 'wall_a',
      },
      faceBinding,
    )
    expect(resolved.point).toEqual([1.253, 0, -2])
    expect(resolved.marker).toMatchObject({ x: 1.253, z: -2, kind: 'wall' })
  })

  test('a binding never drags a point off its axis lock', () => {
    const guide = {
      axis: 'z' as const,
      from: [1.3, 0, 0] as MeasurementPoint,
      to: [1.3, 0, -2] as MeasurementPoint,
      snapped: true,
    }
    const resolved = finalizeMeasurePoint(
      { point: [1.3, 0, -2], guide, targetNodeId: 'wall_a', markerKind: null },
      faceBinding,
    )
    expect(resolved.point).toEqual([1.3, 0, -2])
    expect(resolved.guide?.to).toEqual([1.3, 0, -2])
    expect(resolved.anchor).toBeUndefined()
  })

  test('on an axis lock, a feature the point already lies on still binds', () => {
    const guide = {
      axis: 'z' as const,
      from: [1.253, 0, 0] as MeasurementPoint,
      to: [1.253, 0, -2] as MeasurementPoint,
      snapped: true,
    }
    const resolved = finalizeMeasurePoint(
      { point: [1.253, 0, -2], guide, targetNodeId: 'wall_a', markerKind: 'wall' },
      faceBinding,
    )
    expect(resolved.point).toEqual([1.253, 0, -2])
    expect(resolved.semantic?.label).toBe('Wall face')
  })
})

describe('squaring up on a face', () => {
  // A vertical face at x = 5.643 running from z = -3.564 to z = -0.7.
  const face: FaceLine = { point: [5.643, -3.564], direction: [0, 1], min: 0, max: 2.864 }

  test('lands where the face crosses the horizontal through the previous point', () => {
    expect(squareOnFace(face, [1.253, 0, -1.71])).toEqual([{ axis: 'x', point: [5.643, 0, -1.71] }])
  })

  test('offers nothing past the end of the face', () => {
    expect(squareOnFace(face, [1.253, 0, -4.2])).toEqual([])
  })
})

describe('exact snaps', () => {
  test('a binding never drags a corner snap to a nearby feature end', () => {
    const resolved = finalizeMeasurePoint(
      {
        point: [1.3, 0, -2],
        guide: null,
        targetNodeId: 'wall_a',
        markerKind: 'endpoint',
        exact: true,
      },
      faceBinding,
    )
    expect(resolved.point).toEqual([1.3, 0, -2])
    expect(resolved.marker).toMatchObject({ x: 1.3, z: -2, kind: 'endpoint' })
  })
})
