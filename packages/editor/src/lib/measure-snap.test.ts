import { describe, expect, test } from 'bun:test'
import { WallNode } from '@pascal-app/core'
import { buildMeasureSnapGeometry, resolveMeasureSnap } from './measure-snap'

const wall = (id: string, start: [number, number], end: [number, number], thickness = 0.1) =>
  WallNode.parse({ id: `wall_${id}`, parentId: 'level_a', start, end, thickness })

// An L: a horizontal wall along z = 0 and a vertical one down x = 0, joined at the origin.
const top = wall('top', [0, 0], [4, 0])
const left = wall('left', [0, 0], [0, 3])
const lShape = buildMeasureSnapGeometry([top, left])
const near = (a: readonly number[], b: readonly number[]) =>
  Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!) < 1e-6

describe('measure snap geometry', () => {
  test('an L offers its inner and outer corners but never the joint centre', () => {
    const corners = lShape.corners.map((c) => c.point)
    expect(corners.some((p) => near(p, [0.05, 0.05]))).toBe(true)
    expect(corners.some((p) => near(p, [-0.05, -0.05]))).toBe(true)
    expect(corners.some((p) => near(p, [0, 0]))).toBe(false)
  })

  test('a T hides the corners buried in the wall it meets', () => {
    const host = wall('host', [-2, 0], [2, 0])
    const stem = wall('stem', [0, 0], [0, 3])
    const { corners } = buildMeasureSnapGeometry([host, stem])
    // The stem's top end sits inside the host; only its two visible shoulders remain.
    const stemCorners = corners.filter((c) => c.wallId === stem.id).map((c) => c.point)
    expect(stemCorners.every((p) => p[1] >= 0.05 - 1e-6)).toBe(true)
  })
})

describe('resolving the pointer', () => {
  test('reach is in screen pixels: 10 cm from a corner catches zoomed out, not zoomed in', () => {
    const pointer: [number, number] = [0.12, 0.12]
    expect(resolveMeasureSnap(lShape, pointer, 20)?.kind).toBe('corner')
    expect(resolveMeasureSnap(lShape, pointer, 200)).toBeNull()
  })

  test('near a face, away from corners, the point lands on that face', () => {
    const face = resolveMeasureSnap(lShape, [0.08, 1.5], 200)
    expect(face?.kind).toBe('face')
    expect(face?.point[0]).toBeCloseTo(0.05)
  })

  test('a held face keeps the point until the pointer leaves its release distance', () => {
    const held = resolveMeasureSnap(lShape, [0.1, 1.5], 200)
    expect(held?.kind).toBe('face')
    // 14 px off the face: past catch (12) but inside release (18).
    const kept = resolveMeasureSnap(lShape, [0.05 + 14 / 200, 1.6], 200, held)
    expect(kept?.kind).toBe('face')
    expect(kept?.point[0]).toBeCloseTo(0.05)
    expect(resolveMeasureSnap(lShape, [0.05 + 14 / 200, 1.6], 200, null)).toBeNull()
    expect(resolveMeasureSnap(lShape, [0.05 + 25 / 200, 1.6], 200, held)).toBeNull()
  })

  test('nothing in the middle of the room', () => {
    expect(resolveMeasureSnap(lShape, [2, 1.5], 200)).toBeNull()
  })
})
