import { useScene, type WallNode } from '@pascal-app/core'
import useMeasureSnapSettings, {
  MEASURE_SNAP_STRENGTH_SCALE,
} from '../store/use-measure-snap-settings'
import {
  buildMeasureSnapGeometry,
  type MeasureSnapGeometry,
  type MeasureSnapTarget,
  resolveMeasureSnap,
} from './measure-snap'
import { getPlanSnapScale, zoomSnapReachScale } from './snap-reach'

let measureSnapCache: {
  nodes: unknown
  levelId: string | null
  geometry: MeasureSnapGeometry
} | null = null

/** The level's wall corners and faces a measure can land on, cached until the scene changes. */
export function levelMeasureSnapGeometry(levelId: string | null): MeasureSnapGeometry {
  const nodes = useScene.getState().nodes
  if (measureSnapCache?.nodes === nodes && measureSnapCache.levelId === levelId)
    return measureSnapCache.geometry
  const walls = Object.values(nodes).filter(
    (node): node is WallNode => node?.type === 'wall' && (!levelId || node.parentId === levelId),
  )
  const geometry = buildMeasureSnapGeometry(walls)
  measureSnapCache = { nodes, levelId, geometry }
  return geometry
}

/** The reach multiplier for measures: the user's snap strength, shrunk when zoomed in. */
export function measureSnapReachScale(metresPerPixel: number): number {
  const { strength } = useMeasureSnapSettings.getState()
  return MEASURE_SNAP_STRENGTH_SCALE[strength] * zoomSnapReachScale(metresPerPixel)
}

/** Where a measure point lands on the level's walls at the plan's zoom, as the measure tool snaps. */
export function resolveLevelMeasureSnap(
  levelId: string | null,
  pointer: readonly [number, number],
  held: MeasureSnapTarget | null,
): MeasureSnapTarget | null {
  const metresPerPixel = getPlanSnapScale() ?? 0.01
  const { corners, faces } = useMeasureSnapSettings.getState()
  return resolveMeasureSnap(
    levelMeasureSnapGeometry(levelId),
    [pointer[0], pointer[1]],
    1 / metresPerPixel,
    held,
    { corners, faces, reachScale: measureSnapReachScale(metresPerPixel) },
  )
}
