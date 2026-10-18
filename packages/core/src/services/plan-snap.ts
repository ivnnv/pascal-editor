import type { WallNode } from '../schema/nodes/wall'
import { isCurvedWall } from '../systems/wall/wall-curve'
import { getWallFaceLine, type WallJustification } from '../systems/wall/wall-frame'
import type { AlignmentGuide } from './alignment'

/**
 * One snap model for plan gestures: what can be snapped onto (targets), what
 * the gesture is allowed to do (a sideways translation or a point move), and
 * where it lands. Pure geometry in plan XZ metres.
 */

export type PlanVec = readonly [number, number]

type PlanSnapTargetBase = {
  nodeId: string
  feature: string
  /** The moving lines allowed to line up with it; all of them when unset. */
  lines?: readonly string[]
}

export type PlanSnapTarget = PlanSnapTargetBase &
  (
    | { kind: 'point'; point: PlanVec }
    | { kind: 'segment'; a: PlanVec; b: PlanVec }
    /** The line a wall continues on past one of its ends. */
    | { kind: 'ray'; origin: PlanVec; direction: PlanVec }
  )

/** A straight edge the moving geometry carries, such as a wall face. */
export type PlanSnapLine = { a: PlanVec; b: PlanVec; feature: string }

const EPSILON = 1e-9
const PARALLEL_EPSILON = 1e-6

const dot = (a: PlanVec, b: PlanVec) => a[0] * b[0] + a[1] * b[1]
const cross = (a: PlanVec, b: PlanVec) => a[0] * b[1] - a[1] * b[0]
const sub = (a: PlanVec, b: PlanVec): [number, number] => [a[0] - b[0], a[1] - b[1]]

function unit(v: PlanVec): [number, number] | null {
  const length = Math.hypot(v[0], v[1])
  return length < EPSILON ? null : [v[0] / length, v[1] / length]
}

function closestOnSegment(p: PlanVec, a: PlanVec, b: PlanVec): [number, number] {
  const ab = sub(b, a)
  const lengthSq = dot(ab, ab)
  const t = lengthSq < EPSILON ? 0 : Math.min(1, Math.max(0, dot(sub(p, a), ab) / lengthSq))
  return [a[0] + ab[0] * t, a[1] + ab[1] * t]
}

type WallLike = Pick<
  WallNode,
  'id' | 'start' | 'end' | 'thickness' | 'justification' | 'curveOffset'
>

const facePoints = (wall: WallLike, face: WallJustification) => {
  const line = getWallFaceLine(wall, face)
  return [line.start, line.end].map((p) => [p.x, p.y] as [number, number])
}

// Faces line up with faces and face corners, reference lines with reference ends and continuations.
const FACE_LINES = ['face-a', 'face-b'] as const
const REFERENCE_LINE = ['reference'] as const

/**
 * A wall's snap targets: its reference ends and face corners, its two faces,
 * and the lines it continues on past each end. A curved wall offers only its
 * reference ends. `skipEnds` drops those ends' points (an end that moves with
 * the gesture); `pointsOnly` drops faces and continuations.
 */
export function wallPlanSnapTargets(
  wall: WallLike,
  options: { skipEnds?: ReadonlyArray<'start' | 'end'>; pointsOnly?: boolean } = {},
): PlanSnapTarget[] {
  const skip = new Set(options.skipEnds ?? [])
  const targets: PlanSnapTarget[] = []
  const ends = [
    ['start', wall.start],
    ['end', wall.end],
  ] as const
  for (const [end, point] of ends) {
    if (!skip.has(end))
      targets.push({ kind: 'point', point, nodeId: wall.id, feature: end, lines: REFERENCE_LINE })
  }
  const direction = unit(sub(wall.end, wall.start))
  if (isCurvedWall(wall) || !direction) return targets

  for (const face of ['a', 'b'] as const) {
    const [faceStart, faceEnd] = facePoints(wall, face)
    if (!skip.has('start'))
      targets.push({
        kind: 'point',
        point: faceStart!,
        nodeId: wall.id,
        feature: `face-${face}-start`,
        lines: FACE_LINES,
      })
    if (!skip.has('end'))
      targets.push({
        kind: 'point',
        point: faceEnd!,
        nodeId: wall.id,
        feature: `face-${face}-end`,
        lines: FACE_LINES,
      })
    if (!options.pointsOnly)
      targets.push({
        kind: 'segment',
        a: faceStart!,
        b: faceEnd!,
        nodeId: wall.id,
        feature: `face-${face}`,
        lines: FACE_LINES,
      })
  }
  if (!options.pointsOnly) {
    const back: PlanVec = [-direction[0], -direction[1]]
    targets.push(
      {
        kind: 'ray',
        origin: wall.start,
        direction: back,
        nodeId: wall.id,
        feature: 'past-start',
        lines: REFERENCE_LINE,
      },
      {
        kind: 'ray',
        origin: wall.end,
        direction,
        nodeId: wall.id,
        feature: 'past-end',
        lines: REFERENCE_LINE,
      },
    )
  }
  return targets
}

/**
 * What a wall moved sideways snaps onto: the ends, faces and continuations of
 * the other walls. Ends on the moving wall's own corners move with it, so they
 * are left out, and a wall joined to it offers only its far end.
 */
export function sidewaysMoveSnapTargets(
  wall: Pick<WallNode, 'start' | 'end'>,
  otherWalls: readonly WallLike[],
): PlanSnapTarget[] {
  const onCorner = (point: PlanVec) =>
    [wall.start, wall.end].some(
      (corner) => Math.hypot(point[0] - corner[0], point[1] - corner[1]) <= 1e-6,
    )
  return otherWalls.flatMap((other) => {
    const skipEnds = (['start', 'end'] as const).filter((end) => onCorner(other[end]))
    return wallPlanSnapTargets(other, { skipEnds, pointsOnly: skipEnds.length > 0 })
  })
}

/** A wall's reference line and both faces, as lines a sideways move carries. */
export function wallPlanSnapLines(wall: WallLike): PlanSnapLine[] {
  const lines: PlanSnapLine[] = [{ a: wall.start, b: wall.end, feature: 'reference' }]
  for (const face of ['a', 'b'] as const) {
    const [a, b] = facePoints(wall, face)
    lines.push({ a: a!, b: b!, feature: `face-${face}` })
  }
  return lines
}

export type PlanTranslateSnap = {
  /** The snapped distance along the axis, replacing the raw one. */
  offset: number
  line: PlanSnapLine
  target: PlanSnapTarget
  /** The target point the line lines up with. */
  anchor: [number, number]
  /** The point on the moved line nearest the anchor. */
  landing: [number, number]
}

/**
 * Lines moving together along `axis` (offset `offset` from where they started)
 * snapped so one of them lines up with a target: passes through a point, or
 * lies on a parallel face or continuation. The nearest match within `reach` wins.
 */
export function resolvePlanTranslateSnap(input: {
  axis: PlanVec
  lines: readonly PlanSnapLine[]
  offset: number
  targets: readonly PlanSnapTarget[]
  reach: number
}): PlanTranslateSnap | null {
  const axis = unit(input.axis)
  if (!axis) return null
  let best: (Omit<PlanTranslateSnap, 'landing'> & { distance: number }) | null = null
  for (const line of input.lines) {
    const lineDirection = unit(sub(line.b, line.a))
    if (!lineDirection) continue
    const lineProjection = dot(line.a, axis)
    const midpoint: PlanVec = [(line.a[0] + line.b[0]) / 2, (line.a[1] + line.b[1]) / 2]
    for (const target of input.targets) {
      let anchor: PlanVec
      if (target.lines && !target.lines.includes(line.feature)) continue
      if (target.kind === 'point') {
        anchor = target.point
      } else {
        const direction =
          target.kind === 'segment' ? unit(sub(target.b, target.a)) : unit(target.direction)
        if (!direction || Math.abs(cross(direction, lineDirection)) > PARALLEL_EPSILON) continue
        anchor =
          target.kind === 'ray' ? target.origin : closestOnSegment(midpoint, target.a, target.b)
      }
      const offset = dot(anchor, axis) - lineProjection
      const distance = Math.abs(offset - input.offset)
      if (distance > input.reach || (best && distance >= best.distance)) continue
      best = { offset, line, target, anchor: [anchor[0], anchor[1]], distance }
    }
  }
  if (!best) return null
  const { distance: _distance, ...snap } = best
  const shift: PlanVec = [axis[0] * snap.offset, axis[1] * snap.offset]
  const landing = closestOnSegment(
    snap.anchor,
    [snap.line.a[0] + shift[0], snap.line.a[1] + shift[1]],
    [snap.line.b[0] + shift[0], snap.line.b[1] + shift[1]],
  )
  return { ...snap, landing }
}

export type PlanPointSnap = { point: [number, number]; target: PlanSnapTarget }

/**
 * A dragged point pulled onto the nearest continuation within `reach` of the
 * raw pointer. With `along` (the line the point is held on) it lands where
 * that line crosses the continuation, otherwise straight across from `placed`.
 * A landing off `along`, or further than `maxShift` from the pointer, is no snap.
 */
export function resolvePlanPointSnap(input: {
  raw: PlanVec
  placed: PlanVec
  along?: { point: PlanVec; direction: PlanVec } | null
  targets: readonly PlanSnapTarget[]
  reach: number
  maxShift: number
}): PlanPointSnap | null {
  const along = input.along ? unit(input.along.direction) : null
  let best: (PlanPointSnap & { distance: number }) | null = null
  for (const target of input.targets) {
    if (target.kind !== 'ray') continue
    const direction = unit(target.direction)
    if (!direction) continue
    const offset = sub(input.raw, target.origin)
    if (dot(offset, direction) <= 0) continue
    const distance = Math.abs(cross(offset, direction))
    if (distance > input.reach || (best && distance >= best.distance)) continue
    let point: [number, number]
    if (input.along && along) {
      // Held on a line: only a continuation that crosses it can take the point.
      const turn = cross(direction, along)
      if (Math.abs(turn) <= PARALLEL_EPSILON) continue
      const t = cross(sub(input.along.point, target.origin), along) / turn
      point = [target.origin[0] + direction[0] * t, target.origin[1] + direction[1] * t]
    } else {
      const t = dot(sub(input.placed, target.origin), direction)
      point = [target.origin[0] + direction[0] * t, target.origin[1] + direction[1] * t]
    }
    if (Math.hypot(point[0] - input.raw[0], point[1] - input.raw[1]) > input.maxShift) continue
    best = { point, target, distance }
  }
  if (!best) return null
  return { point: best.point, target: best.target }
}

/** The guide from the target to the lined-up edge, when that edge runs along a plan axis. */
export function planTranslateSnapGuide(snap: PlanTranslateSnap): AlignmentGuide | null {
  const direction = unit(sub(snap.line.b, snap.line.a))
  if (!direction) return null
  const vertical = Math.abs(direction[0]) < PARALLEL_EPSILON
  const horizontal = Math.abs(direction[1]) < PARALLEL_EPSILON
  if (!vertical && !horizontal) return null
  return {
    axis: vertical ? 'x' : 'z',
    coord: vertical ? snap.anchor[0] : snap.anchor[1],
    from: { x: snap.anchor[0], z: snap.anchor[1] },
    to: { x: snap.landing[0], z: snap.landing[1] },
    anchor: { x: snap.anchor[0], z: snap.anchor[1] },
    movingAnchorKind: 'corner',
    candidateAnchorKind: 'corner',
    candidateNodeId: snap.target.nodeId,
    distance: 0,
  }
}

/** How the snap marker draws the target: a corner or end, or a point on a face or continuation. */
export function planSnapTargetMarker(target: PlanSnapTarget): 'endpoint' | 'wall' {
  return target.kind === 'point' ? 'endpoint' : 'wall'
}
