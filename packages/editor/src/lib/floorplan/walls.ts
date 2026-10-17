import type { WallNode } from '@pascal-app/core'

/** The wall's true thickness: its drawn faces are where measures and snaps land. */
export function getFloorplanWallThickness(wall: WallNode): number {
  return wall.thickness ?? 0.1
}

export function getFloorplanWall(wall: WallNode): WallNode {
  return {
    ...wall,
    thickness: getFloorplanWallThickness(wall),
  }
}
