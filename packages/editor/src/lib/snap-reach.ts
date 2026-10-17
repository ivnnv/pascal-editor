// AIKAZA: how far each snap reaches, in screen pixels, shared by every plan tool.
// A plan tool turns these into metres at the current zoom, so a snap pulls the
// same on screen whether the plan is zoomed in or out.

export const SNAP_REACH_PX = {
  measure: {
    corner: { catch: 14, release: 20 },
    face: { catch: 12, release: 18 },
  },
  // Walls join on centre lines, so they reach a little further than measures.
  wall: { endpoint: 24, midpoint: 18, intersection: 18, wall: 16 },
} as const

let planMetresPerPixel: number | null = null

/** Published by the floor plan while it is on screen. */
export function setPlanSnapScale(metresPerPixel: number | null) {
  planMetresPerPixel =
    metresPerPixel && Number.isFinite(metresPerPixel) && metresPerPixel > 0 ? metresPerPixel : null
}

/** The floor plan's metres per screen pixel, or null when no plan is shown. */
export function getPlanSnapScale(): number | null {
  return planMetresPerPixel
}
