import {
  type AlignmentAnchor,
  type AnyNode,
  type AnyNodeId,
  bboxCornerAnchors,
  collectAlignmentAnchors,
  resolveAlignment,
} from '@pascal-app/core'
import {
  type GroupPlanBounds,
  groupWallAlignmentAnchors,
  lockGroupDelta,
  type Vec2,
} from '../components/editor/group-transform-shared'
import useAlignmentGuides from '../store/use-alignment-guides'
import useEditor, {
  isAlignmentGuideActive,
  isGridSnapActive,
  isMagneticSnapActive,
} from '../store/use-editor'
import {
  FLOORPLAN_ALIGNMENT_THRESHOLD_M,
  floorplanAlignmentThreshold,
} from './floorplan/apply-alignment'
import { resolveAlignmentForFloorplanView } from './world-grid-snap'

// AIKAZA: the one snapping pipeline for every group move (2D drag, Move pick-up, 3D drag).

/** Where the pointer is: the 2D plan aligns in its rotated view frame at a zoom-aware reach. */
export type GroupMoveSurface = '2d' | '3d'

/** Alignment targets for a group move: everything on the level outside the moving set. */
export function collectGroupMoveCandidates(
  nodes: Readonly<Record<string, AnyNode>>,
  movingIds: readonly AnyNodeId[],
  levelId: string | null,
): AlignmentAnchor[] {
  const moving = new Set<string>(movingIds)
  const staticNodes: Record<string, AnyNode> = {}
  for (const [id, node] of Object.entries(nodes)) {
    if (node && !moving.has(id)) staticNodes[id] = node
  }
  return collectAlignmentAnchors(staticNodes, '', levelId)
}

/** The group's own anchors: its footprint corners plus each moved wall's ends and faces. */
export function groupMoveRestAnchors(
  bounds: GroupPlanBounds,
  starts: readonly { id: AnyNodeId }[] | null,
  nodes: Readonly<Record<string, AnyNode>>,
): AlignmentAnchor[] {
  const anchors = bboxCornerAnchors(
    'group-move',
    bounds.minX,
    bounds.minZ,
    bounds.maxX,
    bounds.maxZ,
  )
  // Rotated mid-move snapshots no longer match the scene walls, so only the footprint aligns then.
  if (starts) anchors.push(...groupWallAlignmentAnchors(starts, nodes))
  return anchors
}

/**
 * The final offset for a raw group move: Cmd/Ctrl locks it to 0/45/90° with no other snap;
 * otherwise the grid step, then alignment (guides always, the pull in magnetic mode).
 */
export function resolveGroupMoveDelta(args: {
  raw: Vec2
  lock: boolean
  surface: GroupMoveSurface
  restAnchors: readonly AlignmentAnchor[]
  candidates: readonly AlignmentAnchor[]
}): Vec2 {
  const { raw, lock, surface, restAnchors, candidates } = args
  if (lock) {
    useAlignmentGuides.getState().clear()
    return lockGroupDelta(raw[0], raw[1]) ?? [0, 0]
  }

  const step = useEditor.getState().gridSnapStep
  const snap = isGridSnapActive() && step > 0
  let dx = snap ? Math.round(raw[0] / step) * step : raw[0]
  let dz = snap ? Math.round(raw[1] / step) * step : raw[1]

  if (!isAlignmentGuideActive() || candidates.length === 0 || restAnchors.length === 0) {
    useAlignmentGuides.getState().clear()
    return [dx, dz]
  }
  const moving = restAnchors.map((a) => ({ ...a, x: a.x + dx, z: a.z + dz }))
  const result =
    surface === '2d'
      ? resolveAlignmentForFloorplanView({
          moving,
          candidates,
          threshold: floorplanAlignmentThreshold(),
        })
      : resolveAlignment({ moving, candidates, threshold: FLOORPLAN_ALIGNMENT_THRESHOLD_M })
  useAlignmentGuides.getState().set(result.guides)
  if (result.snap && isMagneticSnapActive()) {
    dx += result.snap.dx
    dz += result.snap.dz
  }
  return [dx, dz]
}

/** Cmd or Ctrl, whichever the platform or a remapped keyboard sends. */
export function isGroupMoveLockKey(e: { ctrlKey: boolean; metaKey: boolean }): boolean {
  return e.ctrlKey || e.metaKey
}

/**
 * Pressing or releasing Cmd/Ctrl mid-move: the last pointer move re-played with the lock on or off,
 * or null for any other key. The release is consumed so it isn't also a grid-step cycling tap.
 */
export function groupMoveLockKeyReplay(
  e: KeyboardEvent,
  last: PointerEvent | null,
): PointerEvent | null {
  if ((e.key !== 'Control' && e.key !== 'Meta') || !last) return null
  if (e.type === 'keyup') e.preventDefault()
  return new PointerEvent('pointermove', {
    clientX: last.clientX,
    clientY: last.clientY,
    pointerId: last.pointerId,
    ctrlKey: e.type === 'keydown',
  })
}
