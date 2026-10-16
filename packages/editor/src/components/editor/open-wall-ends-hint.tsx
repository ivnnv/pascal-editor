'use client'

import { type AnyNodeId, emitter, type OpenWallEnd } from '@pascal-app/core'
import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { dismissOpenWallEnds } from '../../hooks/use-open-wall-ends'
import { openWallEndsSummary } from '../../lib/floorplan/open-wall-ends'
import { MEASUREMENT_DANGLING_COLOR } from '../../lib/measurements'

// The viewer area holds the floor plan and the 3D view side by side; the hint
// sits at its top centre, one row down so it clears the views' top toolbars.
const viewerArea = () => document.querySelector('[data-pascal-viewer-3d]')?.parentElement ?? null
const TOOLBAR_CLEARANCE = 60
const HINT_HEIGHT = 34

/** Pushes the hint below an action menu docked across the same spot. */
function belowActionMenu(left: number, top: number): number {
  const menu = document.querySelector('[data-action-menu]')?.getBoundingClientRect()
  if (!menu || menu.left > left || menu.right < left) return top
  if (menu.bottom < top || menu.top > top + HINT_HEIGHT) return top
  return menu.bottom + 8
}

// The views slide in and out without resizing, so the anchor's box is read
// per frame while the hint is up, like the Join pill's anchor.
function useViewerAreaTopCenter(): { left: number; top: number } | null {
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null)
  useEffect(() => {
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const rect = viewerArea()?.getBoundingClientRect()
      const left = rect ? rect.left + rect.width / 2 : 0
      const next =
        rect && rect.width > 0
          ? { left, top: belowActionMenu(left, rect.top + TOOLBAR_CLEARANCE) }
          : null
      setAnchor((current) =>
        current && next && current.left === next.left && current.top === next.top ? current : next,
      )
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [])
  return anchor
}

/**
 * "2 wall ends aren't joined — rooms can't close", centred at the top of the
 * viewer area. Mounted by one view only (the floor plan when it shows, else
 * the 3D view), so split view shows it once.
 * Show walks the joinable ends one by one: it focuses the 3D camera on the
 * wall and asks the view to pin that end's Join pill.
 */
export function OpenWallEndsHint({
  ends,
  onShow,
}: {
  ends: readonly OpenWallEnd[]
  onShow: (end: OpenWallEnd) => void
}) {
  const anchor = useViewerAreaTopCenter()
  const [cursor, setCursor] = useState(0)
  const joinable = ends.filter((end) => end.candidate)
  const summary = openWallEndsSummary(joinable.length)
  if (!(anchor && summary)) return null

  const showNext = () => {
    const target = joinable[cursor % joinable.length]
    if (!target) return
    setCursor((value) => value + 1)
    onShow(target)
    emitter.emit('camera-controls:focus', { nodeId: target.wallId as AnyNodeId })
  }

  return createPortal(
    <div
      className="pointer-events-auto fixed z-30 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full border border-border bg-background/95 py-1 pr-1 pl-3 text-xs shadow-lg backdrop-blur-md"
      data-open-wall-end=""
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      style={{ left: anchor.left, top: anchor.top }}
    >
      <span
        aria-hidden
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: MEASUREMENT_DANGLING_COLOR }}
      />
      <span className="text-foreground">{summary}</span>
      <button
        className="rounded-full px-3 py-1 font-medium text-foreground transition-colors hover:bg-accent"
        onClick={(event) => {
          event.stopPropagation()
          showNext()
        }}
        type="button"
      >
        Show
      </button>
      <button
        aria-label="Dismiss"
        className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        onClick={(event) => {
          event.stopPropagation()
          dismissOpenWallEnds(ends)
        }}
        type="button"
      >
        <X aria-hidden className="h-3.5 w-3.5" />
      </button>
    </div>,
    document.body,
  )
}
