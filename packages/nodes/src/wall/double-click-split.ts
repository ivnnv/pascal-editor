import {
  type AnyNodeId,
  getWallCurveFrameAt,
  getWallCurveLength,
  getWallFaceOffsets,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import { clientToPlan } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { wallSplitDistance } from './split-preview'
import { splitWallAt } from './split-session'

/**
 * In the 2D plan, double-clicking the one selected wall cuts it in two at that
 * point. One document listener, installed when the wall kind loads.
 */
export function installWallDoubleClickSplit() {
  if (typeof document === 'undefined') return
  // A reloaded module replaces the previous listener instead of adding a second one.
  const slot = globalThis as { __pascalWallDoubleClickSplit?: (event: MouseEvent) => void }
  if (slot.__pascalWallDoubleClickSplit) {
    document.removeEventListener('dblclick', slot.__pascalWallDoubleClickSplit, true)
  }
  slot.__pascalWallDoubleClickSplit = onDoubleClick
  document.addEventListener('dblclick', onDoubleClick, true)
}

function onDoubleClick(event: MouseEvent) {
  const surface = document.querySelector<SVGGElement>('g[data-floorplan-scene]')?.ownerSVGElement
  if (!surface || !isOverPlan(surface, event)) return
  const selected = useViewer.getState().selection.selectedIds
  const wall = selected.length === 1 ? useScene.getState().nodes[selected[0] as AnyNodeId] : null
  if (wall?.type !== 'wall') return
  const point = clientToPlan(event.clientX, event.clientY)
  if (!point) return
  const distance = wallSplitDistance(wall, point)
  const onStroke = isOnWallStroke(wall, distance, point, metresPerPixel(surface))
  if (!onStroke) return
  const split = splitWallAt(wall, distance)
  if (!split) return
  // The first click may have opened the length input; the split closes it.
  if (isInLengthInput(event.target)) (event.target as HTMLElement).blur()
  event.preventDefault()
  event.stopPropagation()
}

function isInLengthInput(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('[data-floorplan-dimension-edit-overlay]')
}

// Inside the plan's area, including labels drawn over it and the length input
// the first click opens there, but not on its other controls.
function isOverPlan(surface: SVGSVGElement, event: MouseEvent): boolean {
  const rect = surface.getBoundingClientRect()
  const inside =
    event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom
  const control =
    event.target instanceof Element &&
    !isInLengthInput(event.target) &&
    event.target.closest('button, input, textarea, select, [role="menu"], [role="dialog"]')
  return inside && !control
}

function metresPerPixel(surface: SVGSVGElement): number {
  const scale = surface.querySelector<SVGGElement>('g[data-floorplan-scene]')?.getScreenCTM()?.a
  return scale ? 1 / Math.abs(scale) : 0.01
}

function isOnWallStroke(
  wall: WallNode,
  distance: number,
  point: readonly [number, number],
  metresPerPx: number,
): boolean {
  const length = getWallCurveLength(wall)
  const frame = getWallCurveFrameAt(wall, length > 0 ? distance / length : 0)
  const faces = getWallFaceOffsets(wall)
  const halfWidth = Math.max(faces.a, -faces.b) + 8 * metresPerPx
  return Math.hypot(frame.point.x - point[0], frame.point.y - point[1]) <= halfWidth
}
