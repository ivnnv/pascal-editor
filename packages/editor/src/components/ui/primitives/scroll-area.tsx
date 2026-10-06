'use client'

import {
  type HTMLAttributes,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from 'react'
import { type ScrollMetrics, scrollFadeStyle, useScrollMetrics } from '../../../hooks/use-scroll-metrics'
import { cn } from '../../../lib/utils'

/**
 * A scroll container with a thin themed scrollbar laid over its right edge,
 * which takes no width, so content never reflows as it appears or as sections
 * open and close. The bottom fades while there is more below.
 * `className` sizes the area; `viewportProps` go on the element that scrolls.
 */
export function ScrollArea({
  children,
  className,
  contentClassName,
  viewportProps,
  fade = true,
}: {
  children: ReactNode
  className?: string
  contentClassName?: string
  viewportProps?: HTMLAttributes<HTMLDivElement> & Record<`data-${string}`, string | boolean>
  fade?: boolean
}) {
  const viewport = useRef<HTMLDivElement | null>(null)
  const metrics = useScrollMetrics(viewport)
  const [hovered, setHovered] = useState(false)
  return (
    <div
      className={cn('relative flex min-h-0 flex-col', className)}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <div
        {...viewportProps}
        className={cn(
          'no-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden',
          contentClassName,
        )}
        ref={viewport}
        style={{ ...viewportProps?.style, ...(fade ? scrollFadeStyle(metrics) : undefined) }}
      >
        {children}
      </div>
      <OverlayScrollbar metrics={metrics} target={viewport} visible={hovered} />
    </div>
  )
}

const MIN_THUMB_PX = 24
// How long (ms) the thumb stays after the last scroll.
const LINGER_MS = 900

// Drawn over the right edge of `target`; shows while it scrolls or `visible`.
function OverlayScrollbar({
  target,
  metrics,
  visible,
}: {
  target: RefObject<HTMLElement | null>
  metrics: ScrollMetrics
  visible: boolean
}) {
  const { top, height, client } = metrics
  const [scrolling, setScrolling] = useState(false)
  const [dragging, setDragging] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastTop = useRef(top)

  useEffect(() => {
    if (lastTop.current === top) return
    lastTop.current = top
    setScrolling(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setScrolling(false), LINGER_MS)
  }, [top])
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])

  const el = target.current
  if (!el || height <= client + 1) return null
  const thumb = Math.max(MIN_THUMB_PX, (client / height) * client)
  const travel = client - thumb
  const offset = travel * (top / (height - client))

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const handle = event.currentTarget
    const startY = event.clientY
    const startTop = el.scrollTop
    handle.setPointerCapture(event.pointerId)
    setDragging(true)
    const onMove = (move: PointerEvent) => {
      el.scrollTop = startTop + ((move.clientY - startY) / travel) * (height - client)
    }
    const onUp = () => {
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
      handle.removeEventListener('pointercancel', onUp)
      setDragging(false)
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
    handle.addEventListener('pointercancel', onUp)
  }

  const shown = visible || scrolling || dragging
  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none absolute right-0.5 z-10 w-2.5 transition-opacity duration-200',
        shown ? 'opacity-100' : 'opacity-0',
      )}
      style={{ top: el.offsetTop, height: client }}
    >
      <div
        className={cn(
          'absolute right-0.5 w-1 cursor-default rounded-full bg-foreground/25 transition-[width,background-color] hover:w-1.5 hover:bg-foreground/40',
          // A hidden thumb lets clicks through to the content under it.
          shown && 'pointer-events-auto',
          dragging && 'w-1.5 bg-foreground/40',
        )}
        onPointerDown={onPointerDown}
        // The thumb sits outside the scroller, so it passes the wheel on.
        onWheel={(event) => el.scrollBy({ top: event.deltaY })}
        style={{ top: offset, height: thumb }}
      />
    </div>
  )
}
