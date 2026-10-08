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
 * binding may pull a free point onto its feature, but never off an axis lock;
 * there it only describes a feature the point already lies on.
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
  if (raw.guide?.snapped && distance(binding.point, raw.point) > BOUND_EPSILON) {
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

/** Where a face crosses the horizontal and vertical through `from`, within the face. */
export function squareOnFace(
  line: FaceLine,
  from: MeasurementPoint,
): { axis: 'x' | 'z'; point: MeasurementPoint }[] {
  const out: { axis: 'x' | 'z'; point: MeasurementPoint }[] = []
  const [px, pz] = line.point
  const [dx, dz] = line.direction
  const within = (t: number) => t >= line.min - 1e-6 && t <= line.max + 1e-6
  if (Math.abs(dz) > 1e-6) {
    const t = (from[2] - pz) / dz
    if (within(t)) out.push({ axis: 'x', point: [px + dx * t, from[1], from[2]] })
  }
  if (Math.abs(dx) > 1e-6) {
    const t = (from[0] - px) / dx
    if (within(t)) out.push({ axis: 'z', point: [from[0], from[1], pz + dz * t] })
  }
  return out
}
