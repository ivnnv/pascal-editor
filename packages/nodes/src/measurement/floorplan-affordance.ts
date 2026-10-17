import {
  type FloorplanAffordance,
  type FloorplanAffordanceSession,
  type MeasurementAnchor,
  MeasurementNode,
  type MeasurementNode as MeasurementNodeType,
  type MeasurementPoint,
  resolveLevelId,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { getPlanSnapScale, resolveLevelMeasureSnap } from '@pascal-app/editor'
import {
  constrainMeasurementPlanEditPoint,
  measurementEditAnchor,
  measurementResolvedEditPoints,
  refreshMeasurementAnchorFallbacks,
  replaceMeasurementAnchor,
} from './edit'
import { matchMeasurementFeatureForNode, resolveMeasurementNode } from './resolve'

// A feature binds only when the snap already put the point on it, never by attraction.
const MEASURE_SNAP_BIND_DISTANCE = 0.005
// How close (screen pixels) the edge must come to level or upright to lock there.
const AXIS_LOCK_PX = 12

function semanticWallAnchor(
  point: MeasurementPoint,
  wallIds: readonly string[],
  nodes: Parameters<typeof resolveLevelId>[1],
  maxDistance: number,
): { anchor?: MeasurementAnchor; point: MeasurementPoint } {
  const matches = wallIds.flatMap((id) => {
    const node = nodes[id]
    if (!node) return []
    const match = matchMeasurementFeatureForNode(
      node,
      (nodeId) => nodes[nodeId],
      point,
      maxDistance,
    )
    return match ? [{ match, node }] : []
  })
  const closest = matches.sort((a, b) => a.match.distance - b.match.distance)[0]
  if (!closest) return { point }
  // A feature that would move the point (its segment ends short of it) does not bind it.
  const [x, , z] = closest.match.point
  if (Math.hypot(x - point[0], z - point[2]) > maxDistance) return { point }
  return {
    anchor: {
      kind: 'feature',
      reference: {
        nodeId: closest.node.id,
        featureId: closest.match.feature.id,
        parameters: closest.match.parameters,
      },
      fallback: closest.match.point,
    },
    point: closest.match.point,
  }
}

export const measurementMoveVertexAffordance: FloorplanAffordance<MeasurementNodeType> = {
  start({ node, nodes, payload }): FloorplanAffordanceSession {
    const vertexIndex = (payload as { vertexIndex?: unknown }).vertexIndex
    const resolved = resolveMeasurementNode(node, (id) => nodes[id])
    const original = refreshMeasurementAnchorFallbacks(node.measurement, resolved.payload)
    const levelId = resolveLevelId(node, nodes)
    let latest: MeasurementNodeType['measurement'] | null = null
    let held: ReturnType<typeof resolveLevelMeasureSnap> = null
    const editPoints = measurementResolvedEditPoints(resolved.payload)
    // Where on the dot the pointer grabbed it, so the edge follows the pointer without a jump.
    let grabOffset: [number, number] | null = null

    if (!Number.isInteger(vertexIndex)) {
      return {
        affectedIds: [node.id],
        apply() {},
        canCommit: () => false,
      }
    }

    return {
      affectedIds: [node.id],
      apply({ planPoint, modifiers }) {
        // Snaps like the measure tool: wall outline corners and faces, in screen pixels. Alt is free.
        // Shift locks the edge to 45° steps from its neighbouring point, with no snapping.
        const neighbour = neighbourPlanPoint(editPoints, vertexIndex as number)
        const grabbed = editPoints[vertexIndex as number]
        if (!grabOffset && grabbed) {
          grabOffset = [grabbed[0] - planPoint[0], grabbed[2] - planPoint[1]]
        }
        const pointer: [number, number] = [
          planPoint[0] + (grabOffset?.[0] ?? 0),
          planPoint[1] + (grabOffset?.[1] ?? 0),
        ]
        const shiftLocked =
          modifiers.shiftKey && neighbour ? lockTo45Degrees(neighbour, pointer) : null
        const raw = shiftLocked ?? pointer
        const target =
          modifiers.altKey || shiftLocked ? null : resolveLevelMeasureSnap(levelId, raw, held)
        held = target
        // Near level or upright with the neighbour, the edge locks there; on a face, where the two cross.
        const axis =
          modifiers.altKey || shiftLocked || target?.kind === 'corner' || !neighbour
            ? null
            : lockToAxis(neighbour, pointer, (getPlanSnapScale() ?? 0.01) * AXIS_LOCK_PX)
        const snappedPoint = axis
          ? target?.kind === 'face'
            ? (crossFace(axis, neighbour!, target.face) ?? axis.point)
            : axis.point
          : (target?.point ?? raw)
        const point = constrainMeasurementPlanEditPoint(
          resolved.payload,
          vertexIndex as number,
          snappedPoint,
        )
        // Bound to the wall only where the snap put it, so binding never moves the point.
        const associated = point
          ? target
            ? semanticWallAnchor(point, [target.wallId], nodes, MEASURE_SNAP_BIND_DISTANCE)
            : { point }
          : null
        const anchor =
          point && associated
            ? measurementEditAnchor(resolved.payload, associated.point, associated.anchor)
            : null
        const next = anchor
          ? replaceMeasurementAnchor(original, vertexIndex as number, anchor)
          : null
        if (!next || !MeasurementNode.safeParse({ ...node, measurement: next }).success) {
          latest = null
          useLiveNodeOverrides.getState().clear(node.id)
          return
        }
        latest = next
        useLiveNodeOverrides.getState().set(node.id, { measurement: next })
      },
      canCommit: () => latest !== null,
      commit() {
        const measurement = latest
        useLiveNodeOverrides.getState().clear(node.id)
        if (measurement) useScene.getState().updateNode(node.id, { measurement })
      },
    }
  },
}

/** The point before the dragged one, or after it for the first point, in plan coordinates. */
function neighbourPlanPoint(
  points: readonly MeasurementPoint[],
  index: number,
): [number, number] | null {
  const neighbour = points[index - 1] ?? points[index + 1]
  return neighbour ? [neighbour[0], neighbour[2]] : null
}

/** `point` moved onto the nearest 0/45/90° ray from `from`, keeping its distance along it. */
function lockTo45Degrees(from: [number, number], point: [number, number]): [number, number] {
  const dx = point[0] - from[0]
  const dz = point[1] - from[1]
  const step = Math.PI / 4
  const angle = Math.round(Math.atan2(dz, dx) / step) * step
  const along = dx * Math.cos(angle) + dz * Math.sin(angle)
  return [from[0] + Math.cos(angle) * along, from[1] + Math.sin(angle) * along]
}

/** The pointer on the horizontal or vertical line through `from`, when within `reach`. */
function lockToAxis(
  from: [number, number],
  point: [number, number],
  reach: number,
): { axis: 'x' | 'z'; point: [number, number] } | null {
  const offLevel = Math.abs(point[1] - from[1])
  const offUpright = Math.abs(point[0] - from[0])
  if (Math.min(offLevel, offUpright) > reach) return null
  return offLevel <= offUpright
    ? { axis: 'x', point: [point[0], from[1]] }
    : { axis: 'z', point: [from[0], point[1]] }
}

/** Where the locked axis through `from` crosses a wall face, if it does. */
function crossFace(
  axis: { axis: 'x' | 'z' },
  from: [number, number],
  face: { a: [number, number]; b: [number, number] },
): [number, number] | null {
  const [ax, az] = face.a
  const [bx, bz] = face.b
  // A level line holds z and crosses at some x; an upright line holds x and crosses at some z.
  const level = axis.axis === 'x'
  const span = level ? bz - az : bx - ax
  if (Math.abs(span) < 1e-9) return null
  const t = ((level ? from[1] : from[0]) - (level ? az : ax)) / span
  if (t < 0 || t > 1) return null
  const crossing = level ? ax + t * (bx - ax) : az + t * (bz - az)
  return axis.axis === 'x' ? [crossing, from[1]] : [from[0], crossing]
}
