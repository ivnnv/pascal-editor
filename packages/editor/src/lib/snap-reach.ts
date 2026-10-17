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

// The zoom (metres per pixel) the pixel reaches were tuned at; past it they shrink.
const SNAP_REACH_TUNED_METRES_PER_PIXEL = 0.01
const MIN_ZOOM_REACH_SCALE = 0.3

/** 1 at the tuned zoom or further out, less zoomed in, so fine moves get through a snap. */
export function zoomSnapReachScale(metresPerPixel: number | null): number {
  if (!metresPerPixel) return 1
  return Math.min(
    1,
    Math.max(MIN_ZOOM_REACH_SCALE, metresPerPixel / SNAP_REACH_TUNED_METRES_PER_PIXEL),
  )
}

/** A pixel reach as metres at this zoom, never past `maxMetres`. */
export function planSnapReach(px: number, metresPerPixel: number, maxMetres: number): number {
  return Math.min(maxMetres, px * metresPerPixel * zoomSnapReachScale(metresPerPixel))
}
