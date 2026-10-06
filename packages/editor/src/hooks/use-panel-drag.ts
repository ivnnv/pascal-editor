'use client'

import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useRef,
  useState,
} from 'react'

// Gap (px) kept between a dragged panel and the edge of the viewer.
export const DRAG_MARGIN = 8
// Pointer travel (px) below which a header press is a click rather than a drag.
const CLICK_SLOP = 4

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

/**
 * Bounds a panel may occupy: the viewer column (tagged `data-viewer-bounds`),
 * so it can't slide under the sidebar or top bar, else the viewport.
 */
export function getDragBounds(el: HTMLElement | null): {
  left: number
  top: number
  right: number
  bottom: number
} {
  const region =
    el?.closest('[data-viewer-bounds]') ?? document.querySelector('[data-viewer-bounds]')
  const rect = region?.getBoundingClientRect()
  if (!rect) {
    return { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
  }
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
}

/** A drag in progress: where the panel started and how far it has moved, kept inside the viewer. */
export type PanelDrag = { rect: DOMRect; dx: number; dy: number }

/**
 * Drag a floating panel by its header. `drag` updates on every pointer move;
 * `onEnd` gets the final move, and a press that never moves is `onClick`.
 * The page root captures the pointer: the 3D canvas below gets no moves while
 * dragging, and the panel may remount elsewhere mid-drag.
 */
export function usePanelDrag(
  ref: RefObject<HTMLElement | null>,
  { onClick, onEnd }: { onClick?: () => void; onEnd?: (drag: PanelDrag) => void },
) {
  const [drag, setDrag] = useState<PanelDrag | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const handlers = useRef({ onClick, onEnd })
  handlers.current = { onClick, onEnd }

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      // Buttons and a title edited in place handle their own clicks.
      if (event.button !== 0 || (event.target as HTMLElement).closest('button, input, label')) {
        return
      }
      const el = ref.current
      const rect = el?.getBoundingClientRect()
      if (!rect) return
      const bounds = getDragBounds(el)
      const start = { x: event.clientX, y: event.clientY }
      const pointerId = event.pointerId
      const root = document.documentElement
      let last: PanelDrag | null = null
      root.setPointerCapture(pointerId)
      setIsDragging(true)

      const onMove = (move: PointerEvent) => {
        if (move.pointerId !== pointerId) return
        const dx = move.clientX - start.x
        const dy = move.clientY - start.y
        if (!last && Math.hypot(dx, dy) <= CLICK_SLOP) return
        const left = clamp(
          rect.left + dx,
          bounds.left + DRAG_MARGIN,
          bounds.right - rect.width - DRAG_MARGIN,
        )
        const top = clamp(
          rect.top + dy,
          bounds.top + DRAG_MARGIN,
          bounds.bottom - rect.height - DRAG_MARGIN,
        )
        last = { rect, dx: left - rect.left, dy: top - rect.top }
        setDrag(last)
      }
      const onUp = (up: PointerEvent) => {
        if (up.pointerId !== pointerId) return
        root.removeEventListener('pointermove', onMove)
        root.removeEventListener('pointerup', onUp)
        root.removeEventListener('pointercancel', onUp)
        if (root.hasPointerCapture(pointerId)) root.releasePointerCapture(pointerId)
        setIsDragging(false)
        setDrag(null)
        if (last) handlers.current.onEnd?.(last)
        else handlers.current.onClick?.()
      }
      root.addEventListener('pointermove', onMove)
      root.addEventListener('pointerup', onUp)
      root.addEventListener('pointercancel', onUp)
    },
    [ref],
  )

  return { drag, isDragging, onPointerDown }
}
