import { type RefObject, useEffect, useState } from 'react'

export type TopDockShift = { x: number; y: number }

const NO_SHIFT: TopDockShift = { x: 0, y: 0 }
const MARGIN = 8

type Span = { left: number; right: number }

/**
 * Where a top-docked menu moves to stay clear of the chrome around it (anything
 * marked `data-menu-obstacle`): as close to its centred spot as a free gap in its
 * row allows, else one row lower, below what blocked it, trying again there.
 */
export function fitTopDock(
  menu: { left: number; top: number; width: number; height: number },
  region: Span,
  obstacles: readonly { left: number; right: number; top: number; bottom: number }[],
): TopDockShift {
  const center = menu.left + menu.width / 2
  const half = menu.width / 2 + MARGIN
  let top = menu.top
  for (let row = 0; row < 4; row++) {
    const bottom = top + menu.height
    const blocking = obstacles
      .filter((rect) => rect.top < bottom + MARGIN && rect.bottom + MARGIN > top)
      .filter((rect) => rect.right > region.left && rect.left < region.right)
    if (!blocking.some((rect) => rect.left < center + half && rect.right > center - half)) {
      return { x: 0, y: Math.round(top - menu.top) }
    }

    const gaps: Span[] = []
    let cursor = region.left
    for (const rect of [...blocking].sort((a, b) => a.left - b.left)) {
      if (rect.left > cursor) gaps.push({ left: cursor, right: rect.left })
      cursor = Math.max(cursor, rect.right)
    }
    if (cursor < region.right) gaps.push({ left: cursor, right: region.right })

    let best: number | null = null
    for (const gap of gaps) {
      const min = gap.left + half
      const max = gap.right - half
      if (min > max) continue
      const placed = Math.min(max, Math.max(min, center))
      if (best === null || Math.abs(placed - center) < Math.abs(best - center)) best = placed
    }
    if (best !== null) return { x: Math.round(best - center), y: Math.round(top - menu.top) }
    // Step down past the first blocker over the centred spot and try that row.
    top =
      Math.min(
        ...blocking
          .filter((rect) => rect.left < center + half && rect.right > center - half)
          .map((rect) => rect.bottom),
      ) + MARGIN
  }
  return { x: 0, y: Math.round(top - menu.top) }
}

const viewerArea = () => document.querySelector('[data-pascal-viewer-3d]')?.parentElement ?? null

/** Keeps a top-docked menu clear of the chrome around it as the layout changes. */
export function useTopDockShift(
  menuRef: RefObject<HTMLElement | null>,
  enabled: boolean,
): TopDockShift {
  const [shift, setShift] = useState<TopDockShift>(NO_SHIFT)
  useEffect(() => {
    if (!enabled) {
      setShift(NO_SHIFT)
      return
    }
    let raf = 0
    let applied = NO_SHIFT
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const element = menuRef.current
      if (!element) return
      const rect = element.getBoundingClientRect()
      const area = viewerArea()?.getBoundingClientRect()
      const next = fitTopDock(
        {
          left: rect.left - applied.x,
          top: rect.top - applied.y,
          width: rect.width,
          height: rect.height,
        },
        area && area.width > 0
          ? { left: area.left, right: area.right }
          : { left: 0, right: window.innerWidth },
        [...document.querySelectorAll('[data-menu-obstacle]')]
          .map((node) => node.getBoundingClientRect())
          .filter((box) => box.width > 0 && box.height > 0),
      )
      if (next.x !== applied.x || next.y !== applied.y) {
        applied = next
        setShift(next)
      }
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [enabled, menuRef])
  return shift
}
