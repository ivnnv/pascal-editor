import type { MeasurementFeatureAnchor, MeasurementSnapKind } from '@pascal-app/core'
import type { MeasurementAxisGuide, MeasurementPoint } from '../store/use-measurement-draft'
import type { WallSnapKind } from '../store/use-wall-snap-indicator'

// AIKAZA: one resolved measure point drives the marker, the preview and the commit.

export type MeasureSemantic = {
  label: string
  length: number | null
  snapKind: MeasurementSnapKind
}

export type MeasureBinding = {
  point: MeasurementPoint
  anchor?: MeasurementFeatureAnchor
  semantic?: MeasureSemantic
}

export type RawMeasurePoint = {
  point: MeasurementPoint
  guide: MeasurementAxisGuide | null
  targetNodeId: string | null
  markerKind: WallSnapKind | null
  markerWallId?: string
  // A snap the binding must not move, like a visible corner.
  exact?: boolean
}

export type ResolvedMeasurePoint = MeasureBinding & {
  guide: MeasurementAxisGuide | null
  targetNodeId: string | null
  marker: { x: number; z: number; kind: WallSnapKind; wallIds?: string[] } | null
}

// How far a binding may sit from the point and still describe it.
const BOUND_EPSILON = 1e-4

/**
 * Binds the snapped point to a feature and places the marker on the result. A
 * binding may pull a free point onto its feature, but never off an axis lock or
 * an exact snap; there it only describes a feature the point already lies on.
 */
export function finalizeMeasurePoint(
  raw: RawMeasurePoint,
  bind: (
    point: MeasurementPoint,
    targetNodeId: string | null,
    maxDistance?: number,
  ) => MeasureBinding,
): ResolvedMeasurePoint {
  let binding = bind(raw.point, raw.targetNodeId)
  if ((raw.guide?.snapped || raw.exact) && distance(binding.point, raw.point) > BOUND_EPSILON) {
    binding = bind(raw.point, raw.targetNodeId, BOUND_EPSILON)
    if (distance(binding.point, raw.point) > BOUND_EPSILON) binding = { point: raw.point }
  }
  const point = binding.point
  return {
    ...binding,
    guide: raw.guide ? { ...raw.guide, to: [...point] as MeasurementPoint } : null,
    targetNodeId: raw.targetNodeId,
    marker: raw.markerKind
      ? {
          x: point[0],
          z: point[2],
          kind: raw.markerKind,
          ...(raw.markerWallId ? { wallIds: [raw.markerWallId] } : {}),
        }
      : null,
  }
}

function distance(a: MeasurementPoint, b: MeasurementPoint): number {
  return Math.hypot(a[0] - b[0], a[2] - b[2])
}

export type FaceLine = {
  point: [number, number]
  direction: [number, number]
  // The face runs from `point` + direction * min to `point` + direction * max.
  min: number
  max: number
}

export type SquareAxis = 'x' | 'z' | 'diagonal'

/**
 * Where a face crosses the horizontal and vertical through `from`, and with
 * `diagonals` its 45° lines too, keeping only crossings within the face.
 */
export function squareOnFace(
  line: FaceLine,
  from: MeasurementPoint,
  diagonals = false,
): { axis: SquareAxis; point: MeasurementPoint }[] {
  const directions: { axis: SquareAxis; d: [number, number] }[] = [
    { axis: 'x', d: [1, 0] },
    { axis: 'z', d: [0, 1] },
    ...(diagonals
      ? ([
          { axis: 'diagonal', d: [Math.SQRT1_2, Math.SQRT1_2] },
          { axis: 'diagonal', d: [Math.SQRT1_2, -Math.SQRT1_2] },
        ] as { axis: SquareAxis; d: [number, number] }[])
      : []),
  ]
  const out: { axis: SquareAxis; point: MeasurementPoint }[] = []
  const [px, pz] = line.point
  const [fx, fz] = line.direction
  for (const { axis, d } of directions) {
    // Solve point + face * t = from + d * s.
    const det = fx * -d[1] - fz * -d[0]
    if (Math.abs(det) < 1e-6) continue
    const rx = from[0] - px
    const rz = from[2] - pz
    const t = (rx * -d[1] - rz * -d[0]) / det
    if (t < line.min - 1e-6 || t > line.max + 1e-6) continue
    out.push({ axis, point: [px + fx * t, from[1], pz + fz * t] })
  }
  return out
}
